import { describe, expect, it } from "vite-plus/test";

import { detectPresentationIntent } from "./presentationIntent";

describe("detectPresentationIntent", () => {
  it("detects explicit creation requests", () => {
    expect(detectPresentationIntent("把刚才的内容做成一份客户 PPT")).toEqual({
      operation: "create",
    });
  });

  it("detects revision requests without matching ordinary chat", () => {
    expect(detectPresentationIntent("把刚才那份 PPT 的第 3 页改成数据图表")).toEqual({
      operation: "revise",
    });
    expect(detectPresentationIntent("帮我写一封邮件")).toBeNull();
  });
});
