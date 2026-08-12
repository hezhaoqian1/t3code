import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  isLocalLoopbackHost,
  resolveBrowserNavigationTarget,
  resolveDiscoveredServerUrl,
} from "./browserTargetResolver";

const environmentId = EnvironmentId.make("primary");

describe("browserTargetResolver", () => {
  it("opens an environment port on the local machine", () => {
    expect(
      resolveBrowserNavigationTarget(environmentId, {
        kind: "environment-port",
        port: 5173,
        path: "/app?mode=test",
      }),
    ).toEqual({
      requestedUrl: "http://localhost:5173/app?mode=test",
      resolvedUrl: "http://localhost:5173/app?mode=test",
      resolutionKind: "direct",
      environmentId,
    });
  });

  it("normalizes wildcard listener URLs to localhost", () => {
    expect(resolveDiscoveredServerUrl(environmentId, "0.0.0.0:3000/app")).toBe(
      "http://localhost:3000/app",
    );
  });

  it("keeps local loopback navigation direct", () => {
    expect(
      resolveBrowserNavigationTarget(environmentId, {
        kind: "url",
        url: "http://localhost:3000/app",
      }),
    ).toEqual({
      requestedUrl: "http://localhost:3000/app",
      resolvedUrl: "http://localhost:3000/app",
      resolutionKind: "direct",
      environmentId,
    });
  });

  it("keeps public URLs available without environment host rewriting", () => {
    expect(resolveDiscoveredServerUrl(environmentId, "example.com/app")).toBe(
      "https://example.com/app",
    );
  });

  it("recognizes the full IPv4 loopback range", () => {
    expect(isLocalLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLocalLoopbackHost("127.0.0.2")).toBe(true);
    expect(isLocalLoopbackHost("192.168.1.25")).toBe(false);
  });

  it("leaves malformed input for the normal navigation error path", () => {
    expect(resolveDiscoveredServerUrl(environmentId, "   ")).toBe("   ");
  });
});
