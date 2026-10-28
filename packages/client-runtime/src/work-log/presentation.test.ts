import { describe, expect, it } from "vite-plus/test";

import { latestThoughtLine, liveThoughtLine } from "./presentation.ts";

describe("latestThoughtLine", () => {
  it("follows the newest paragraph as a trace grows", () => {
    expect(latestThoughtLine("The user wants a review. Start broad.")).toBe(
      "The user wants a review.",
    );
    expect(
      latestThoughtLine(
        "The user wants a review. Start broad.\n\nNow check the 回撤 chart. Then more.",
      ),
    ).toBe("Now check the 回撤 chart.");
  });

  it("uses the newest summary heading", () => {
    expect(latestThoughtLine("**Reading the report**\n\n**Comparing peers**")).toBe(
      "Comparing peers",
    );
  });

  it("skips trailing paragraphs that flatten to nothing", () => {
    expect(latestThoughtLine("先看净值走势。\n\n   \n\n")).toBe("先看净值走势。");
    expect(latestThoughtLine("")).toBe("");
  });
});

describe("liveThoughtLine", () => {
  it("keeps the first sentence, including a closing quote", () => {
    expect(
      liveThoughtLine(
        'Found the cause: the repo has no commits, so `git worktree add` fails with "invalid reference: main." Now checking the UI.',
      ),
    ).toBe(
      'Found the cause: the repo has no commits, so git worktree add fails with "invalid reference: main."',
    );
  });

  it("does not cut at dots inside file names or long dashes", () => {
    expect(liveThoughtLine("I read ThreadLaunchService.ts — it skips the fetch. Next step.")).toBe(
      "I read ThreadLaunchService.ts — it skips the fetch.",
    );
  });

  it("uses a bold-only opening line as the whole line", () => {
    expect(
      liveThoughtLine("**Narrowing dispatch files**\n\nI should check the adapter. Then more."),
    ).toBe("Narrowing dispatch files");
    expect(liveThoughtLine("**Narrowing dispatch files**\r\n\r\nI should check the adapter.")).toBe(
      "Narrowing dispatch files",
    );
  });

  it("returns unpunctuated text whole and flattens markdown", () => {
    expect(liveThoughtLine("- Checking [the docs](https://x.dev) for **limits**")).toBe(
      "Checking the docs for limits",
    );
    expect(liveThoughtLine("This is *really* ~~not~~ _fine_ in snake_case_names.")).toBe(
      "This is really not fine in snake_case_names.",
    );
    expect(liveThoughtLine("   ")).toBe("");
  });

  it("ends a Chinese sentence at a full-width stop without a following space", () => {
    expect(liveThoughtLine("用户要做投后复盘。先看回撤，再看行业暴露。")).toBe(
      "用户要做投后复盘。",
    );
    expect(liveThoughtLine("他说“先核对净值。”然后再说。")).toBe("他说“先核对净值。”");
    expect(liveThoughtLine("回撤有多深？需要对比基准")).toBe("回撤有多深？");
  });

  it("handles DeepSeek-style traces that mix English with Chinese terms", () => {
    expect(
      liveThoughtLine(
        "The user wants a 投后复盘 of the fund. They provided the 四级估值表 and an explanation.",
      ),
    ).toBe("The user wants a 投后复盘 of the fund.");
    expect(liveThoughtLine("Key findings:\n- 回撤图: deepest around -12.5% near 03-02")).toBe(
      "Key findings: 回撤图: deepest around -12.5% near 03-02",
    );
  });
});
