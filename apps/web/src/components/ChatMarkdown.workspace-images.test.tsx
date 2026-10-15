import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  resources: [] as Array<unknown>,
  assetState: "success" as "success" | "loading",
}));

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("../assets/assetUrls", () => ({
  useAssetUrlState: (_environmentId: unknown, resource: unknown) => {
    testState.resources.push(resource);
    return testState.assetState === "loading"
      ? { _tag: "Loading" }
      : { _tag: "Success", url: "https://signed.test/workspace-image.svg" };
  },
}));
vi.mock("../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => vi.fn() }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/session")>()),
  usePreparedConnection: () => ({ _tag: "Loading" }),
}));
vi.mock("../state/entities", () => ({
  useActiveEnvironmentId: () => EnvironmentId.make("env-windows"),
}));
vi.mock("../editorPreferences", () => ({ useOpenInPreferredEditor: () => vi.fn() }));

import ChatMarkdown from "./ChatMarkdown";

const threadRef = {
  environmentId: EnvironmentId.make("env-windows"),
  threadId: ThreadId.make("thread-windows"),
};

function render(markdown: string): string {
  return renderToStaticMarkup(
    <ChatMarkdown cwd={"C:\\Users\\shawn\\project"} threadRef={threadRef} text={markdown} />,
  );
}

function renderWithoutThread(markdown: string): string {
  return renderToStaticMarkup(<ChatMarkdown cwd={"C:\\Users\\shawn\\project"} text={markdown} />);
}

describe("ChatMarkdown workspace images", () => {
  it("keeps both Windows drive link forms usable through the Markdown pipeline", () => {
    const forward = "C:/Users/shawn/project/报告.md";
    const backward = "C:\\Users\\shawn\\project\\报告.md";
    expect(render(`[forward](${forward})`)).toContain(`href="${forward}"`);
    expect(render(`[backward](${backward})`)).toContain(`href="${backward}"`);
    const qaPath = "C:\\fd019\\qa-batch2\\runs\\file-preview-recovery\\task\\正常报告.md";
    expect(render(`[Windows绝对路径](${qaPath})`)).toContain(`href="${qaPath}"`);
  });

  it("resolves rendered document images and links from their own directory", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd="C:/Users/shawn/project"
        baseDir="C:/Users/shawn/project/成果"
        threadRef={threadRef}
        text={"[附录](附录.md)\n\n![图](图片.svg)"}
      />,
    );
    expect(html).toContain('href="C:/Users/shawn/project/成果\\附录.md"');
    expect(testState.resources).toContainEqual({
      _tag: "workspace-file",
      threadId: threadRef.threadId,
      path: "C:/Users/shawn/project/成果\\图片.svg",
    });
  });

  it("renders macOS file URLs, spaces and sibling images through the same pipeline", () => {
    const cwd = "/Users/fd/FangdeAI/Tasks/中文任务";
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd={cwd}
        baseDir={`${cwd}/成果`}
        threadRef={threadRef}
        text={`[报告](file://${cwd}/成果/季度%20报告.md)\n\n![图](./图片.svg)`}
      />,
    );
    expect(html).toContain(`href="${cwd}/成果/季度 报告.md"`);
    expect(testState.resources).toContainEqual({
      _tag: "workspace-file",
      threadId: threadRef.threadId,
      path: `${cwd}/成果/./图片.svg`,
    });
  });
  beforeEach(() => {
    testState.resources = [];
    testState.assetState = "success";
  });

  it("loads every Windows workspace path form through a signed asset URL", () => {
    const imagePath = "C:/Users/shawn/project/.t3/workspace-image.svg";
    const html = render(
      [
        "![relative](.t3/workspace-image.svg)",
        `![absolute](${imagePath})`,
        `![file URL](file:///${imagePath})`,
      ].join("\n\n"),
    );

    expect(testState.resources).toEqual([
      {
        _tag: "workspace-file",
        threadId: threadRef.threadId,
        path: "C:\\Users\\shawn\\project\\.t3\\workspace-image.svg",
      },
      { _tag: "workspace-file", threadId: threadRef.threadId, path: imagePath },
      { _tag: "workspace-file", threadId: threadRef.threadId, path: imagePath },
    ]);
    expect(html.match(/https:\/\/signed\.test\/workspace-image\.svg/g)).toHaveLength(3);
    expect(html.match(/max-w-\[min\(100%,30rem\)\]/g)).toHaveLength(3);
    expect(html.match(/max-h-\[30rem\]/g)).toHaveLength(3);
    expect(html).not.toContain("图片无法加载");
  });

  it("does not request an asset for an automatic network file image", () => {
    const html = render("![network](file://server/share/workspace-image.svg)");
    expect(testState.resources).toEqual([]);
    expect(html).toContain("图片无法加载");
  });

  it("normalizes a drive-absolute src in raw image HTML", () => {
    const html = render(String.raw`<img src="D:\screens\workspace-image.svg" alt="raw">`);

    expect(testState.resources).toEqual([
      {
        _tag: "workspace-file",
        threadId: threadRef.threadId,
        path: "D:/screens/workspace-image.svg",
      },
    ]);
    expect(html).toContain("https://signed.test/workspace-image.svg");
  });

  it("uses a static placeholder while a signed asset URL loads", () => {
    testState.assetState = "loading";

    const html = render("![loading](.t3/workspace-image.svg)");

    expect(html).toContain('aria-label="正在加载图片"');
    expect(html).not.toContain("animate-pulse");
  });

  it("never passes a workspace source to a raw image when thread context is unavailable", () => {
    const html = renderWithoutThread(
      "![file URL](file:///C:/Users/shawn/project/workspace-image.svg)",
    );

    expect(testState.resources).toEqual([]);
    expect(html).toContain("图片无法加载");
    expect(html).not.toContain("file://");
  });

  it("blocks unsupported image schemes instead of passing them to a raw image", () => {
    const html = render("![unsupported](content://media/image/1)");

    expect(testState.resources).toEqual([]);
    expect(html).toContain("图片无法加载");
    expect(html).not.toContain("content://");
  });

  it("keeps remote images directly loadable", () => {
    const html = render("![remote](https://example.com/image.png)");

    expect(testState.resources).toEqual([]);
    expect(html).toContain('src="https://example.com/image.png"');
    expect(html).toContain("max-w-[min(100%,30rem)]");
    expect(html).toContain("max-h-[30rem]");
    expect(html).not.toContain("图片无法加载");
  });
});
