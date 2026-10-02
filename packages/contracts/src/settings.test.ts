import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  ClientSettingsPatch,
  ClientSettingsSchema,
  DEFAULT_SERVER_SETTINGS,
  ServerSettings,
  ServerSettingsPatch,
} from "./settings.ts";

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

describe("ClientSettings chat width", () => {
  const decode = Schema.decodeUnknownSync(ClientSettingsSchema);
  const encode = Schema.encodeSync(ClientSettingsSchema);
  const decodePatch = Schema.decodeUnknownSync(ClientSettingsPatch);

  it("keeps the comfortable width for existing settings without a saved width", () => {
    expect(decode({}).chatWidth).toBe("comfortable");
  });

  it.each(["comfortable", "wide", "full"] as const)("round-trips the %s width", (chatWidth) => {
    expect(encode(decode({ chatWidth })).chatWidth).toBe(chatWidth);
    expect(decodePatch({ chatWidth }).chatWidth).toBe(chatWidth);
  });

  it("rejects unsupported widths", () => {
    expect(() => decode({ chatWidth: "huge" })).toThrow();
    expect(() => decodePatch({ chatWidth: "huge" })).toThrow();
  });
});

describe("ClientSettings notifications", () => {
  const decode = Schema.decodeUnknownSync(ClientSettingsSchema);
  const decodePatch = Schema.decodeUnknownSync(ClientSettingsPatch);

  it("turns on system and in-app notifications for existing settings", () => {
    const settings = decode({});
    expect(settings.notificationMode).toBe("notifications");
    expect(settings.inAppNotificationsEnabled).toBe(true);
  });

  it.each(["off", "notifications", "sound", "notifications-and-sound"] as const)(
    "accepts the %s mode",
    (notificationMode) => {
      expect(decode({ notificationMode }).notificationMode).toBe(notificationMode);
      expect(decodePatch({ notificationMode }).notificationMode).toBe(notificationMode);
    },
  );

  it("keeps an explicit opt-out", () => {
    const settings = decode({ notificationMode: "off", inAppNotificationsEnabled: false });
    expect(settings.notificationMode).toBe("off");
    expect(settings.inAppNotificationsEnabled).toBe(false);
  });

  it("rejects unknown modes", () => {
    expect(() => decode({ notificationMode: "loud" })).toThrow();
  });
});
