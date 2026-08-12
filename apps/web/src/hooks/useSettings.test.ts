import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { describe, expect, it } from "vite-plus/test";

import { mergeEnvironmentSettings } from "./useSettings";

describe("mergeEnvironmentSettings", () => {
  it("combines the selected environment's server settings with client preferences", () => {
    const serverSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      addProjectBaseDirectory: "~/Development",
    };
    const clientSettings = {
      ...DEFAULT_CLIENT_SETTINGS,
      wordWrap: false,
    };

    const settings = mergeEnvironmentSettings(serverSettings, clientSettings);

    expect(settings.addProjectBaseDirectory).toBe("~/Development");
    expect(settings.wordWrap).toBe(false);
  });
});
