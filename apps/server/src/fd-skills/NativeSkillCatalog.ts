// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { parse as parseYaml } from "yaml";

export const NATIVE_SKILL_LIMITS = {
  maxSkillBytes: 256 * 1024,
  maxFrontmatterBytes: 32 * 1024,
  maxSelectedInstructionBytes: 128 * 1024,
  maxResourceEntries: 256,
  maxSelectedSkills: 4,
} as const;

export const FD_MANAGED_SKILL_IDENTITIES = new Set([
  "company-data-quality",
  "company-database-query",
  "company-knowledge-helper",
  "company-report-writing",
  "fd-presentation-studio",
]);

export type NativeSkillScope = "project" | "user" | "managed";
export type NativeSkillSource = "agents" | "codex-compat" | "connector" | "managed";

export interface NativeSkillSummary {
  readonly name: string;
  readonly description: string;
  readonly skillPath: string;
  readonly root: string;
  readonly scope: NativeSkillScope;
  readonly source: NativeSkillSource;
  readonly references: ReadonlyArray<string>;
  readonly scripts: ReadonlyArray<string>;
  readonly assets: ReadonlyArray<string>;
}

export type NativeSkillDiagnosticCode =
  | "duplicate-identity"
  | "inaccessible-root"
  | "invalid-frontmatter"
  | "managed-collision"
  | "outside-root"
  | "oversized-file"
  | "read-failed";

export interface NativeSkillDiagnostic {
  readonly code: NativeSkillDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly skillName?: string;
}

export interface NativeSkillCatalogSnapshot {
  readonly skills: ReadonlyArray<NativeSkillSummary>;
  readonly diagnostics: ReadonlyArray<NativeSkillDiagnostic>;
}

export interface NativeSkillCatalogOptions {
  readonly projectRoot?: string;
  readonly userHome?: string;
  readonly extraRoots?: ReadonlyArray<string>;
  readonly managedRoots?: ReadonlyArray<string>;
  readonly nativeSkillsEnabled?: boolean;
  readonly managedSkillNames?: ReadonlySet<string>;
}

interface SkillRoot {
  readonly path: string;
  readonly scope: NativeSkillScope;
  readonly source: NativeSkillSource;
  readonly precedence: number;
}

interface ParsedFrontmatter {
  readonly name: string;
  readonly description: string;
}

const SKILL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/;

function isContained(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${NodePath.sep}`);
}

function diagnostic(
  code: NativeSkillDiagnosticCode,
  path: string,
  message: string,
  skillName?: string,
): NativeSkillDiagnostic {
  return { code, path, message, ...(skillName ? { skillName } : {}) };
}

function parseFrontmatter(contents: string): ParsedFrontmatter {
  if (!contents.startsWith("---\n") && !contents.startsWith("---\r\n")) {
    throw new Error("SKILL.md must start with YAML frontmatter.");
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(contents);
  if (!match) throw new Error("SKILL.md frontmatter is not terminated.");
  const raw = match[1] ?? "";
  if (Buffer.byteLength(raw, "utf8") > NATIVE_SKILL_LIMITS.maxFrontmatterBytes) {
    throw new Error("SKILL.md frontmatter exceeds the size limit.");
  }
  const parsed = parseYaml(raw, {
    maxAliasCount: 0,
    schema: "core",
    uniqueKeys: true,
  }) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("SKILL.md frontmatter must be a mapping.");
  }
  const value = parsed as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const description = typeof value.description === "string" ? value.description.trim() : "";
  if (!SKILL_NAME_PATTERN.test(name)) throw new Error("Skill name is invalid.");
  if (description.length === 0 || description.length > 4_096) {
    throw new Error("Skill description is missing or too long.");
  }
  return { name, description };
}

async function readBoundedRegularFile(filePath: string, expectedRoot: string): Promise<string> {
  const resolved = await NodeFS.realpath(filePath);
  if (!isContained(expectedRoot, resolved)) throw new Error("outside-root");
  const handle = await NodeFS.open(resolved, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("not-regular-file");
    if (stat.size > NATIVE_SKILL_LIMITS.maxSkillBytes) throw new Error("oversized-file");
    const pathStat = await NodeFS.lstat(resolved);
    if (stat.dev !== pathStat.dev || stat.ino !== pathStat.ino) {
      throw new Error("changed-during-read");
    }
    const buffer = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function listContainedResources(
  skillRoot: string,
  directoryName: "references" | "scripts" | "assets",
): Promise<ReadonlyArray<string>> {
  const directory = NodePath.join(skillRoot, directoryName);
  let resolvedDirectory: string;
  try {
    resolvedDirectory = await NodeFS.realpath(directory);
  } catch {
    return [];
  }
  if (!isContained(skillRoot, resolvedDirectory)) return [];

  const resources: string[] = [];
  const pending = [resolvedDirectory];
  while (pending.length > 0 && resources.length < NATIVE_SKILL_LIMITS.maxResourceEntries) {
    const current = pending.shift()!;
    let entries: Array<import("node:fs").Dirent<string>>;
    try {
      entries = await NodeFS.readdir(current, { withFileTypes: true, encoding: "utf8" });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (resources.length >= NATIVE_SKILL_LIMITS.maxResourceEntries) break;
      const unresolved = NodePath.join(current, entry.name);
      let resolved: string;
      try {
        resolved = await NodeFS.realpath(unresolved);
      } catch {
        continue;
      }
      if (!isContained(skillRoot, resolved)) continue;
      const stat = await NodeFS.stat(resolved).catch(() => undefined);
      if (stat?.isDirectory()) pending.push(resolved);
      else if (stat?.isFile()) resources.push(NodePath.relative(skillRoot, resolved));
    }
  }
  return resources.sort((left, right) => left.localeCompare(right));
}

function configuredRoots(options: NativeSkillCatalogOptions): ReadonlyArray<SkillRoot> {
  const userHome = options.userHome ?? NodeOS.homedir();
  const roots: SkillRoot[] = [
    {
      path: NodePath.join(userHome, ".codex", "skills"),
      scope: "user",
      source: "codex-compat",
      precedence: 0,
    },
    {
      path: NodePath.join(userHome, ".agents", "skills"),
      scope: "user",
      source: "agents",
      precedence: 1,
    },
  ];
  if (options.projectRoot) {
    roots.push(
      {
        path: NodePath.join(options.projectRoot, ".codex", "skills"),
        scope: "project",
        source: "codex-compat",
        precedence: 2,
      },
      {
        path: NodePath.join(options.projectRoot, ".agents", "skills"),
        scope: "project",
        source: "agents",
        precedence: 3,
      },
    );
  }
  for (const [index, rootPath] of (options.extraRoots ?? []).entries()) {
    roots.push({
      path: rootPath,
      scope: "user",
      source: "connector",
      precedence: 4 + index,
    });
  }
  for (const [index, rootPath] of (options.managedRoots ?? []).entries()) {
    roots.push({
      path: rootPath,
      scope: "managed",
      source: "managed",
      precedence: -100 + index,
    });
  }
  return roots;
}

export class NativeSkillCatalog {
  readonly #options: NativeSkillCatalogOptions;
  #snapshot: NativeSkillCatalogSnapshot = { skills: [], diagnostics: [] };

  constructor(options: NativeSkillCatalogOptions = {}) {
    this.#options = options;
  }

  get snapshot(): NativeSkillCatalogSnapshot {
    return this.#snapshot;
  }

  async refresh(): Promise<NativeSkillCatalogSnapshot> {
    if (this.#options.nativeSkillsEnabled === false) {
      this.#snapshot = { skills: [], diagnostics: [] };
      return this.#snapshot;
    }

    const diagnostics: NativeSkillDiagnostic[] = [];
    const selected = new Map<string, NativeSkillSummary & { readonly precedence: number }>();
    const managedNames = this.#options.managedSkillNames ?? FD_MANAGED_SKILL_IDENTITIES;

    for (const root of configuredRoots(this.#options)) {
      let resolvedRoot: string;
      try {
        resolvedRoot = await NodeFS.realpath(root.path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          diagnostics.push(
            diagnostic("inaccessible-root", root.path, "Skill root could not be accessed."),
          );
        }
        continue;
      }

      let entries: Array<import("node:fs").Dirent<string>>;
      try {
        entries = await NodeFS.readdir(resolvedRoot, { withFileTypes: true, encoding: "utf8" });
      } catch {
        diagnostics.push(
          diagnostic("inaccessible-root", root.path, "Skill root could not be listed."),
        );
        continue;
      }

      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const candidateRoot = NodePath.join(resolvedRoot, entry.name);
        let skillRoot: string;
        try {
          skillRoot = await NodeFS.realpath(candidateRoot);
        } catch {
          diagnostics.push(
            diagnostic("read-failed", candidateRoot, "Skill directory is unavailable."),
          );
          continue;
        }
        if (!isContained(resolvedRoot, skillRoot)) {
          diagnostics.push(
            diagnostic("outside-root", candidateRoot, "Skill escapes its source root."),
          );
          continue;
        }
        const skillPath = NodePath.join(skillRoot, "SKILL.md");
        let contents: string;
        try {
          contents = await readBoundedRegularFile(skillPath, skillRoot);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "read-failed";
          diagnostics.push(
            diagnostic(
              reason === "oversized-file"
                ? "oversized-file"
                : reason === "outside-root"
                  ? "outside-root"
                  : "read-failed",
              skillPath,
              reason === "oversized-file"
                ? "SKILL.md exceeds the size limit."
                : "SKILL.md could not be read safely.",
            ),
          );
          continue;
        }

        let parsed: ParsedFrontmatter;
        try {
          parsed = parseFrontmatter(contents);
        } catch {
          diagnostics.push(
            diagnostic("invalid-frontmatter", skillPath, "SKILL.md frontmatter is invalid."),
          );
          continue;
        }
        if (managedNames.has(parsed.name) && root.source !== "managed") {
          diagnostics.push(
            diagnostic(
              "managed-collision",
              skillPath,
              "A managed FD capability owns this Skill identity.",
              parsed.name,
            ),
          );
          continue;
        }

        const summary = {
          name: parsed.name,
          description: parsed.description,
          skillPath,
          root: skillRoot,
          scope: root.scope,
          source: root.source,
          references: await listContainedResources(skillRoot, "references"),
          scripts: await listContainedResources(skillRoot, "scripts"),
          assets: await listContainedResources(skillRoot, "assets"),
          precedence: root.precedence,
        } as const;
        const previous = selected.get(parsed.name);
        if (previous) {
          const winner = previous.precedence > summary.precedence ? previous : summary;
          const loser = winner === previous ? summary : previous;
          diagnostics.push(
            diagnostic(
              "duplicate-identity",
              loser.skillPath,
              `Skill identity is shadowed by ${winner.scope}/${winner.source}.`,
              parsed.name,
            ),
          );
          selected.set(parsed.name, winner);
        } else {
          selected.set(parsed.name, summary);
        }
      }
    }

    this.#snapshot = {
      skills: [...selected.values()]
        .map(({ precedence: _precedence, ...skill }) => skill)
        .sort((left, right) => left.name.localeCompare(right.name)),
      diagnostics,
    };
    return this.#snapshot;
  }

  async loadSelected(names: ReadonlyArray<string>): Promise<ReadonlyArray<string>> {
    const uniqueNames = [...new Set(names)].slice(0, NATIVE_SKILL_LIMITS.maxSelectedSkills);
    const byName = new Map(this.#snapshot.skills.map((skill) => [skill.name, skill] as const));
    const instructions: string[] = [];
    let instructionBytes = 0;
    for (const name of uniqueNames) {
      const skill = byName.get(name);
      if (!skill) continue;
      const contents = await readBoundedRegularFile(skill.skillPath, skill.root);
      instructionBytes += Buffer.byteLength(contents, "utf8");
      if (instructionBytes > NATIVE_SKILL_LIMITS.maxSelectedInstructionBytes) {
        throw new Error("selected-skill-instructions-too-large");
      }
      instructions.push(contents);
    }
    return instructions;
  }
}

export function selectedNativeSkillNames(input: string): ReadonlyArray<string> {
  const names: string[] = [];
  const matches = input.matchAll(/(?:^|\s)\$([a-zA-Z][a-zA-Z0-9_-]{0,127})(?=\s|$)/g);
  for (const match of matches) {
    const name = match[1];
    if (name && !names.includes(name)) names.push(name);
    if (names.length >= NATIVE_SKILL_LIMITS.maxSelectedSkills) break;
  }
  return names;
}
