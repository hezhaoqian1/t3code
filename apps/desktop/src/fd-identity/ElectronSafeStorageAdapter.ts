import type { LocalKeyProtector } from "./CredentialVault.ts";

export interface ElectronSafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class ElectronSafeStorageAdapter implements LocalKeyProtector {
  readonly #safeStorage: ElectronSafeStorageLike;

  constructor(safeStorage: ElectronSafeStorageLike) {
    this.#safeStorage = safeStorage;
  }

  isAvailable(): boolean {
    return this.#safeStorage.isEncryptionAvailable();
  }

  protect(value: string): Buffer {
    return this.#safeStorage.encryptString(value);
  }

  unprotect(value: Buffer): string {
    return this.#safeStorage.decryptString(value);
  }
}
