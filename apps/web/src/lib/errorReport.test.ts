import { describe, expect, it } from "vite-plus/test";

import { errorMessage, errorReport } from "./errorReport";

const context = {
  appName: "方德 AI",
  appVersion: "0.2.40",
  pathname: "/thread/abc",
  userAgent: "Electron/41 Windows",
  now: new Date("2026-10-02T00:00:00.000Z"),
};

describe("errorReport", () => {
  it("starts with the build, page, time and client", () => {
    const report = errorReport(new Error("boom"), context);
    expect(report.split("\n").slice(0, 4)).toEqual([
      "方德 AI 0.2.40",
      "页面: /thread/abc",
      "时间: 2026-10-02T00:00:00.000Z",
      "客户端: Electron/41 Windows",
    ]);
    expect(report).toContain("Error: boom");
  });

  it("follows the cause chain but stops at a bounded depth", () => {
    let error: Error = new Error("root");
    for (let depth = 0; depth < 8; depth += 1) {
      error = new Error(`level ${depth}`, { cause: error });
    }
    const report = errorReport(error, context);
    expect(report.match(/原因:/g)).toHaveLength(5);
    expect(report).not.toContain("Error: root");
  });

  it("describes non-Error values", () => {
    expect(errorReport({ code: 42 }, context)).toContain('"code": 42');
    expect(errorMessage("  ")).toBe("发生了未知错误。");
    expect(errorMessage("网络断开")).toBe("网络断开");
  });
});
