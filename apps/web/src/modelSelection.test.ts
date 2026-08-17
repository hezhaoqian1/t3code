import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import {
  FD_RUNTIME_DEFAULT_MODEL,
  FD_RUNTIME_PRO_MODEL,
} from "@t3tools/contracts/fd/runtime-credentials";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import { describe, expect, it } from "vite-plus/test";

import { resolveAppModelSelection, resolveAppModelSelectionForInstance } from "./modelSelection";

const settings = {} as UnifiedSettings;
const fdProvider = {
  instanceId: ProviderInstanceId.make("fd-deepseek"),
  driver: ProviderDriverKind.make("fd-deepseek"),
  enabled: true,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-08-17T00:00:00.000Z",
  models: [
    {
      slug: FD_RUNTIME_DEFAULT_MODEL,
      name: "DeepSeek V4 Flash",
      shortName: "V4 Flash",
      isCustom: false,
      isDefault: true,
      capabilities: { optionDescriptors: [] },
    },
    {
      slug: FD_RUNTIME_PRO_MODEL,
      name: "DeepSeek V4 Pro",
      shortName: "V4 Pro",
      isCustom: false,
      isDefault: false,
      capabilities: { optionDescriptors: [] },
    },
  ],
  slashCommands: [],
  skills: [],
} satisfies ServerProvider;

describe("modelSelection", () => {
  it("preserves an explicitly requested Pro model advertised by the FD provider", () => {
    expect(
      resolveAppModelSelection(fdProvider.driver, settings, [fdProvider], FD_RUNTIME_PRO_MODEL),
    ).toBe(FD_RUNTIME_PRO_MODEL);
  });

  it("keeps Flash as the default and rejects unadvertised or arbitrary models", () => {
    expect(resolveAppModelSelection(fdProvider.driver, settings, [fdProvider], null)).toBe(
      FD_RUNTIME_DEFAULT_MODEL,
    );
    expect(resolveAppModelSelection(fdProvider.driver, settings, [fdProvider], "other-model")).toBe(
      FD_RUNTIME_DEFAULT_MODEL,
    );
    expect(
      resolveAppModelSelection(
        fdProvider.driver,
        settings,
        [{ ...fdProvider, models: [] }],
        FD_RUNTIME_PRO_MODEL,
      ),
    ).toBe(FD_RUNTIME_DEFAULT_MODEL);
  });

  it("resolves models only for the fixed FD provider instance", () => {
    expect(
      resolveAppModelSelectionForInstance(
        ProviderInstanceId.make("fd-deepseek"),
        settings,
        [fdProvider],
        FD_RUNTIME_PRO_MODEL,
      ),
    ).toBe(FD_RUNTIME_PRO_MODEL);
    expect(
      resolveAppModelSelectionForInstance(
        ProviderInstanceId.make("other"),
        settings,
        [fdProvider],
        FD_RUNTIME_PRO_MODEL,
      ),
    ).toBeNull();
  });
});
