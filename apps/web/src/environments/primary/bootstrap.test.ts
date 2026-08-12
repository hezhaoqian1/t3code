import { EnvironmentId, type ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  getPrimaryKnownEnvironment,
  isDesktopEnvironmentBootstrapIncompleteError,
  isPrimaryEnvironmentHostUnsupportedError,
  isPrimaryEnvironmentProtocolUnsupportedError,
  readPrimaryEnvironmentTarget,
  resolveBrowserDevelopmentPrimaryTarget,
  resolvePrimaryEnvironmentHttpUrl,
  resolveInitialPrimaryEnvironmentDescriptor,
  resetPrimaryEnvironmentDescriptorForTests,
  writePrimaryEnvironmentDescriptor,
} from ".";
import { installEnvironmentHttpTest } from "../../../test/environmentHttpTest";

const BASE_ENVIRONMENT = {
  environmentId: EnvironmentId.make("environment-local"),
  label: "Local environment",
  platform: {
    os: "darwin",
    arch: "arm64",
  },
  serverVersion: "0.0.0-test",
  capabilities: {
    repositoryIdentity: true,
  },
} satisfies ExecutionEnvironmentDescriptor;

let disposeHttpTest: (() => Promise<void>) | undefined;

async function installDescriptorApi() {
  const testApi = await installEnvironmentHttpTest({
    descriptor: () => Effect.succeed(BASE_ENVIRONMENT),
  });
  disposeHttpTest = testApi.dispose;
  return testApi;
}

function installTestBrowser(url: string) {
  vi.stubGlobal("window", {
    location: new URL(url),
    history: {
      replaceState: vi.fn(),
    },
  });
}

function captureThrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the operation to throw.");
}

describe("environmentBootstrap", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    installTestBrowser("http://localhost/");
  });

  afterEach(async () => {
    await disposeHttpTest?.();
    disposeHttpTest = undefined;
    resetPrimaryEnvironmentDescriptorForTests();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("attaches the bootstrapped environment descriptor to the primary environment", () => {
    vi.stubGlobal("window", {
      location: new URL("http://localhost:3773/"),
      desktopBridge: undefined,
    });
    writePrimaryEnvironmentDescriptor({
      environmentId: EnvironmentId.make("environment-local"),
      label: "Bootstrapped environment",
      platform: {
        os: "darwin",
        arch: "arm64",
      },
      serverVersion: "0.0.0-test",
      capabilities: {
        repositoryIdentity: true,
      },
    });

    expect(getPrimaryKnownEnvironment()).toEqual({
      id: "environment-local",
      label: "Bootstrapped environment",
      source: "development-loopback",
      environmentId: "environment-local",
      target: {
        httpBaseUrl: "http://localhost:3773/",
        wsBaseUrl: "ws://localhost:3773/",
      },
    });
  });

  it("reuses an in-flight descriptor bootstrap request", async () => {
    const testApi = await installDescriptorApi();

    await Promise.all([
      resolveInitialPrimaryEnvironmentDescriptor(),
      resolveInitialPrimaryEnvironmentDescriptor(),
    ]);

    expect(testApi.calls.descriptor).toBe(1);
  });

  it("does not create a browser target outside explicit development mode", () => {
    expect(
      resolveBrowserDevelopmentPrimaryTarget({
        isDevelopment: false,
        locationHref: "http://localhost:5735/",
      }),
    ).toBeNull();
  });

  it.each([
    ["http://127.0.0.1:5735/app", "http://127.0.0.1:5735/", "ws://127.0.0.1:5735/"],
    ["https://[::1]:5735/app", "https://[::1]:5735/", "wss://[::1]:5735/"],
  ])(
    "derives the development websocket endpoint from exact loopback %s",
    (locationHref, httpBaseUrl, wsBaseUrl) => {
      expect(resolveBrowserDevelopmentPrimaryTarget({ isDevelopment: true, locationHref })).toEqual(
        {
          source: "development-loopback",
          generation: `origin:${new URL(httpBaseUrl).origin}`,
          target: { httpBaseUrl, wsBaseUrl },
        },
      );
    },
  );

  it.each(["http://192.168.1.20:5735/", "http://0.0.0.0:5735/", "https://example.com/"])(
    "rejects non-loopback development endpoint %s",
    (locationHref) => {
      const error = captureThrown(() =>
        resolveBrowserDevelopmentPrimaryTarget({ isDevelopment: true, locationHref }),
      );
      expect(isPrimaryEnvironmentHostUnsupportedError(error)).toBe(true);
    },
  );

  it("uses the current origin as the descriptor base for local dev environments", async () => {
    installTestBrowser("http://localhost:5735/");
    await installDescriptorApi();

    await expect(resolveInitialPrimaryEnvironmentDescriptor()).resolves.toEqual(BASE_ENVIRONMENT);
    expect(resolvePrimaryEnvironmentHttpUrl("/.well-known/t3/environment")).toBe(
      "http://localhost:5735/.well-known/t3/environment",
    );
  });

  it("uses the vite proxy for desktop-managed loopback descriptor requests during local dev", async () => {
    vi.stubEnv("VITE_DEV_SERVER_URL", "http://127.0.0.1:5733");
    vi.stubGlobal("window", {
      location: new URL("http://127.0.0.1:5733/"),
      history: {
        replaceState: vi.fn(),
      },
      desktopBridge: {
        getLocalEnvironmentBootstraps: () => [
          {
            id: "primary",
            label: "Windows",
            generation: "pid:100",
            httpBaseUrl: "http://127.0.0.1:3773",
            wsBaseUrl: "ws://127.0.0.1:3773",
            bootstrapToken: "desktop-bootstrap-token",
          },
        ],
      },
    });
    await installDescriptorApi();

    await expect(resolveInitialPrimaryEnvironmentDescriptor()).resolves.toEqual(BASE_ENVIRONMENT);
    expect(resolvePrimaryEnvironmentHttpUrl("/.well-known/t3/environment")).toBe(
      "http://127.0.0.1:5733/.well-known/t3/environment",
    );
  });

  it("keeps the desktop endpoint when the Electron page uses a custom protocol", () => {
    vi.stubEnv("VITE_DEV_SERVER_URL", "http://127.0.0.1:5733");
    vi.stubGlobal("window", {
      location: new URL("fdai-dev://app/"),
      history: { replaceState: vi.fn() },
      desktopBridge: {
        getLocalEnvironmentBootstraps: () => [
          {
            id: "primary",
            label: "Fangde AI",
            generation: "pid:100",
            httpBaseUrl: "http://127.0.0.1:51120",
            wsBaseUrl: "ws://127.0.0.1:51120",
            bootstrapToken: "desktop-bootstrap-token",
          },
        ],
      },
    });

    expect(resolvePrimaryEnvironmentHttpUrl("/api/auth/session")).toBe(
      "http://127.0.0.1:51120/api/auth/session",
    );
  });

  it("describes which desktop bootstrap endpoint is missing", () => {
    vi.stubGlobal("window", {
      location: new URL("http://127.0.0.1:5733/"),
      history: { replaceState: vi.fn() },
      desktopBridge: {
        getLocalEnvironmentBootstraps: () => [
          {
            id: "primary",
            label: "Local environment",
            generation: "pid:100",
            httpBaseUrl: "http://127.0.0.1:3773",
            bootstrapToken: "desktop-bootstrap-token",
          },
        ],
      },
    });

    const error = captureThrown(readPrimaryEnvironmentTarget);

    expect(isDesktopEnvironmentBootstrapIncompleteError(error)).toBe(true);
    if (!isDesktopEnvironmentBootstrapIncompleteError(error)) {
      throw new Error("Expected a structured desktop bootstrap error.");
    }
    expect(error).toMatchObject({
      hasHttpBaseUrl: true,
      hasWsBaseUrl: false,
      message: "Desktop bootstrap is missing wsBaseUrl for the local environment.",
    });
  });

  it("rejects non-http browser development protocols", () => {
    const error = captureThrown(() =>
      resolveBrowserDevelopmentPrimaryTarget({
        isDevelopment: true,
        locationHref: "file:///tmp/t3code/",
      }),
    );

    expect(isPrimaryEnvironmentProtocolUnsupportedError(error)).toBe(true);
    if (!isPrimaryEnvironmentProtocolUnsupportedError(error)) {
      throw new Error("Expected a structured primary environment protocol error.");
    }
    expect(error).toMatchObject({
      source: "development-loopback",
      protocol: "file:",
      message:
        "The development-loopback primary environment target uses unsupported protocol file:.",
    });
  });

  it("rejects a non-loopback Desktop-managed bootstrap", () => {
    vi.stubGlobal("window", {
      location: new URL("http://localhost:5733/"),
      history: { replaceState: vi.fn() },
      desktopBridge: {
        getLocalEnvironmentBootstraps: () => [
          {
            id: "primary",
            label: "Local environment",
            generation: "pid:100",
            httpBaseUrl: "http://192.168.1.20:3773",
            wsBaseUrl: "ws://192.168.1.20:3773",
            bootstrapToken: "desktop-bootstrap-token",
          },
        ],
      },
    });

    expect(
      isPrimaryEnvironmentHostUnsupportedError(captureThrown(readPrimaryEnvironmentTarget)),
    ).toBe(true);
  });
});
