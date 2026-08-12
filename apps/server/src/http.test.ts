import { expect, it } from "@effect/vitest";
import { describe } from "vite-plus/test";

import { isLoopbackHostname, resolveDevRedirectUrl } from "./http.ts";

describe("http dev routing", () => {
  it("treats localhost and loopback addresses as local", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
  });

  it("rejects wildcard, LAN, tailnet, and non-loopback IPv6 hosts", () => {
    for (const hostname of [
      "0.0.0.0",
      "192.168.86.35",
      "10.0.0.24",
      "host.example.ts.net",
      "fd7a:115c:a1e0::1",
      "[fd7a:115c:a1e0::1]",
    ]) {
      expect(isLoopbackHostname(hostname)).toBe(false);
    }
  });

  it("preserves path and query when redirecting to the dev server", () => {
    const devUrl = new URL("http://127.0.0.1:5173/");
    const requestUrl = new URL("http://127.0.0.1:3774/pair?token=test-token");

    expect(resolveDevRedirectUrl(devUrl, requestUrl)).toBe(
      "http://127.0.0.1:5173/pair?token=test-token",
    );
  });
});
