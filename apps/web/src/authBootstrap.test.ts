import type { AuthBrowserSessionResult, AuthSessionState, DesktopBridge } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { installEnvironmentHttpTest } from "../test/environmentHttpTest";
import {
  __resetServerAuthBootstrapForTests,
  resolveInitialServerAuthGateState,
} from "./environments/primary";

const DESKTOP_AUTH: AuthSessionState["auth"] = {
  policy: "desktop-managed-local",
  bootstrapMethods: ["desktop-bootstrap"],
  sessionMethods: ["browser-session-cookie", "bearer-access-token"],
  sessionCookieName: "t3_session",
};
const SESSION_EXPIRES_AT = DateTime.makeUnsafe("2026-04-05T00:00:00.000Z");

const unauthenticatedSession = (): AuthSessionState => ({
  authenticated: false,
  auth: DESKTOP_AUTH,
});

const authenticatedSession = (): AuthSessionState => ({
  authenticated: true,
  auth: DESKTOP_AUTH,
  scopes: ["orchestration:read", "orchestration:operate", "terminal:operate", "review:write"],
  sessionMethod: "browser-session-cookie",
  expiresAt: SESSION_EXPIRES_AT,
});

const browserSession = (): AuthBrowserSessionResult => ({
  authenticated: true,
  scopes: ["orchestration:read", "orchestration:operate", "terminal:operate", "review:write"],
  sessionMethod: "browser-session-cookie",
  expiresAt: SESSION_EXPIRES_AT,
});

function installBrowser(desktopBridge?: DesktopBridge, locationHref = "http://127.0.0.1:5733/") {
  vi.stubGlobal("window", {
    location: new URL(locationHref),
    ...(desktopBridge === undefined ? {} : { desktopBridge }),
  });
}

function configureDevelopmentBootstrap(input: {
  readonly isDevelopment: boolean;
  readonly pageUrl: string;
  readonly devServerUrl: string;
}) {
  vi.stubEnv("DEV", input.isDevelopment);
  vi.stubEnv("VITE_T3CODE_DEV_BOOTSTRAP_TOKEN", "vite-development-bootstrap-token");
  vi.stubEnv("VITE_DEV_SERVER_URL", input.devServerUrl);
  installBrowser(undefined, input.pageUrl);
}

describe("primary Desktop auth bootstrap", () => {
  let disposeHttpTest: (() => Promise<void>) | undefined;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    installBrowser();
    __resetServerAuthBootstrapForTests();
  });

  afterEach(async () => {
    await disposeHttpTest?.();
    disposeHttpTest = undefined;
    __resetServerAuthBootstrapForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reuses an existing authenticated session", async () => {
    const testApi = await installEnvironmentHttpTest({
      session: () => Effect.succeed(authenticatedSession()),
    });
    disposeHttpTest = testApi.dispose;

    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "authenticated",
    });
    expect(testApi.calls.session).toBe(1);
    expect(testApi.calls.browserSession).toEqual([]);
  });

  it("exchanges the platform-managed Desktop bootstrap and refreshes the session", async () => {
    let sessionRead = 0;
    const testApi = await installEnvironmentHttpTest({
      session: () =>
        Effect.succeed(sessionRead++ === 0 ? unauthenticatedSession() : authenticatedSession()),
      browserSession: () => Effect.succeed(browserSession()),
    });
    disposeHttpTest = testApi.dispose;
    installBrowser({
      getLocalEnvironmentBootstraps: () => [
        {
          id: "primary",
          label: "Desktop",
          generation: "pid:100",
          httpBaseUrl: "http://127.0.0.1:3773",
          wsBaseUrl: "ws://127.0.0.1:3773",
          bootstrapToken: "desktop-bootstrap-token",
        },
      ],
    } as unknown as DesktopBridge);

    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "authenticated",
    });
    expect(testApi.calls.browserSession).toEqual([{ credential: "desktop-bootstrap-token" }]);
    expect(testApi.calls.session).toBe(2);
  });

  it("does not contact any saved target when the primary bootstrap is unavailable", async () => {
    const fetch = vi.fn();
    const testApi = await installEnvironmentHttpTest({
      session: () => Effect.succeed(unauthenticatedSession()),
    });
    disposeHttpTest = testApi.dispose;
    vi.stubGlobal("fetch", fetch);

    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "requires-auth",
      auth: DESKTOP_AUTH,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(testApi.calls.browserSession).toEqual([]);
  });

  it("exchanges the Vite credential for matching loopback development origins", async () => {
    let sessionRead = 0;
    const testApi = await installEnvironmentHttpTest({
      session: () =>
        Effect.succeed(sessionRead++ === 0 ? unauthenticatedSession() : authenticatedSession()),
      browserSession: () => Effect.succeed(browserSession()),
    });
    disposeHttpTest = testApi.dispose;
    configureDevelopmentBootstrap({
      isDevelopment: true,
      pageUrl: "http://127.0.0.1:5733/settings",
      devServerUrl: "http://127.0.0.1:5733/",
    });

    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "authenticated",
    });
    expect(testApi.calls.browserSession).toEqual([
      { credential: "vite-development-bootstrap-token" },
    ]);
  });

  it.each([
    {
      name: "production mode",
      isDevelopment: false,
      pageUrl: "http://127.0.0.1:5733/",
      devServerUrl: "http://127.0.0.1:5733/",
    },
    {
      name: "non-loopback page",
      isDevelopment: true,
      pageUrl: "https://fangde.example/",
      devServerUrl: "https://fangde.example/",
    },
    {
      name: "mismatched loopback origin",
      isDevelopment: true,
      pageUrl: "http://127.0.0.1:5733/",
      devServerUrl: "http://localhost:5733/",
    },
  ])("does not exchange the Vite credential for $name", async (input) => {
    const testApi = await installEnvironmentHttpTest({
      session: () => Effect.succeed(unauthenticatedSession()),
    });
    disposeHttpTest = testApi.dispose;
    configureDevelopmentBootstrap(input);

    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "requires-auth",
      auth: DESKTOP_AUTH,
    });
    expect(testApi.calls.browserSession).toEqual([]);
  });
});
