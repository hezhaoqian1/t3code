import { BOOT_SPLASH_STARTUP_STATUSES, BOOT_SPLASH_TITLE } from "@t3tools/shared/bootSplash";
import { describe, expect, it } from "vite-plus/test";

import { BOOT_MARK_NAVY_DATA_URL, BOOT_MARK_PURPLE_DATA_URL } from "./bootMarkImages.ts";
import { buildStartupDocumentHtml, STARTUP_DOCUMENT_URL } from "./startupDocument.ts";

describe("startup document", () => {
  it("shows the shared loading screen with the intro while the local service starts", () => {
    const html = buildStartupDocumentHtml();
    expect(html).toContain(`lang="zh-CN"`);
    expect(html).toContain(BOOT_SPLASH_TITLE);
    for (const status of BOOT_SPLASH_STARTUP_STATUSES) expect(html).toContain(status.text);
    expect(html).toContain(`data-intro="true"`);
    expect(html).not.toContain("Starting local service");
  });

  it("inlines both halves of the mark, since nothing can serve files yet", () => {
    expect(BOOT_MARK_PURPLE_DATA_URL.startsWith("data:image/png;base64,iVBOR")).toBe(true);
    expect(BOOT_MARK_NAVY_DATA_URL.startsWith("data:image/png;base64,iVBOR")).toBe(true);
    const html = buildStartupDocumentHtml();
    expect(html).toContain(BOOT_MARK_PURPLE_DATA_URL);
    expect(html).toContain(BOOT_MARK_NAVY_DATA_URL);
  });

  it("lets the frameless window be dragged and follows the OS dark mode", () => {
    const html = buildStartupDocumentHtml();
    expect(html).toContain(`data-drag="true"`);
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain("--fd-boot-phase");
  });

  it("is a self-contained data URL", () => {
    expect(STARTUP_DOCUMENT_URL.startsWith("data:text/html;charset=utf-8,")).toBe(true);
    const decoded = decodeURIComponent(
      STARTUP_DOCUMENT_URL.slice("data:text/html;charset=utf-8,".length),
    );
    expect(decoded).toBe(buildStartupDocumentHtml());
    expect(decoded).not.toMatch(/(src|href)="(https?:|\/)/);
  });
});
