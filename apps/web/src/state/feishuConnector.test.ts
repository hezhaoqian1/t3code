import type { FdConnectorState } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createFeishuConnectorController,
  isFeishuConnectorConnected,
  resolveFeishuConnectorConnectionStatus,
  type FeishuConnectorBridge,
} from "./feishuConnector";

const connectorState = (overrides: Partial<FdConnectorState> = {}): FdConnectorState => ({
  id: "feishu",
  displayName: "飞书",
  enabled: false,
  busy: false,
  installState: "installed",
  authState: "not_authenticated",
  cliVersion: "1.0.86",
  installedCliPath: "/connectors/feishu/lark-cli",
  skillsRoot: "/connectors/skills/connector-feishu",
  skillCount: 27,
  installedSkillNames: ["lark-docs"],
  lastError: null,
  message: null,
  authAction: null,
  ...overrides,
});

describe("Feishu connector controller", () => {
  it("publishes the desktop-only fallback when the bridge is unavailable", () => {
    const publish = vi.fn();

    const stop = createFeishuConnectorController(undefined, publish).start();

    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ installState: "not_installed", enabled: false }),
    );
    stop();
  });

  it("publishes the initial desktop state", async () => {
    const connected = connectorState({ enabled: true, authState: "authenticated" });
    const publish = vi.fn();
    const bridge: FeishuConnectorBridge = {
      getFeishuConnectorState: vi.fn(async () => connected),
    };

    const stop = createFeishuConnectorController(bridge, publish).start();
    await Promise.resolve();

    expect(publish).toHaveBeenCalledWith(connected);
    stop();
  });

  it("does not let a stale initial read overwrite a newer state event", async () => {
    const stale = connectorState();
    const connected = connectorState({ enabled: true, authState: "authenticated" });
    let resolveInitialRead!: (state: FdConnectorState) => void;
    let emitState!: (state: FdConnectorState) => void;
    const initialRead = new Promise<FdConnectorState>((resolve) => {
      resolveInitialRead = resolve;
    });
    const publish = vi.fn();
    const unsubscribe = vi.fn();
    const bridge: FeishuConnectorBridge = {
      getFeishuConnectorState: () => initialRead,
      onFeishuConnectorState: (listener) => {
        emitState = listener;
        return unsubscribe;
      },
    };

    const stop = createFeishuConnectorController(bridge, publish).start();
    emitState(connected);
    resolveInitialRead(stale);
    await initialRead;
    await Promise.resolve();

    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(connected);
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("publishes a recoverable state when the initial read fails", async () => {
    const publish = vi.fn();
    const bridge: FeishuConnectorBridge = {
      getFeishuConnectorState: vi.fn(async () => {
        throw new Error("connector unavailable");
      }),
    };

    const stop = createFeishuConnectorController(bridge, publish).start();
    await Promise.resolve();
    await Promise.resolve();

    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        authState: "unknown",
        lastError: "读取飞书连接器状态失败。",
      }),
    );
    stop();
  });

  it("does not publish an initial read after the provider stops", async () => {
    let resolveInitialRead!: (state: FdConnectorState) => void;
    const initialRead = new Promise<FdConnectorState>((resolve) => {
      resolveInitialRead = resolve;
    });
    const publish = vi.fn();
    const unsubscribe = vi.fn();
    const bridge: FeishuConnectorBridge = {
      getFeishuConnectorState: () => initialRead,
      onFeishuConnectorState: () => unsubscribe,
    };

    const stop = createFeishuConnectorController(bridge, publish).start();
    stop();
    resolveInitialRead(connectorState({ enabled: true, authState: "authenticated" }));
    await initialRead;
    await Promise.resolve();

    expect(publish).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe("Feishu connector presentation state", () => {
  it("distinguishes status detection from a disconnected account", () => {
    expect(
      resolveFeishuConnectorConnectionStatus(connectorState({ busy: true, authState: "unknown" })),
    ).toBe("checking");
    expect(resolveFeishuConnectorConnectionStatus(connectorState())).toBe("disconnected");
  });

  it("requires enablement, authentication, and installed skills for connected state", () => {
    const connected = connectorState({ enabled: true, authState: "authenticated" });

    expect(isFeishuConnectorConnected(connected)).toBe(true);
    expect(resolveFeishuConnectorConnectionStatus(connected)).toBe("connected");
    expect(isFeishuConnectorConnected({ ...connected, skillCount: 0 })).toBe(false);
  });
});
