// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs/promises";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";

import {
  FD_MANAGED_SKILL_IDENTITIES,
  NativeSkillCatalog,
  NATIVE_SKILL_LIMITS,
  selectedNativeSkillNames,
} from "./NativeSkillCatalog.ts";

const temporaryDirectories: string[] = [];

async function makeTempDirectory(): Promise<string> {
  const directory = await NodeFS.mkdtemp(NodePath.join("/tmp", "fd-native-skills-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeSkill(root: string, name: string, description: string, body = "\nBody\n") {
  const skillRoot = NodePath.join(root, name);
  await NodeFS.mkdir(skillRoot, { recursive: true });
  await NodeFS.writeFile(
    NodePath.join(skillRoot, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n${body}`,
  );
  return skillRoot;
}

async function copyFixtureSkill(root: string, name: string) {
  const skillRoot = NodePath.join(root, name);
  await NodeFS.mkdir(skillRoot, { recursive: true });
  await NodeFS.copyFile(
    NodePath.join(import.meta.dirname, "fixtures", `${name}.SKILL.md`),
    NodePath.join(skillRoot, "SKILL.md"),
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => NodeFS.rm(directory, { recursive: true, force: true })),
  );
});

describe("NativeSkillCatalog", () => {
  it("parses all four original ZIP Skills", async () => {
    const project = await makeTempDirectory();
    const root = NodePath.join(project, ".agents", "skills");
    for (const name of FD_MANAGED_SKILL_IDENTITIES) await copyFixtureSkill(root, name);
    const catalog = new NativeSkillCatalog({
      projectRoot: project,
      userHome: "/private/tmp/fd-native-skills-no-user",
      managedSkillNames: new Set(),
    });
    const snapshot = await catalog.refresh();

    expect(snapshot.skills.map((skill) => skill.name)).toEqual([
      "company-data-quality",
      "company-database-query",
      "company-knowledge-helper",
      "company-report-writing",
    ]);
    expect(snapshot.skills).toHaveLength(FD_MANAGED_SKILL_IDENTITIES.size);
    expect(snapshot.diagnostics).toEqual([]);
  });

  it("uses project .agents over project .codex and project over user", async () => {
    const home = await makeTempDirectory();
    const project = await makeTempDirectory();
    await writeSkill(NodePath.join(home, ".codex", "skills"), "same", "user codex");
    await writeSkill(NodePath.join(home, ".agents", "skills"), "same", "user agents");
    await writeSkill(NodePath.join(project, ".codex", "skills"), "same", "project codex");
    await writeSkill(NodePath.join(project, ".agents", "skills"), "same", "project agents");

    const snapshot = await new NativeSkillCatalog({
      projectRoot: project,
      userHome: home,
    }).refresh();
    expect(snapshot.skills).toHaveLength(1);
    expect(snapshot.skills[0]).toMatchObject({
      name: "same",
      description: "project agents",
      source: "agents",
      scope: "project",
    });
    expect(snapshot.diagnostics.filter((item) => item.code === "duplicate-identity")).toHaveLength(
      3,
    );
  });

  it("hides database Skills from local execution when FD owns the identity", async () => {
    const project = await makeTempDirectory();
    await writeSkill(
      NodePath.join(project, ".agents", "skills"),
      "company-database-query",
      "local database",
    );
    const snapshot = await new NativeSkillCatalog({
      projectRoot: project,
      userHome: await makeTempDirectory(),
    }).refresh();
    expect(snapshot.skills).toEqual([]);
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({ code: "managed-collision", skillName: "company-database-query" }),
    ]);
  });

  it("rejects an escaped skill directory symlink", async () => {
    const project = await makeTempDirectory();
    const outside = await makeTempDirectory();
    await writeSkill(outside, "escaped", "outside");
    const root = NodePath.join(project, ".agents", "skills");
    await NodeFS.mkdir(root, { recursive: true });
    await NodeFS.symlink(NodePath.join(outside, "escaped"), NodePath.join(root, "escaped"));

    const snapshot = await new NativeSkillCatalog({
      projectRoot: project,
      userHome: await makeTempDirectory(),
    }).refresh();
    expect(snapshot.skills).toEqual([]);
    expect(snapshot.diagnostics[0]).toMatchObject({ code: "outside-root" });
  });

  it("rejects malformed and oversized Skill files", async () => {
    const project = await makeTempDirectory();
    const root = NodePath.join(project, ".agents", "skills");
    const malformed = await writeSkill(root, "malformed", "valid");
    await NodeFS.writeFile(NodePath.join(malformed, "SKILL.md"), "name: missing frontmatter\n");
    const oversized = await writeSkill(root, "oversized", "valid");
    await NodeFS.writeFile(
      NodePath.join(oversized, "SKILL.md"),
      "x".repeat(NATIVE_SKILL_LIMITS.maxSkillBytes + 1),
    );

    const snapshot = await new NativeSkillCatalog({
      projectRoot: project,
      userHome: await makeTempDirectory(),
    }).refresh();
    expect(snapshot.skills).toEqual([]);
    expect(snapshot.diagnostics.map((item) => item.code).sort()).toEqual([
      "invalid-frontmatter",
      "oversized-file",
    ]);
  });

  it("loads full contents only for selected names and bounds selection", async () => {
    const project = await makeTempDirectory();
    const root = NodePath.join(project, ".agents", "skills");
    await writeSkill(root, "one", "one", "one instructions");
    await writeSkill(root, "two", "two", "two instructions");
    const catalog = new NativeSkillCatalog({
      projectRoot: project,
      userHome: await makeTempDirectory(),
    });
    await catalog.refresh();
    expect(await catalog.loadSelected(["missing", "two"])).toEqual([
      expect.stringContaining("two instructions"),
    ]);
    expect(selectedNativeSkillNames("$one then $two $three")).toEqual(["one", "two", "three"]);
  });
});
