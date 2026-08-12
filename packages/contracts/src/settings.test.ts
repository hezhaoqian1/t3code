import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { DEFAULT_SERVER_SETTINGS, ServerSettings, ServerSettingsPatch } from "./settings.ts";

describe("FD server settings", () => {
  it("does not expose provider, model, credential, or update settings", () => {
    expect("providers" in DEFAULT_SERVER_SETTINGS).toBe(false);
    expect("providerInstances" in DEFAULT_SERVER_SETTINGS).toBe(false);
    expect("textGenerationModelSelection" in DEFAULT_SERVER_SETTINGS).toBe(false);
    expect("enableProviderUpdateChecks" in DEFAULT_SERVER_SETTINGS).toBe(false);
    expect("sourceControlWriterModelSelection" in DEFAULT_SERVER_SETTINGS).toBe(false);
  });

  it("drops retired provider settings from persisted input", () => {
    const decoded = Schema.decodeUnknownSync(ServerSettings)({
      providers: { codex: { binaryPath: "private" } },
      providerInstances: { custom: { driver: "codex" } },
      textGenerationModelSelection: { instanceId: "codex", model: "other" },
      runtimeApiKey: "private",
      enableProviderUpdateChecks: true,
    });
    expect("providers" in decoded).toBe(false);
    expect("providerInstances" in decoded).toBe(false);
    expect("textGenerationModelSelection" in decoded).toBe(false);
    expect("runtimeApiKey" in decoded).toBe(false);
    expect("enableProviderUpdateChecks" in decoded).toBe(false);
  });

  it("does not accept model/provider fields in settings patches", () => {
    const decoded = Schema.decodeUnknownSync(ServerSettingsPatch)({
      textGenerationModelSelection: { instanceId: "codex", model: "other" },
      providers: { codex: { enabled: true } },
      providerInstances: { custom: { driver: "codex" } },
    });
    expect(decoded).toEqual({});
  });
});
