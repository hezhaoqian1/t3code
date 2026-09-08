import { describe, expect, it } from "vite-plus/test";

import { prepareResponsesCodexHome, renderResponsesCodexConfig } from "./ResponsesCodexConfig.ts";
import { FD_RESPONSES_PROVIDER } from "./ResponsesModelCatalog.ts";

describe("Responses-backed Codex configuration", () => {
  it("renders a provider config without embedding a secret", () => {
    const config = renderResponsesCodexConfig(FD_RESPONSES_PROVIDER);

    expect(config).toContain('model = "deepseek-v4-flash"');
    expect(config).toContain('model_provider = "fd_new_api"');
    expect(config).toContain('env_key = "FD_NEW_API_KEY"');
    expect(config).toContain('wire_api = "responses"');
    expect(config).not.toContain("sk-");
  });

  it("rejects credentials in the endpoint and unknown defaults", () => {
    expect(() =>
      renderResponsesCodexConfig({
        ...FD_RESPONSES_PROVIDER,
        baseUrl: "https://api.fd.example/v1?key=secret",
      }),
    ).toThrow("invalid");
    expect(() =>
      renderResponsesCodexConfig({ ...FD_RESPONSES_PROVIDER, defaultModel: "missing" }),
    ).toThrow("default model");
  });

  it("writes the managed home atomically", async () => {
    const root = await import("node:os").then(({ tmpdir }) => tmpdir());
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const temp = await mkdtemp(join(root, "responses-codex-config-"));
    try {
      const configPath = await prepareResponsesCodexHome({
        codexHome: join(temp, "home"),
        provider: FD_RESPONSES_PROVIDER,
      });
      expect(await readFile(configPath, "utf8")).toContain('model_provider = "fd_new_api"');
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
