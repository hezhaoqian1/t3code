// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs/promises";
import * as NodePath from "node:path";

import { ProjectListSkillsError, type OrchestrationProject } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { listProjectSkills } from "./ProjectSkillCatalogQuery.ts";

const temporaryDirectories: string[] = [];

async function makeProject(): Promise<string> {
  const directory = await NodeFS.mkdtemp(NodePath.join("/tmp", "fd-project-skill-query-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeSkill(
  projectRoot: string,
  source: ".agents" | ".codex",
  name: string,
  description: string,
  body: string,
) {
  const skillRoot = NodePath.join(projectRoot, source, "skills", name);
  await NodeFS.mkdir(skillRoot, { recursive: true });
  await NodeFS.writeFile(
    NodePath.join(skillRoot, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n${body}`,
  );
}

function runQuery(cwd: string, activeRoots: ReadonlySet<string>) {
  const projection = {
    getActiveProjectByWorkspaceRoot: (workspaceRoot: string) =>
      Effect.succeed(
        activeRoots.has(workspaceRoot)
          ? Option.some({ workspaceRoot } as OrchestrationProject)
          : Option.none<OrchestrationProject>(),
      ),
  } as unknown as ProjectionSnapshotQuery.ProjectionSnapshotQueryShape;
  return Effect.runPromise(
    listProjectSkills(cwd).pipe(
      Effect.provideService(ProjectionSnapshotQuery.ProjectionSnapshotQuery, projection),
    ),
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => NodeFS.rm(directory, { recursive: true, force: true })),
  );
});

describe("listProjectSkills", () => {
  it("returns scoped display metadata with NativeSkillCatalog precedence and no instructions", async () => {
    const project = await makeProject();
    await writeSkill(project, ".codex", "same-skill", "codex description", "CODEX_BODY_SECRET");
    await writeSkill(project, ".agents", "same-skill", "agents description", "AGENTS_BODY_SECRET");

    const result = await runQuery(project, new Set([project]));

    expect(result.skills).toContainEqual(
      expect.objectContaining({
        name: "same-skill",
        description: "agents description",
        path: expect.stringMatching(/\.agents\/skills\/same-skill\/SKILL\.md$/),
        scope: "project:agents",
        enabled: true,
        displayName: "same-skill",
        shortDescription: "agents description",
      }),
    );
    expect(JSON.stringify(result)).not.toContain("BODY_SECRET");
  });

  it("does not return another project's skills", async () => {
    const projectA = await makeProject();
    const projectB = await makeProject();
    await writeSkill(projectA, ".agents", "only-project-a", "A", "A instructions");
    await writeSkill(projectB, ".agents", "only-project-b", "B", "B instructions");
    const activeRoots = new Set([projectA, projectB]);

    const [resultA, resultB] = await Promise.all([
      runQuery(projectA, activeRoots),
      runQuery(projectB, activeRoots),
    ]);

    expect(resultA.skills.some((skill) => skill.name === "only-project-a")).toBe(true);
    expect(resultA.skills.some((skill) => skill.name === "only-project-b")).toBe(false);
    expect(resultB.skills.some((skill) => skill.name === "only-project-b")).toBe(true);
    expect(resultB.skills.some((skill) => skill.name === "only-project-a")).toBe(false);
  });

  it("rejects cwd values that are not active registered workspace roots", async () => {
    const project = await makeProject();
    const nestedCwd = NodePath.join(project, "nested");

    await expect(runQuery(nestedCwd, new Set([project]))).rejects.toMatchObject({
      _tag: "ProjectListSkillsError",
      cwd: nestedCwd,
      failure: "project_not_found",
    } satisfies Partial<ProjectListSkillsError>);
  });
});
