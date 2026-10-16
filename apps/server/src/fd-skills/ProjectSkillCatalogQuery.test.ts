import * as Schema from "effect/Schema";
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";

import { ProjectListSkillsError, type OrchestrationProject } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { listProjectSkills } from "./ProjectSkillCatalogQuery.ts";

const temporaryDirectories: string[] = [];

async function makeProject(): Promise<string> {
  const directory = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "fd-project-skill-query-"),
  );
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
  await NodeFSP.mkdir(skillRoot, { recursive: true });
  await NodeFSP.writeFile(
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
  return listProjectSkills(cwd).pipe(
    Effect.provideService(ProjectionSnapshotQuery.ProjectionSnapshotQuery, projection),
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => NodeFSP.rm(directory, { recursive: true, force: true })),
  );
});

describe("listProjectSkills", () => {
  it.live(
    "returns scoped display metadata with NativeSkillCatalog precedence and no instructions",
    () =>
      Effect.gen(function* () {
        const project = yield* Effect.promise(makeProject);
        yield* Effect.promise(() =>
          writeSkill(project, ".codex", "same-skill", "codex description", "CODEX_BODY_SECRET"),
        );
        yield* Effect.promise(() =>
          writeSkill(project, ".agents", "same-skill", "agents description", "AGENTS_BODY_SECRET"),
        );

        const result = yield* runQuery(project, new Set([project]));

        expect(result.skills).toContainEqual(
          expect.objectContaining({
            name: "same-skill",
            description: "agents description",
            path: expect.stringMatching(/\.agents[\\/]skills[\\/]same-skill[\\/]SKILL\.md$/),
            scope: "project:agents",
            enabled: true,
            displayName: "same-skill",
            shortDescription: "agents description",
          }),
        );
        expect(
          yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(result),
        ).not.toContain("BODY_SECRET");
      }),
  );

  it.live("does not return another project's skills", () =>
    Effect.gen(function* () {
      const projectA = yield* Effect.promise(makeProject);
      const projectB = yield* Effect.promise(makeProject);
      yield* Effect.promise(() =>
        writeSkill(projectA, ".agents", "only-project-a", "A", "A instructions"),
      );
      yield* Effect.promise(() =>
        writeSkill(projectB, ".agents", "only-project-b", "B", "B instructions"),
      );
      const activeRoots = new Set([projectA, projectB]);

      const [resultA, resultB] = yield* Effect.all(
        [runQuery(projectA, activeRoots), runQuery(projectB, activeRoots)],
        { concurrency: "unbounded" },
      );

      expect(resultA.skills.some((skill) => skill.name === "only-project-a")).toBe(true);
      expect(resultA.skills.some((skill) => skill.name === "only-project-b")).toBe(false);
      expect(resultB.skills.some((skill) => skill.name === "only-project-b")).toBe(true);
      expect(resultB.skills.some((skill) => skill.name === "only-project-a")).toBe(false);
    }),
  );

  it.live("rejects cwd values that are not active registered workspace roots", () =>
    Effect.gen(function* () {
      const project = yield* Effect.promise(makeProject);
      const nestedCwd = NodePath.join(project, "nested");

      expect(yield* Effect.flip(runQuery(nestedCwd, new Set([project])))).toMatchObject({
        _tag: "ProjectListSkillsError",
        cwd: nestedCwd,
        failure: "project_not_found",
      } satisfies Partial<ProjectListSkillsError>);
    }),
  );
});
