import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import {
  hydrateCachedProvider,
  isCachedProviderCorrelated,
  readProviderStatusCache,
  resolveProviderStatusCachePath,
  writeProviderStatusCache,
} from "./providerStatusCache.ts";

const FD_DRIVER = ProviderDriverKind.make("fd-deepseek");
const FD_INSTANCE = ProviderInstanceId.make("fd-deepseek");

const makeProvider = (overrides: Partial<ServerProvider> = {}): ServerProvider => ({
  instanceId: FD_INSTANCE,
  driver: FD_DRIVER,
  displayName: "FD DeepSeek",
  enabled: true,
  status: "ready",
  auth: { status: "authenticated", type: "fd-account", label: "FD Account" },
  checkedAt: "2026-08-10T00:00:00.000Z",
  models: [
    {
      slug: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      isCustom: false,
      isDefault: true,
      capabilities: { optionDescriptors: [] },
    },
  ],
  slashCommands: [],
  skills: [],
  ...overrides,
});

it.layer(NodeServices.layer)("providerStatusCache", (it) => {
  it.effect("writes and reads the FD provider snapshot", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "fd-provider-cache-" });
      const cachePath = yield* resolveProviderStatusCachePath({
        cacheDir: tempDir,
        instanceId: FD_INSTANCE,
      });
      const provider = makeProvider();

      yield* writeProviderStatusCache({ filePath: cachePath, provider });
      assert.deepStrictEqual(yield* readProviderStatusCache(cachePath), provider);
    }),
  );

  it("hydrates volatile status while preserving the current exact model", () => {
    const cached = makeProvider({
      status: "warning",
      auth: { status: "unauthenticated", type: "fd-account", label: "FD Account" },
      checkedAt: "2026-08-09T00:00:00.000Z",
      message: "Sign in to FD to use DeepSeek.",
    });
    const fallback = makeProvider();

    const hydrated = hydrateCachedProvider({ cachedProvider: cached, fallbackProvider: fallback });
    assert.deepStrictEqual(hydrated.models, fallback.models);
    assert.strictEqual(hydrated.status, "warning");
    assert.deepStrictEqual(hydrated.auth, cached.auth);
    assert.strictEqual(hydrated.checkedAt, cached.checkedAt);
  });

  it("rejects a cache entry with a different provider identity", () => {
    const provider = makeProvider();
    const other = makeProvider({ instanceId: ProviderInstanceId.make("other") });
    assert.strictEqual(
      isCachedProviderCorrelated({ cachedProvider: other, fallbackProvider: provider }),
      false,
    );
    assert.strictEqual(
      hydrateCachedProvider({ cachedProvider: other, fallbackProvider: provider }),
      provider,
    );
  });
});
