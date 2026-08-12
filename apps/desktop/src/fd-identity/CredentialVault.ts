// @effect-diagnostics nodeBuiltinImport:off
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { FdAccountUserSummary } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const VAULT_VERSION = 1;
const KEY_VERSION = 1;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
export const MAX_VAULT_PLAINTEXT_BYTES = 640 * 1_024;
export const MAX_VAULT_ENVELOPE_BYTES = 896 * 1_024;
const MAX_VAULT_METADATA_BYTES = 4 * 1_024;
export const MAX_PENDING_FD_REVOCATIONS = 16;
const REVOCATION_INTENT_CONTENT = Buffer.from("fd-revocation-pending-v1\n", "utf8");
const strict = { parseOptions: { onExcessProperty: "error" as const } };

const Secret = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(16_384));
const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const RuntimeTokenName = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(50));

export const StoredFdCredentials = Schema.Struct({
  user: FdAccountUserSummary,
  accessToken: Secret,
  accessExpiresAt: PositiveInt,
  sessionId: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(128)),
  refreshCookie: Secret,
  runtimeApiKey: Secret,
  runtimeTokenId: PositiveInt,
  runtimeTokenName: RuntimeTokenName,
}).annotate(strict);
export type StoredFdCredentials = typeof StoredFdCredentials.Type;

export const PendingFdRevocation = Schema.Struct({
  userId: PositiveInt,
  accessToken: Secret,
  accessExpiresAt: PositiveInt,
  sessionId: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(128)),
  refreshCookie: Secret,
  runtimeTokenName: RuntimeTokenName,
  tokensRevoked: Schema.Boolean,
}).annotate(strict);
export type PendingFdRevocation = typeof PendingFdRevocation.Type;

export const StoredFdVaultState = Schema.Struct({
  active: Schema.NullOr(StoredFdCredentials),
  pendingRevocations: Schema.Array(PendingFdRevocation).check(
    Schema.isMaxLength(MAX_PENDING_FD_REVOCATIONS),
  ),
}).annotate(strict);
export type StoredFdVaultState = typeof StoredFdVaultState.Type;

const DeviceIdentity = Schema.Struct({
  version: Schema.Literal(VAULT_VERSION),
  deviceId: Schema.String.check(Schema.isPattern(/^[0-9a-f-]{36}$/i)),
}).annotate(strict);

const CredentialEnvelope = Schema.Struct({
  version: Schema.Literal(VAULT_VERSION),
  keyVersion: Schema.Literal(KEY_VERSION),
  protectedKey: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(4_096)),
  nonce: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(64)),
  ciphertext: Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(Math.ceil(MAX_VAULT_PLAINTEXT_BYTES / 3) * 4),
  ),
  authTag: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(64)),
}).annotate(strict);

const decodeState = Schema.decodeUnknownSync(StoredFdVaultState);
const decodeIdentity = Schema.decodeUnknownSync(DeviceIdentity);
const decodeEnvelope = Schema.decodeUnknownSync(CredentialEnvelope);

export interface LocalKeyProtector {
  isAvailable(): boolean;
  protect(value: string): Buffer;
  unprotect(value: Buffer): string;
}

export class SecureStorageUnavailableError extends Error {
  constructor() {
    super("Secure credential storage is unavailable");
    this.name = "SecureStorageUnavailableError";
  }
}

export class CredentialVaultCorruptError extends Error {
  constructor() {
    super("Stored credentials cannot be decrypted");
    this.name = "CredentialVaultCorruptError";
  }
}

export class CredentialVault {
  readonly #root: string;
  readonly #protector: LocalKeyProtector;

  constructor(root: string, protector: LocalKeyProtector) {
    this.#root = root;
    this.#protector = protector;
  }

  async load(): Promise<StoredFdVaultState> {
    this.#assertAvailable();
    const [envelopeBytes, deviceId] = await Promise.all([
      readOptionalBoundedFile(this.#credentialPath(), MAX_VAULT_ENVELOPE_BYTES),
      this.#readOrCreateDeviceId(),
    ]);
    if (!envelopeBytes) return { active: null, pendingRevocations: [] };

    let key: Buffer | undefined;
    let plaintext: Buffer | undefined;
    let ciphertext: Buffer | undefined;
    try {
      const envelope = decodeEnvelope(JSON.parse(envelopeBytes.toString("utf8")));
      const nonce = decodeExactBase64(envelope.nonce, NONCE_BYTES);
      const authTag = decodeExactBase64(envelope.authTag, AUTH_TAG_BYTES);
      key = decodeExactBase64(
        this.#protector.unprotect(Buffer.from(envelope.protectedKey, "base64")),
        KEY_BYTES,
      );
      ciphertext = decodeBoundedBase64(envelope.ciphertext, MAX_VAULT_PLAINTEXT_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAAD(vaultAad(deviceId));
      decipher.setAuthTag(authTag);
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      if (plaintext.byteLength > MAX_VAULT_PLAINTEXT_BYTES) {
        throw new CredentialVaultCorruptError();
      }
      return decodeState(JSON.parse(plaintext.toString("utf8")));
    } catch (error) {
      if (error instanceof SecureStorageUnavailableError) throw error;
      throw new CredentialVaultCorruptError();
    } finally {
      key?.fill(0);
      plaintext?.fill(0);
      ciphertext?.fill(0);
    }
  }

  async save(rawState: StoredFdVaultState): Promise<void> {
    this.#assertAvailable();
    const state = decodeState(rawState);
    const deviceId = await this.#readOrCreateDeviceId();
    let key: Buffer | undefined;
    let plaintext: Buffer | undefined;
    try {
      key = randomBytes(KEY_BYTES);
      plaintext = Buffer.from(JSON.stringify(state), "utf8");
      if (plaintext.byteLength > MAX_VAULT_PLAINTEXT_BYTES) {
        throw new CredentialVaultCorruptError();
      }
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(vaultAad(deviceId));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const protectedKey = this.#protector.protect(key.toString("base64"));
      const envelope = decodeEnvelope({
        version: VAULT_VERSION,
        keyVersion: KEY_VERSION,
        protectedKey: protectedKey.toString("base64"),
        nonce: nonce.toString("base64"),
        ciphertext: ciphertext.toString("base64"),
        authTag: cipher.getAuthTag().toString("base64"),
      });
      const encodedEnvelope = Buffer.from(JSON.stringify(envelope), "utf8");
      if (encodedEnvelope.byteLength > MAX_VAULT_ENVELOPE_BYTES) {
        encodedEnvelope.fill(0);
        throw new CredentialVaultCorruptError();
      }
      await atomicWrite(this.#credentialPath(), encodedEnvelope, MAX_VAULT_ENVELOPE_BYTES);
    } finally {
      key?.fill(0);
      plaintext?.fill(0);
    }
  }

  async clear(): Promise<void> {
    await rm(this.#credentialPath(), { force: true });
    await this.clearRevocationIntent();
  }

  async markRevocationIntent(): Promise<void> {
    await atomicWrite(
      this.#revocationIntentPath(),
      REVOCATION_INTENT_CONTENT,
      MAX_VAULT_METADATA_BYTES,
    );
  }

  async hasRevocationIntent(): Promise<boolean> {
    const contents = await readOptionalBoundedFile(
      this.#revocationIntentPath(),
      MAX_VAULT_METADATA_BYTES,
    );
    if (contents === null) return false;
    if (!contents.equals(REVOCATION_INTENT_CONTENT)) throw new CredentialVaultCorruptError();
    return true;
  }

  async clearRevocationIntent(): Promise<void> {
    await rm(this.#revocationIntentPath(), { force: true });
  }

  async deviceId(): Promise<string> {
    this.#assertAvailable();
    return this.#readOrCreateDeviceId();
  }

  #assertAvailable(): void {
    if (!this.#protector.isAvailable()) throw new SecureStorageUnavailableError();
  }

  async #readOrCreateDeviceId(): Promise<string> {
    const existing = await readOptionalBoundedFile(this.#devicePath(), MAX_VAULT_METADATA_BYTES);
    if (existing) {
      try {
        return decodeIdentity(JSON.parse(existing.toString("utf8"))).deviceId;
      } catch {
        throw new CredentialVaultCorruptError();
      }
    }
    const identity = decodeIdentity({ version: VAULT_VERSION, deviceId: randomUUID() });
    await atomicWrite(
      this.#devicePath(),
      Buffer.from(JSON.stringify(identity), "utf8"),
      MAX_VAULT_METADATA_BYTES,
    );
    return identity.deviceId;
  }

  #devicePath(): string {
    return join(this.#root, "device.v1.json");
  }

  #credentialPath(): string {
    return join(this.#root, "account.v1.json");
  }

  #revocationIntentPath(): string {
    return join(this.#root, "revocation-intent.v1");
  }
}

function vaultAad(deviceId: string): Buffer {
  return Buffer.from(`fangde-ai:${VAULT_VERSION}:${deviceId}:account-vault:${KEY_VERSION}`, "utf8");
}

function decodeExactBase64(value: string, byteLength: number): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength !== byteLength || decoded.toString("base64") !== value) {
    decoded.fill(0);
    throw new CredentialVaultCorruptError();
  }
  return decoded;
}

function decodeBoundedBase64(value: string, maxBytes: number): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength > maxBytes || decoded.toString("base64") !== value) {
    decoded.fill(0);
    throw new CredentialVaultCorruptError();
  }
  return decoded;
}

async function readOptionalBoundedFile(path: string, maxBytes: number): Promise<Buffer | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const beforeOpen = await lstat(path);
    if (!beforeOpen.isFile() || beforeOpen.isSymbolicLink() || beforeOpen.size > maxBytes) {
      throw new CredentialVaultCorruptError();
    }
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > maxBytes) throw new CredentialVaultCorruptError();
    const bytes = await handle.readFile();
    if (bytes.byteLength > maxBytes) throw new CredentialVaultCorruptError();
    return bytes;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    if (isNodeError(error) && error.code === "ELOOP") throw new CredentialVaultCorruptError();
    throw error;
  } finally {
    await handle?.close();
  }
}

async function atomicWrite(path: string, contents: Buffer, maxBytes: number): Promise<void> {
  if (contents.byteLength > maxBytes) throw new CredentialVaultCorruptError();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
  try {
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
