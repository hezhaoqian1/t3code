// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import type { PresentationArtifactDescriptor } from "@t3tools/contracts";

const MAX_DEPTH = 5;
const MAX_RESULTS = 8;
const IGNORED = new Set([".git", "node_modules", ".cache", "dist", "build"]);

function stableId(projectPath: string): string {
  return `presentation-${NodeCrypto.createHash("sha256").update(projectPath).digest("hex").slice(0, 20)}`;
}

function versionFromManifest(text: string): number {
  const match = text.match(/^version:\s*v?(\d+)\s*$/m);
  const version = match ? Number.parseInt(match[1]!, 10) : 1;
  return Number.isSafeInteger(version) && version > 0 ? version : 1;
}

async function walk(root: string, depth: number, manifests: string[]): Promise<void> {
  if (depth > MAX_DEPTH || manifests.length >= MAX_RESULTS) return;
  let entries: Array<{
    readonly name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }>;
  try {
    entries = await NodeFSP.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (manifests.length >= MAX_RESULTS || IGNORED.has(entry.name)) break;
    const candidate = NodePath.join(root, entry.name);
    if (entry.isDirectory()) {
      await walk(candidate, depth + 1, manifests);
    } else if (entry.isFile() && entry.name.endsWith(".pptd")) {
      manifests.push(candidate);
    }
  }
}

function pageCountFromManifest(text: string): number {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const header = lines.findIndex((line) => /^pages\s*:\s*$/.test(line.trim()));
  if (header < 0) return 0;
  let count = 0;
  for (const line of lines.slice(header + 1)) {
    if (/^[ \t]*-[ \t]+\S/.test(line)) {
      count += 1;
      continue;
    }
    if (line.trim().length > 0 && !/^[ \t]+/.test(line)) break;
  }
  return count;
}

export async function discoverPresentationArtifacts(input: {
  readonly cwd: string;
  readonly operation: "create" | "revise";
  readonly artifactId?: string;
}): Promise<ReadonlyArray<PresentationArtifactDescriptor>> {
  const root = NodePath.resolve(input.cwd);
  const manifests: string[] = [];
  await walk(root, 0, manifests);
  const results: PresentationArtifactDescriptor[] = [];
  for (const pptdPath of manifests) {
    try {
      const stat = await NodeFSP.stat(pptdPath);
      const text = await NodeFSP.readFile(pptdPath, "utf8");
      const pageCount = pageCountFromManifest(text);
      if (pageCount < 1) continue;
      const version = versionFromManifest(text);
      const projectPath = NodePath.dirname(pptdPath);
      const base = NodePath.basename(pptdPath, ".pptd");
      const pptxCandidate = NodePath.join(projectPath, `${base}.pptx`);
      const previewCandidates = [
        NodePath.join(projectPath, ".qa-images", "pages", "1.jpeg"),
        NodePath.join(projectPath, ".qa-images", "pages", "1.png"),
        NodePath.join(projectPath, "preview.png"),
      ];
      const previewPath = (await Promise.any(
        previewCandidates.map(async (candidate) => {
          await NodeFSP.access(candidate);
          return candidate;
        }),
      ).catch(() => undefined)) as string | undefined;
      const pptxPath = await NodeFSP.access(pptxCandidate)
        .then(() => pptxCandidate)
        .catch(() => undefined);
      const updatedAt = stat.mtime.toISOString();
      results.push({
        id: stableId(projectPath),
        label: base.replace(/[-_]+/g, " ").trim() || "演示文稿",
        projectPath,
        pptdPath,
        ...(pptxPath ? { pptxPath } : {}),
        ...(previewPath ? { previewPath } : {}),
        pageCount,
        version,
        operation: input.operation,
        updatedAt,
      });
    } catch {
      // A partially written project should not make the whole turn fail.
    }
  }
  const filtered = input.artifactId
    ? results.filter((artifact) => artifact.id === input.artifactId)
    : results;
  return filtered
    .toSorted((left, right) => {
      const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
      // Filesystems commonly expose coarse mtime precision. Keep target
      // selection deterministic when two projects share the same timestamp.
      return byUpdatedAt !== 0 ? byUpdatedAt : right.projectPath.localeCompare(left.projectPath);
    })
    .slice(0, 1);
}
