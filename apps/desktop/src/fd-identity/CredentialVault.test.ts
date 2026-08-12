// @effect-diagnostics nodeBuiltinImport:off
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  CredentialVault,
  CredentialVaultCorruptError,
  MAX_PENDING_FD_REVOCATIONS,
  MAX_VAULT_ENVELOPE_BYTES,
  SecureStorageUnavailableError,
  type LocalKeyProtector,
  type StoredFdVaultState,
} from "./CredentialVault.ts";
import { ElectronSafeStorageAdapter } from "./ElectronSafeStorageAdapter.ts";

const roots = new Set<string>();

afterEach(async () => {
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
  roots.clear();
});

describe("CredentialVault", () => {
  it("roundtrips encrypted active credentials and pending revocations with 0600 files", async () => {
    const root = await temporaryRoot();
    const vault = new CredentialVault(root, new TestProtector());
    const state = vaultState();
    await vault.save(state);

    const persisted = await Promise.all(
      (await readdir(root)).map((file) => readFile(join(root, file), "utf8")),
    );
    expect(persisted.join("\n")).not.toContain("access-secret");
    expect(persisted.join("\n")).not.toContain("refresh-secret");
    expect(persisted.join("\n")).not.toContain("sk-runtime-secret");
    expect(await vault.load()).toEqual(state);
    expect((await stat(join(root, "account.v1.json"))).mode & 0o777).toBe(0o600);
  });

  it("rejects corruption and oversized encrypted files", async () => {
    const root = await temporaryRoot();
    const vault = new CredentialVault(root, new TestProtector());
    await vault.save(vaultState());
    const path = join(root, "account.v1.json");
    const envelope = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    envelope.authTag = Buffer.alloc(4).toString("base64");
    await writeFile(path, JSON.stringify(envelope));
    await expect(vault.load()).rejects.toBeInstanceOf(CredentialVaultCorruptError);

    await writeFile(path, Buffer.alloc(MAX_VAULT_ENVELOPE_BYTES + 1));
    await expect(vault.load()).rejects.toBeInstanceOf(CredentialVaultCorruptError);
  });

  it("roundtrips the maximum pending queue within the separate plaintext/envelope bounds", async () => {
    const root = await temporaryRoot();
    const vault = new CredentialVault(root, new TestProtector());
    const secret = "s".repeat(16_384);
    const state: StoredFdVaultState = {
      ...vaultState(),
      pendingRevocations: Array.from({ length: MAX_PENDING_FD_REVOCATIONS }, (_, index) => ({
        userId: index + 1,
        accessToken: secret,
        accessExpiresAt: 2_000_000_000,
        sessionId: `session-${index}`,
        refreshCookie: secret,
        runtimeTokenName: `FD AI Desktop device${String(index).padStart(2, "0")}`,
        tokensRevoked: false,
      })),
    };

    await vault.save(state);

    expect(await vault.load()).toEqual(state);
    expect((await stat(join(root, "account.v1.json"))).size).toBeLessThanOrEqual(
      MAX_VAULT_ENVELOPE_BYTES,
    );
  });

  it("rejects symlinked credential and device files before reading", async () => {
    const root = await temporaryRoot();
    await mkdir(root, { recursive: true });
    const target = join(root, "outside.json");
    await writeFile(target, "{}", { mode: 0o600 });
    await symlink(target, join(root, "account.v1.json"));
    const vault = new CredentialVault(root, new TestProtector());
    await expect(vault.load()).rejects.toBeInstanceOf(CredentialVaultCorruptError);

    await rm(join(root, "account.v1.json"));
    await symlink(target, join(root, "device.v1.json"));
    await expect(vault.load()).rejects.toBeInstanceOf(CredentialVaultCorruptError);
  });

  it("fails closed when safeStorage is unavailable", async () => {
    const root = await temporaryRoot();
    const vault = new CredentialVault(root, new TestProtector(false));
    await expect(vault.load()).rejects.toBeInstanceOf(SecureStorageUnavailableError);
    await expect(vault.save(vaultState())).rejects.toBeInstanceOf(SecureStorageUnavailableError);
  });

  it("roundtrips, protects, and validates the revocation intent tombstone", async () => {
    const root = await temporaryRoot();
    const vault = new CredentialVault(root, new TestProtector());
    const path = join(root, "revocation-intent.v1");

    expect(await vault.hasRevocationIntent()).toBe(false);
    await vault.markRevocationIntent();
    expect(await vault.hasRevocationIntent()).toBe(true);
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    await writeFile(path, "invalid-revocation-intent\n");
    await expect(vault.hasRevocationIntent()).rejects.toBeInstanceOf(CredentialVaultCorruptError);

    await vault.clearRevocationIntent();
    expect(await vault.hasRevocationIntent()).toBe(false);
  });
});

describe("ElectronSafeStorageAdapter", () => {
  it("delegates availability and key wrapping without retaining plaintext", () => {
    const adapter = new ElectronSafeStorageAdapter({
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`wrapped:${value}`),
      decryptString: (value) => value.toString("utf8").slice("wrapped:".length),
    });
    const wrapped = adapter.protect("key-material");
    expect(adapter.isAvailable()).toBe(true);
    expect(wrapped.toString("utf8")).toBe("wrapped:key-material");
    expect(adapter.unprotect(wrapped)).toBe("key-material");
  });
});

class TestProtector implements LocalKeyProtector {
  readonly #available: boolean;
  constructor(available = true) {
    this.#available = available;
  }
  isAvailable(): boolean {
    return this.#available;
  }
  protect(value: string): Buffer {
    return Buffer.from(`protected:${value}`);
  }
  unprotect(value: Buffer): string {
    const decoded = value.toString("utf8");
    if (!decoded.startsWith("protected:")) throw new Error("invalid protected key");
    return decoded.slice("protected:".length);
  }
}

function vaultState(): StoredFdVaultState {
  return {
    active: {
      user: { id: 31, username: "employee", displayName: "Employee" },
      accessToken: "access-secret",
      accessExpiresAt: 2_000_000_000,
      sessionId: "session-id",
      refreshCookie: "new_api_refresh=refresh-secret",
      runtimeApiKey: "sk-runtime-secret",
      runtimeTokenId: 41,
      runtimeTokenName: "FD AI Desktop 100000000000",
    },
    pendingRevocations: [
      {
        userId: 29,
        accessToken: "old-access-secret",
        accessExpiresAt: 1_999_999_999,
        sessionId: "old-session-id",
        refreshCookie: "new_api_refresh=old-refresh-secret",
        runtimeTokenName: "FD AI Desktop old-device",
        tokensRevoked: false,
      },
    ],
  };
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fd-identity-vault-"));
  await rm(root, { recursive: true, force: true });
  roots.add(root);
  return root;
}
