import { describe, expect, it } from "vite-plus/test";

import {
  BOOT_SPLASH_APP_STATUSES,
  BOOT_SPLASH_CSS,
  BOOT_SPLASH_LOOP_MS,
  BOOT_SPLASH_STARTUP_STATUSES,
  BOOT_SPLASH_TITLE,
  bootSplashPhaseMs,
  renderBootSplashContent,
  renderBootSplashMarkup,
} from "./bootSplash.ts";

const images = { purpleSrc: "/purple.png", navySrc: "/navy.png" };

describe("boot splash markup", () => {
  it("renders the mark halves, the road, the title and timed status lines", () => {
    const markup = renderBootSplashMarkup({
      ...images,
      statuses: BOOT_SPLASH_STARTUP_STATUSES,
      intro: true,
      draggable: true,
    });
    expect(markup).toContain(`class="fd-boot"`);
    expect(markup).toContain(`data-intro="true"`);
    expect(markup).toContain(`data-drag="true"`);
    expect(markup).toContain(`role="status"`);
    expect(markup).toContain(`src="/purple.png"`);
    expect(markup).toContain(`src="/navy.png"`);
    expect(markup).toContain("fd-boot-road");
    expect(markup).toContain(BOOT_SPLASH_TITLE);
    expect(BOOT_SPLASH_TITLE).toBe("方小德正在来的路上");
    // Each line fades in at its time and out when the next one arrives.
    expect(markup).toContain("--fd-boot-in:0ms;--fd-boot-out:5000ms;");
    expect(markup).toContain("--fd-boot-in:5000ms;--fd-boot-out:14000ms;");
    expect(markup).toContain(`fd-boot-status-last" style="--fd-boot-in:14000ms;"`);
    for (const status of BOOT_SPLASH_STARTUP_STATUSES) expect(markup).toContain(status.text);
  });

  it("leaves out the intro and window dragging unless asked", () => {
    const markup = renderBootSplashMarkup({ ...images, statuses: BOOT_SPLASH_APP_STATUSES });
    expect(markup).toContain(`data-intro="false"`);
    expect(markup).not.toContain("data-drag");
  });

  it("escapes text and image sources", () => {
    const content = renderBootSplashContent({
      purpleSrc: `/a.png" onerror="x`,
      navySrc: "/b.png",
      statuses: [{ text: "<b>1 & 2</b>", atMs: 0 }],
      title: `"quoted"`,
    });
    expect(content).toContain("&lt;b&gt;1 &amp; 2&lt;/b&gt;");
    expect(content).toContain("&quot;quoted&quot;");
    expect(content).not.toContain(`" onerror="`);
  });

  it("starts the same loop phase from the same wall clock in every stage", () => {
    expect(bootSplashPhaseMs(BOOT_SPLASH_LOOP_MS * 10 + 600)).toBe(-600);
    expect(bootSplashPhaseMs(BOOT_SPLASH_LOOP_MS * 3)).toBe(-0);
  });

  it("ships a dark palette and stops movement for reduced motion", () => {
    expect(BOOT_SPLASH_CSS).toContain(".dark .fd-boot{");
    expect(BOOT_SPLASH_CSS).toContain(".dark .fd-boot-navy{filter:brightness(");
    expect(BOOT_SPLASH_CSS).toContain("@media (prefers-reduced-motion:reduce)");
    expect(BOOT_SPLASH_CSS).toContain(`.fd-boot[data-drag="true"]{-webkit-app-region:drag}`);
  });
});
