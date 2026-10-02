import { describe, expect, it } from "@effect/vitest";

import { formatPastedTextContext, utf8Prefix } from "./PastedTextContext.ts";

describe("utf8Prefix", () => {
  it("keeps whole characters within the byte budget", () => {
    expect(utf8Prefix("abc", 10)).toBe("abc");
    expect(utf8Prefix("你好世界", 7)).toBe("你好");
    expect(utf8Prefix("a🙂b", 4)).toBe("a");
    expect(utf8Prefix("a🙂b", 5)).toBe("a🙂");
  });
});

describe("formatPastedTextContext", () => {
  it("is empty without pasted text", () => {
    expect(formatPastedTextContext([])).toBe("");
  });

  it("includes a paste that fits in full", () => {
    const context = formatPastedTextContext([
      { name: "粘贴内容.txt", text: "line 1\r\nline 2", path: "/data/a.txt" },
    ]);
    expect(context).toContain('<pasted-text name="粘贴内容.txt">\nline 1\nline 2\n</pasted-text>');
    expect(context).not.toContain("/data/a.txt");
  });

  it("points at the saved file for the part that does not fit", () => {
    const context = formatPastedTextContext(
      [
        { name: "粘贴内容.txt", text: "x".repeat(30), path: "/data/a.txt" },
        { name: "粘贴内容-2.txt", text: "y".repeat(30), path: "/data/b.txt" },
      ],
      40,
    );
    expect(context).toContain(`<pasted-text name="粘贴内容.txt">\n${"x".repeat(30)}\n`);
    expect(context).toContain(
      `<pasted-text name="粘贴内容-2.txt" truncated="true">\n${"y".repeat(10)}\n`,
    );
    expect(context).toContain("共 30 个字符，上面只包含开头的 10 个字符");
    expect(context).toContain("/data/b.txt");
  });
});
