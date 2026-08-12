import { describe, expect, it } from "vite-plus/test";

import {
  primaryEnvironmentTargetSignature,
  primaryRegistrationToRetainAfterTopologyRead,
  readPrimaryEnvironmentTargetResult,
} from "./platform";

describe("primary connection platform", () => {
  it("retains the authenticated primary registration after a transient topology read failure", () => {
    const previous = {
      topologySignature: "primary",
      identitySignature: "primary",
      registration: {} as never,
    };
    const failed = readPrimaryEnvironmentTargetResult(() => {
      throw new Error("bridge temporarily unavailable");
    });

    expect(primaryRegistrationToRetainAfterTopologyRead(previous, failed)).toBe(previous);
  });

  it("does not retain a registration after a successful empty topology read", () => {
    const previous = {
      topologySignature: "primary",
      identitySignature: "primary",
      registration: {} as never,
    };
    expect(
      primaryRegistrationToRetainAfterTopologyRead(previous, {
        _tag: "Success",
        target: null,
      }),
    ).toBeUndefined();
  });

  it("changes topology identity when a backend restarts on the same endpoints", () => {
    const target = {
      source: "desktop-managed" as const,
      generation: "pid:100",
      target: {
        httpBaseUrl: "http://127.0.0.1:3773/",
        wsBaseUrl: "ws://127.0.0.1:3773/",
      },
    };

    expect(primaryEnvironmentTargetSignature(target)).not.toBe(
      primaryEnvironmentTargetSignature({ ...target, generation: "pid:101" }),
    );
  });
});
