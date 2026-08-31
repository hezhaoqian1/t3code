// @effect-diagnostics nodeBuiltinImport:off,globalDate:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { PresentationCapabilityManifest } from "@t3tools/contracts";

export const FD_PRESENTATION_SKILL_NAME = "fd-presentation-studio";
export const FD_PRESENTATION_SKILL_DESCRIPTION = "制作可编辑的方德风格演示文稿";
export const FD_PRESENTATION_DEFAULT_MANIFEST: PresentationCapabilityManifest = {
  id: FD_PRESENTATION_SKILL_NAME,
  version: "1.0.0",
  skillRoot: FD_PRESENTATION_SKILL_NAME,
  sha256: "",
  maxPackageBytes: 64 * 1024 * 1024,
};

export interface PresentationCapabilityOptions {
  readonly packagedRoot?: string;
  readonly cacheRoot?: string;
  readonly manifest?: Partial<PresentationCapabilityManifest>;
  readonly requireSignature?: boolean;
}

export interface ResolvedPresentationCapability {
  readonly id: typeof FD_PRESENTATION_SKILL_NAME;
  readonly version: string;
  readonly root: string;
  readonly skillPath: string;
  readonly manifestPath: string;
  readonly source: "packaged" | "cache";
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function contained(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${NodePath.sep}`);
}

function safeRoot(root: string, candidate: string): string {
  const resolvedRoot = NodePath.resolve(root);
  const resolvedCandidate = NodePath.resolve(candidate);
  if (!contained(resolvedRoot, resolvedCandidate))
    throw new Error("presentation-path-outside-root");
  return resolvedCandidate;
}

export function validatePresentationManifest(input: unknown): PresentationCapabilityManifest {
  if (!input || typeof input !== "object") throw new Error("presentation-manifest-invalid");
  const value = input as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id : "";
  const version = typeof value.version === "string" ? value.version : "";
  const skillRoot = typeof value.skillRoot === "string" ? value.skillRoot : "";
  const sha256 = typeof value.sha256 === "string" ? value.sha256.toLowerCase() : "";
  const maxPackageBytes = typeof value.maxPackageBytes === "number" ? value.maxPackageBytes : 0;
  if (id !== FD_PRESENTATION_SKILL_NAME || !VERSION_PATTERN.test(version)) {
    throw new Error("presentation-manifest-identity-invalid");
  }
  if (!skillRoot || NodePath.isAbsolute(skillRoot) || skillRoot.includes("..")) {
    throw new Error("presentation-manifest-path-invalid");
  }
  if (!/^[a-f0-9]{64}$/.test(sha256) && sha256 !== "") {
    throw new Error("presentation-manifest-hash-invalid");
  }
  if (
    !Number.isSafeInteger(maxPackageBytes) ||
    maxPackageBytes <= 0 ||
    maxPackageBytes > 256 * 1024 * 1024
  ) {
    throw new Error("presentation-manifest-size-invalid");
  }
  const signature = typeof value.signature === "string" ? value.signature : undefined;
  const publicKey = typeof value.publicKey === "string" ? value.publicKey : undefined;
  if ((signature && !publicKey) || (!signature && publicKey)) {
    throw new Error("presentation-manifest-signature-incomplete");
  }
  return {
    id,
    version,
    skillRoot,
    sha256,
    maxPackageBytes,
    ...(signature && publicKey ? { signature, publicKey } : {}),
  };
}

async function hashDirectory(root: string, maxBytes: number): Promise<string> {
  const hash = NodeCrypto.createHash("sha256");
  let total = 0;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.shift()!;
    const entries = await NodeFS.readdir(current, { withFileTypes: true, encoding: "utf8" });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = safeRoot(root, NodePath.join(current, entry.name));
      const stat = await NodeFS.stat(file);
      if (stat.isDirectory()) {
        pending.push(file);
        continue;
      }
      if (!stat.isFile()) continue;
      total += stat.size;
      if (total > maxBytes) throw new Error("presentation-package-too-large");
      hash.update(NodePath.relative(root, file));
      hash.update(await NodeFS.readFile(file));
    }
  }
  return hash.digest("hex");
}

function canonicalManifest(manifest: PresentationCapabilityManifest): string {
  return JSON.stringify({
    id: manifest.id,
    version: manifest.version,
    skillRoot: manifest.skillRoot,
    sha256: manifest.sha256,
    maxPackageBytes: manifest.maxPackageBytes,
  });
}

function verifyManifestSignature(manifest: PresentationCapabilityManifest): boolean {
  if (!manifest.signature || !manifest.publicKey) return false;
  try {
    return NodeCrypto.verify(
      null,
      Buffer.from(canonicalManifest(manifest)),
      manifest.publicKey,
      Buffer.from(manifest.signature, "base64"),
    );
  } catch {
    return false;
  }
}

async function readManifest(root: string, override?: Partial<PresentationCapabilityManifest>) {
  const manifestPath = safeRoot(root, NodePath.join(root, "manifest.json"));
  const parsed = JSON.parse(await NodeFS.readFile(manifestPath, "utf8")) as unknown;
  return validatePresentationManifest({
    ...(parsed as Record<string, unknown>),
    ...(override ?? {}),
  });
}

export async function resolvePresentationCapability(
  options: PresentationCapabilityOptions = {},
): Promise<ResolvedPresentationCapability> {
  const packagedRoot = options.packagedRoot;
  const cacheRoot =
    options.cacheRoot ??
    NodePath.join(NodeOS.homedir(), ".fangde-ai", "capabilities", FD_PRESENTATION_SKILL_NAME);
  const candidates: Array<{ root: string; source: "packaged" | "cache" }> = [];
  if (packagedRoot) candidates.push({ root: packagedRoot, source: "packaged" });
  candidates.push({ root: cacheRoot, source: "cache" });
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const manifest = await readManifest(candidate.root, options.manifest);
      const skillRoot = safeRoot(candidate.root, NodePath.join(candidate.root, manifest.skillRoot));
      const skillPath = safeRoot(skillRoot, NodePath.join(skillRoot, "SKILL.md"));
      const stat = await NodeFS.stat(skillPath);
      if (!stat.isFile()) throw new Error("presentation-skill-missing");
      if (manifest.sha256) {
        const actual = await hashDirectory(skillRoot, manifest.maxPackageBytes);
        if (actual !== manifest.sha256) throw new Error("presentation-package-hash-mismatch");
      }
      if (manifest.signature && !verifyManifestSignature(manifest)) {
        throw new Error("presentation-manifest-signature-invalid");
      }
      return {
        id: FD_PRESENTATION_SKILL_NAME,
        version: manifest.version,
        root: skillRoot,
        skillPath,
        manifestPath: NodePath.join(candidate.root, "manifest.json"),
        source: candidate.source,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("presentation-capability-unavailable");
}

export async function installPresentationCapability(input: {
  readonly packageRoot: string;
  readonly cacheRoot: string;
  readonly manifest?: Partial<PresentationCapabilityManifest>;
  readonly requireSignature?: boolean;
}): Promise<ResolvedPresentationCapability> {
  const manifest = await readManifest(input.packageRoot, input.manifest);
  const destination = NodePath.resolve(input.cacheRoot);
  const parent = NodePath.dirname(destination);
  await NodeFS.mkdir(parent, { recursive: true });
  const staging = `${destination}.staging-${process.pid}-${process.hrtime.bigint().toString()}`;
  await NodeFS.rm(staging, { recursive: true, force: true });
  await NodeFS.cp(input.packageRoot, staging, { recursive: true, errorOnExist: false });
  try {
    const actual = await hashDirectory(
      NodePath.join(staging, manifest.skillRoot),
      manifest.maxPackageBytes,
    );
    if (manifest.sha256 && actual !== manifest.sha256)
      throw new Error("presentation-package-hash-mismatch");
    if (manifest.signature && !verifyManifestSignature(manifest))
      throw new Error("presentation-manifest-signature-invalid");
    const backup = `${destination}.previous`;
    await NodeFS.rm(backup, { recursive: true, force: true });
    try {
      await NodeFS.rename(destination, backup);
    } catch {
      /* first install */
    }
    try {
      await NodeFS.rename(staging, destination);
    } catch (error) {
      try {
        await NodeFS.rename(backup, destination);
      } catch {
        /* preserve original failure */
      }
      throw error;
    }
    await NodeFS.rm(backup, { recursive: true, force: true });
  } catch (error) {
    await NodeFS.rm(staging, { recursive: true, force: true });
    throw error;
  }
  return resolvePresentationCapability({ cacheRoot: destination });
}
