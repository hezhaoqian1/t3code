// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ExpandedImageDialog } from "./ExpandedImageDialog";

const preview = {
  index: 0,
  images: [
    { src: "blob:one", name: "报表截图.png" },
    { src: "blob:two", name: "现场照片.jpg" },
  ],
};

function isDisabled(markup: string, label: string): boolean {
  const match = markup.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`));
  if (!match) throw new Error(`No button labelled ${label}`);
  return /\sdisabled=""/.test(match[0]);
}

describe("ExpandedImageDialog", () => {
  it("shows a zoomable image with zoom controls starting at the fitted size", () => {
    const markup = renderToStaticMarkup(
      <ExpandedImageDialog preview={preview as never} onClose={() => {}} />,
    );

    expect(markup).toContain('aria-label="报表截图.png，可缩放的图片"');
    expect(markup).toContain("100%");
    expect(isDisabled(markup, "放大")).toBe(false);
    expect(isDisabled(markup, "缩小")).toBe(true);
    expect(isDisabled(markup, "适应窗口")).toBe(true);
    expect(markup).toContain("(1/2)");
    expect(markup).toContain('aria-label="下一张"');
  });
});
