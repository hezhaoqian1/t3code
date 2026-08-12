import type { DesktopBridge } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest";

import { readDesktopPrimaryBearerToken, refreshDesktopPrimaryBearerToken } from "./desktopAuth";

describe("desktop primary auth", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("requests the bearer token per use without renderer-side caching", async () => {
    const getLocalEnvironmentBearerToken = vi.fn().mockResolvedValue("desktop-bearer-token");
    window.desktopBridge = {
      getLocalEnvironmentBearerToken,
      refreshLocalEnvironmentBearerToken: vi.fn().mockResolvedValue("desktop-refreshed-token"),
    } as unknown as DesktopBridge;

    await expect(readDesktopPrimaryBearerToken()).resolves.toBe("desktop-bearer-token");
    await expect(readDesktopPrimaryBearerToken()).resolves.toBe("desktop-bearer-token");
    expect(getLocalEnvironmentBearerToken).toHaveBeenCalledTimes(2);
  });

  it("exposes an atomic refresh operation through the bridge", async () => {
    const refresh = vi.fn().mockResolvedValue("desktop-refreshed-token");
    window.desktopBridge = {
      getLocalEnvironmentBearerToken: vi.fn(),
      refreshLocalEnvironmentBearerToken: refresh,
    } as unknown as DesktopBridge;

    await expect(refreshDesktopPrimaryBearerToken()).resolves.toBe("desktop-refreshed-token");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not require desktop auth in a browser", async () => {
    await expect(readDesktopPrimaryBearerToken()).resolves.toBeNull();
  });
});
