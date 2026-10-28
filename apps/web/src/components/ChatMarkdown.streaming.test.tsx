import { EnvironmentId } from "@t3tools/contracts";
import { act, type ComponentProps, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import { getSyntaxHighlighterPromise } from "../lib/syntaxHighlighting";

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("./ui/tooltip", async () => {
  const { cloneElement, isValidElement } = await import("react");
  return {
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipTrigger({
      render,
      children,
    }: ComponentProps<typeof import("./ui/tooltip").TooltipTrigger>) {
      if (!isValidElement(render)) return <>{children}</>;
      return children === undefined ? render : cloneElement(render, undefined, children);
    },
    TooltipPopup: () => null,
  };
});
vi.mock("../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => vi.fn() }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/session")>()),
  usePreparedConnection: () => ({ _tag: "Loading" }),
}));
vi.mock("../state/entities", () => ({
  useActiveEnvironmentId: () => EnvironmentId.make("env-local"),
}));
vi.mock("../editorPreferences", () => ({ useOpenInPreferredEditor: () => vi.fn() }));

import ChatMarkdown from "./ChatMarkdown";

async function renderStreaming(texts: ReadonlyArray<string>, finalText?: string) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<ChatMarkdown cwd="/tmp/project" text={texts[0]!} isStreaming />);
  });
  for (const text of texts.slice(1)) {
    await act(async () => {
      renderer!.update(<ChatMarkdown cwd="/tmp/project" text={text} isStreaming />);
    });
  }
  if (finalText !== undefined) {
    await act(async () => {
      renderer!.update(<ChatMarkdown cwd="/tmp/project" text={finalText} />);
    });
  }
  return renderer!;
}

describe("ChatMarkdown streaming code blocks", () => {
  it("does not retokenize completed lines when streaming finishes", async () => {
    const highlighter = await getSyntaxHighlighterPromise("typescript");
    const highlight = vi.spyOn(highlighter, "codeToHast");
    let renderer: ReactTestRenderer | undefined;
    const text = "```typescript\nconst completed = 1;\nconst current = 2;";
    try {
      renderer = await renderStreaming([text]);
      expect(highlight).toHaveBeenCalled();
      highlight.mockClear();
      await act(async () => {
        renderer!.update(<ChatMarkdown cwd="/tmp/project" text={text + "\n```"} />);
      });
      expect(highlight.mock.calls.every(([code]) => !code.includes("const completed"))).toBe(true);
    } finally {
      await act(async () => renderer?.unmount());
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it("highlights each delivered paragraph of code without re-reading earlier lines", async () => {
    const highlighter = await getSyntaxHighlighterPromise("typescript");
    const highlight = vi.spyOn(highlighter, "codeToHast");
    const lines = Array.from({ length: 30 }, (_, index) => `const value${index} = ${index};`);
    const deliveries = [10, 20, 30].map(
      (count) => "```typescript\n" + lines.slice(0, count).join("\n") + "\n",
    );
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await renderStreaming(deliveries);
      // Every tokenized slice covers only lines that were new in its delivery.
      const highlightedLines = highlight.mock.calls.flatMap(([code]) =>
        code.split("\n").filter((line) => line.length > 0),
      );
      expect(new Set(highlightedLines).size).toBe(highlightedLines.length);
      const json = JSON.stringify(renderer.toJSON());
      expect(json).toContain("value29");
    } finally {
      await act(async () => renderer?.unmount());
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
