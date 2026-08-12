// @effect-diagnostics nodeBuiltinImport:off
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";

import * as Schema from "effect/Schema";

const MAX_ENTERPRISE_CONFIG_BYTES = 4 * 1_024;
const MAX_PUBLIC_URL_LENGTH = 2_048;
export const FD_PRODUCTION_NEW_API_ORIGIN = "https://ai-api.fdsure.com";
export const FD_PRODUCTION_UPDATE_MANIFEST_URL =
  "https://ai-api.fdsure.com/downloads/desktop/latest/latest.json";

const EnterpriseConfigSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  distribution: Schema.Literal("internal"),
  newApiOrigin: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(MAX_PUBLIC_URL_LENGTH)),
  updateManifestUrl: Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(MAX_PUBLIC_URL_LENGTH),
  ),
}).annotate({ parseOptions: { onExcessProperty: "error" } });

export interface FdEnterpriseConfig {
  readonly newApiOrigin: string;
  readonly updateManifestUrl: string;
}

export async function loadFdEnterpriseConfig(input: {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly rootDir: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): Promise<FdEnterpriseConfig> {
  const configPath = input.isPackaged
    ? join(input.resourcesPath, "enterprise-config.json")
    : join(input.rootDir, "apps", "desktop", "resources", "enterprise-config.json");
  const raw = (await readBoundedRegularFile(configPath)).toString("utf8");
  const config = Schema.decodeUnknownSync(Schema.fromJsonString(EnterpriseConfigSchema))(raw);
  const publicOrigin = validatePublicHttpsUrl(config.newApiOrigin).origin;
  const publicManifest = validatePublicHttpsUrl(config.updateManifestUrl).href;
  if (
    publicOrigin !== FD_PRODUCTION_NEW_API_ORIGIN ||
    publicManifest !== FD_PRODUCTION_UPDATE_MANIFEST_URL
  ) {
    throw new Error("FD packaged enterprise endpoints do not match the immutable distribution");
  }
  const override = input.env?.FD_NEW_API_ORIGIN?.trim();
  if (override && override.length > MAX_PUBLIC_URL_LENGTH) {
    throw new Error("FD development endpoint is invalid");
  }
  return {
    newApiOrigin:
      !input.isPackaged && override
        ? validateLoopbackDevelopmentUrl(override).origin
        : publicOrigin,
    updateManifestUrl: publicManifest,
  };
}

function validatePublicHttpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.protocol !== "https:") {
    throw new Error("FD enterprise public endpoint is invalid");
  }
  return url;
}

function validateLoopbackDevelopmentUrl(value: string): URL {
  const url = new URL(value);
  const loopback =
    url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (
    !loopback ||
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("FD development endpoint is invalid");
  }
  return url;
}

async function readBoundedRegularFile(path: string): Promise<Buffer> {
  const beforeOpen = await lstat(path);
  if (
    !beforeOpen.isFile() ||
    beforeOpen.isSymbolicLink() ||
    beforeOpen.size > MAX_ENTERPRISE_CONFIG_BYTES
  ) {
    throw new Error("FD enterprise config file is invalid");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > MAX_ENTERPRISE_CONFIG_BYTES) {
      throw new Error("FD enterprise config file is invalid");
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength > MAX_ENTERPRISE_CONFIG_BYTES) {
      throw new Error("FD enterprise config file is invalid");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}
