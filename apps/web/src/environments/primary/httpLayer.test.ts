import type { DesktopBridge } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/unstable/http";

import { makePrimaryEnvironmentHttpLayer } from "./httpLayer";

describe.sequential("primary environment HTTP layer", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
    vi.unstubAllGlobals();
  });

  it.effect("uses cookie credentials for browser primary environments", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          href: "http://127.0.0.1:3773/settings",
          origin: "http://127.0.0.1:3773",
        },
      },
    });

    return Effect.gen(function* () {
      yield* HttpClient.get("http://127.0.0.1:3773/api/auth/session");

      const request = new Request(fetchMock.mock.calls[0]?.[0], fetchMock.mock.calls[0]?.[1]);
      expect(request.credentials).toBe("include");
      expect(request.headers.get("authorization")).toBeNull();
    }).pipe(Effect.provide(makePrimaryEnvironmentHttpLayer()));
  });

  it.effect("uses bearer auth without cookies for desktop-managed primaries", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { origin: "fdai://app" },
        desktopBridge: {
          getLocalEnvironmentBearerToken: vi.fn().mockResolvedValue("desktop-bearer-token"),
          refreshLocalEnvironmentBearerToken: vi.fn().mockResolvedValue("desktop-refreshed-token"),
        } as unknown as DesktopBridge,
      },
    });

    return Effect.gen(function* () {
      yield* HttpClient.get("http://127.0.0.1:3773/api/auth/session");

      const request = new Request(fetchMock.mock.calls[0]?.[0], fetchMock.mock.calls[0]?.[1]);
      expect(request.credentials).not.toBe("include");
      expect(request.headers.get("authorization")).toBe("Bearer desktop-bearer-token");
    }).pipe(Effect.provide(makePrimaryEnvironmentHttpLayer()));
  });

  it.effect("loads the current Desktop bearer token for every request", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const getBearerToken = vi
      .fn()
      .mockResolvedValueOnce("desktop-token-1")
      .mockResolvedValueOnce("desktop-token-2");
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { origin: "fdai://app" },
        desktopBridge: {
          getLocalEnvironmentBearerToken: getBearerToken,
          refreshLocalEnvironmentBearerToken: vi.fn().mockResolvedValue("desktop-refreshed-token"),
        } as unknown as DesktopBridge,
      },
    });

    return Effect.gen(function* () {
      yield* HttpClient.get("http://127.0.0.1:3773/api/orchestration/shell");
      yield* HttpClient.get("http://127.0.0.1:3773/api/auth/session");

      const first = new Request(fetchMock.mock.calls[0]?.[0], fetchMock.mock.calls[0]?.[1]);
      const second = new Request(fetchMock.mock.calls[1]?.[0], fetchMock.mock.calls[1]?.[1]);
      expect(first.headers.get("authorization")).toBe("Bearer desktop-token-1");
      expect(second.headers.get("authorization")).toBe("Bearer desktop-token-2");
      expect(getBearerToken).toHaveBeenCalledTimes(2);
    }).pipe(Effect.provide(makePrimaryEnvironmentHttpLayer()));
  });

  it.effect("refreshes and retries a Desktop request once after a 401", () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const refresh = vi.fn().mockResolvedValue("fresh-token");
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { origin: "fdai://app" },
        desktopBridge: {
          getLocalEnvironmentBearerToken: vi.fn().mockResolvedValue("expired-token"),
          refreshLocalEnvironmentBearerToken: refresh,
        } as unknown as DesktopBridge,
      },
    });

    return Effect.gen(function* () {
      const response = yield* HttpClient.get("http://127.0.0.1:3773/api/auth/session");

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const first = new Request(fetchMock.mock.calls[0]?.[0], fetchMock.mock.calls[0]?.[1]);
      const second = new Request(fetchMock.mock.calls[1]?.[0], fetchMock.mock.calls[1]?.[1]);
      expect(first.headers.get("authorization")).toBe("Bearer expired-token");
      expect(second.headers.get("authorization")).toBe("Bearer fresh-token");
      expect(refresh).toHaveBeenCalledOnce();
    }).pipe(Effect.provide(makePrimaryEnvironmentHttpLayer()));
  });
});
