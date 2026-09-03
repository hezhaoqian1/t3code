// @effect-diagnostics nodeBuiltinImport:off
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { makeFdCodexChildEnvironment } from "./FdCodexChildEnvironment.ts";
import {
  fdEnterpriseToolFailureMessage,
  prepareFdCodexRuntime,
  resolveFdCodexTurnSkills,
} from "./FdCodexAdapter.ts";
import { FdEnterpriseCodexError } from "../fd-skills/FdEnterpriseCodexClient.ts";
import {
  FD_CODEX_API_KEY_ENV,
  prepareFdManagedCodexHome,
  renderFdManagedCodexConfig,
} from "./FdManagedCodexHome.ts";

const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all([...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots.clear();
});

describe("FD managed Codex runtime boundary", () => {
  it("reports a database timeout without suggesting authorization changed", () => {
    expect(fdEnterpriseToolFailureMessage(new FdEnterpriseCodexError("query_timed_out", 200))).toBe(
      "企业数据查询超时，未返回结果，请稍后重试。",
    );
    expect(fdEnterpriseToolFailureMessage(new Error("raw database detail"))).toBe(
      "企业数据工具调用失败，未返回结果，请稍后重试。",
    );
  });

  it("writes exact FD model/provider config without credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "fd-codex-home-"));
    temporaryRoots.add(root);
    const codexHome = join(root, "managed-home");
    const configPath = await prepareFdManagedCodexHome({
      codexHome,
      newApiOrigin: "http://127.0.0.1:3001",
    });

    const config = await readFile(configPath, "utf8");
    expect(config).toContain('model = "deepseek-v4-flash"');
    expect(config).toContain('model_provider = "fd_new_api"');
    expect(config).toContain('base_url = "http://127.0.0.1:3001/v1"');
    expect(config).toContain('env_key = "FD_NEW_API_KEY"');
    expect(config).toContain("requires_openai_auth = false");
    expect(config).toContain('wire_api = "responses"');
    expect(config).not.toContain("runtime-secret-marker");
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
  });

  it("accepts HTTPS and loopback HTTP origins but rejects unsafe endpoints", () => {
    expect(renderFdManagedCodexConfig("https://api.fd.example/base")).toContain(
      'base_url = "https://api.fd.example/base/v1"',
    );
    expect(() => renderFdManagedCodexConfig("http://api.fd.example")).toThrow("invalid");
    expect(() => renderFdManagedCodexConfig("https://user:secret@api.fd.example")).toThrow(
      "invalid",
    );
    expect(() => renderFdManagedCodexConfig("https://api.fd.example?token=secret")).toThrow(
      "invalid",
    );
  });

  it("injects the Runtime Token only into a minimal child environment", () => {
    const environment = makeFdCodexChildEnvironment({
      codexHome: "/managed/fd-codex",
      runtimeApiKey: "runtime-secret-marker",
      inheritedEnvironment: {
        HOME: "/employee",
        PATH: "/usr/bin",
        npm_config_user_agent: "must-not-leak",
        FD_ACCESS_TOKEN: "must-not-leak",
      },
    });

    expect(environment).toEqual({
      CODEX_HOME: "/managed/fd-codex",
      HOME: "/employee",
      PATH: "/usr/bin",
      [FD_CODEX_API_KEY_ENV]: "runtime-secret-marker",
    });
  });

  it("prepends connector binaries to the managed Codex child PATH", () => {
    const environment = makeFdCodexChildEnvironment({
      codexHome: "/managed/fd-codex",
      runtimeApiKey: "runtime-secret-marker",
      connectorBinPath: "/managed/connectors/feishu/bin",
      connectorConfigDir: "/managed/connectors/feishu/config",
      inheritedEnvironment: { PATH: "/usr/bin" },
    });

    expect(environment.PATH).toBe("/managed/connectors/feishu/bin:/usr/bin");
    expect(environment.LARKSUITE_CLI_CONFIG_DIR).toBe("/managed/connectors/feishu/config");
  });

  it("rejects invalid managed paths and credentials", () => {
    expect(() =>
      makeFdCodexChildEnvironment({ codexHome: "relative", runtimeApiKey: "secret" }),
    ).toThrow("absolute");
    expect(() =>
      makeFdCodexChildEnvironment({ codexHome: "/managed/fd-codex", runtimeApiKey: "bad\nkey" }),
    ).toThrow("invalid");
  });

  it("regenerates each child environment from the current credential projection", async () => {
    const root = await mkdtemp(join(tmpdir(), "fd-codex-runtime-"));
    temporaryRoots.add(root);
    const credential = (generation: number, runtimeApiKey: string) => ({
      userId: 7,
      runtimeTokenId: generation + 10,
      newApiOrigin: "http://127.0.0.1:3001" as const,
      runtimeApiKey,
      accessToken: "access-token-must-not-enter-child",
      accessExpiresAt: 4_102_444_800,
      policy: {
        version: 1 as const,
        capability: "general_assistant" as const,
        model: "deepseek-v4-flash" as const,
        expiresAt: 4_102_444_800,
      },
      generation,
    });

    const first = await prepareFdCodexRuntime({
      stateDir: root,
      credentials: credential(1, "runtime-key-one"),
      inheritedEnvironment: { PATH: "/usr/bin", FD_ACCESS_TOKEN: "must-not-leak" },
    });
    const second = await prepareFdCodexRuntime({
      stateDir: root,
      credentials: credential(2, "runtime-key-two"),
      inheritedEnvironment: { PATH: "/usr/bin", FD_ACCESS_TOKEN: "must-not-leak" },
    });

    expect(first.homePath).toBe(second.homePath);
    expect(first.environment.FD_NEW_API_KEY).toBe("runtime-key-one");
    expect(second.environment.FD_NEW_API_KEY).toBe("runtime-key-two");
    expect(second.environment).not.toHaveProperty("FD_ACCESS_TOKEN");
    expect(await readFile(join(second.homePath, "config.toml"), "utf8")).not.toContain(
      "runtime-key",
    );
  });

  it("enables connector extra Skill roots only when the connector state is enabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "fd-codex-connector-"));
    temporaryRoots.add(root);
    const statePath = join(root, "connector-state.json");
    const credentials = {
      userId: 7,
      runtimeTokenId: 11,
      newApiOrigin: "http://127.0.0.1:3001" as const,
      runtimeApiKey: "runtime-key-one",
      accessToken: "access-token-must-not-enter-child",
      accessExpiresAt: 4_102_444_800,
      policy: {
        version: 1 as const,
        capability: "general_assistant" as const,
        model: "deepseek-v4-flash" as const,
        expiresAt: 4_102_444_800,
      },
      generation: 1,
    };

    await writeFile(statePath, JSON.stringify({ version: 1, enabled: false, lastError: null }));
    const disabled = await prepareFdCodexRuntime({
      stateDir: root,
      credentials,
      connectorSkillsRoot: "/managed/connectors/skills/connector-feishu",
      connectorBinPath: "/managed/connectors/feishu/bin",
      connectorConfigDir: "/managed/connectors/feishu/config",
      connectorStatePath: statePath,
      inheritedEnvironment: { PATH: "/usr/bin" },
    });
    expect(disabled.skillExtraRoots).toBeUndefined();
    expect(disabled.environment.PATH).toBe("/usr/bin");
    expect(disabled.environment.LARKSUITE_CLI_CONFIG_DIR).toBeUndefined();

    await writeFile(statePath, JSON.stringify({ version: 1, enabled: true, lastError: null }));
    const enabled = await prepareFdCodexRuntime({
      stateDir: root,
      credentials,
      connectorSkillsRoot: "/managed/connectors/skills/connector-feishu",
      connectorBinPath: "/managed/connectors/feishu/bin",
      connectorConfigDir: "/managed/connectors/feishu/config",
      connectorStatePath: statePath,
      inheritedEnvironment: { PATH: "/usr/bin" },
    });
    expect(enabled.skillExtraRoots).toEqual(["/managed/connectors/skills/connector-feishu"]);
    expect(enabled.environment.PATH).toBe("/managed/connectors/feishu/bin:/usr/bin");
    expect(enabled.environment.LARKSUITE_CLI_CONFIG_DIR).toBe("/managed/connectors/feishu/config");
  });

  it("resolves selected project and personal Skills as structured Codex input", async () => {
    const root = await mkdtemp(join(tmpdir(), "fd-codex-skills-"));
    temporaryRoots.add(root);
    const projectRoot = join(root, "project");
    const userHome = join(root, "user");
    const projectSkillRoot = join(projectRoot, ".agents", "skills", "weekly-report");
    const personalSkillRoot = join(userHome, ".codex", "skills", "personal-summary");
    const managedCollisionRoot = join(projectRoot, ".agents", "skills", "company-data-quality");
    await Promise.all([
      mkdir(projectSkillRoot, { recursive: true }),
      mkdir(personalSkillRoot, { recursive: true }),
      mkdir(managedCollisionRoot, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(projectSkillRoot, "SKILL.md"),
        "---\nname: weekly-report\ndescription: Prepare a weekly report.\n---\nProject instructions\n",
      ),
      writeFile(
        join(personalSkillRoot, "SKILL.md"),
        "---\nname: personal-summary\ndescription: Summarize personal notes.\n---\nPersonal instructions\n",
      ),
      writeFile(
        join(managedCollisionRoot, "SKILL.md"),
        "---\nname: company-data-quality\ndescription: Must stay enterprise-owned.\n---\nForbidden\n",
      ),
    ]);

    const skills = await resolveFdCodexTurnSkills({
      cwd: projectRoot,
      userHome,
      prompt: "$personal-summary $weekly-report $company-data-quality $unknown run",
    });

    expect(skills).toEqual([
      { name: "personal-summary", path: await realpath(join(personalSkillRoot, "SKILL.md")) },
      { name: "weekly-report", path: await realpath(join(projectSkillRoot, "SKILL.md")) },
    ]);
    expect(skills).not.toContainEqual(expect.objectContaining({ name: "company-data-quality" }));
  });
});
