import { describe, expect, it } from "vite-plus/test";

import {
  DEV_SERVER_ALLOWED_HOSTS,
  DEV_SERVER_LOOPBACK_HOST,
  resolveDevProxyTarget,
  resolveLoopbackDevProxyTarget,
} from "../vite.config";

describe("web Vite Desktop proxy target", () => {
  it("builds the Desktop development proxy from the runner backend port", () => {
    expect(resolveDevProxyTarget("13773")).toBe("http://127.0.0.1:13773/");
  });

  it("rejects non-loopback backend targets", () => {
    expect(resolveLoopbackDevProxyTarget("http://192.168.1.20:13773")).toBeUndefined();
    expect(resolveLoopbackDevProxyTarget("https://127.0.0.1:13773")).toBeUndefined();
    expect(resolveLoopbackDevProxyTarget("http://localhost:13773")).toBeUndefined();
  });

  it("binds the authenticated development proxy to exact loopback only", () => {
    expect(DEV_SERVER_LOOPBACK_HOST).toBe("127.0.0.1");
    expect(DEV_SERVER_ALLOWED_HOSTS).toEqual(["127.0.0.1"]);
  });
});
