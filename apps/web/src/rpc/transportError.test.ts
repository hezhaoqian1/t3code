import { describe, expect, it } from "vite-plus/test";

import { describeActionError } from "./transportError";

describe("describeActionError", () => {
  it("turns a connection error into a retry hint", () => {
    expect(describeActionError(new Error("bird is not connected."))).toBe(
      "本地服务正在连接，请稍后再试。",
    );
  });

  it("keeps a real error message", () => {
    expect(describeActionError(new Error("任务正在运行"))).toBe("任务正在运行");
  });

  it("falls back for unknown failures", () => {
    expect(describeActionError("boom")).toBe("发生未知错误。");
    expect(describeActionError(new Error("  "))).toBe("发生未知错误。");
  });
});
