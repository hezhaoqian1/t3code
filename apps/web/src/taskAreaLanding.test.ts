// @effect-diagnostics nodeBuiltinImport:off - reads index.html and public/ from disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { renderBootSplashMarkup, BOOT_SPLASH_APP_STATUSES } from "@t3tools/shared/bootSplash";
import { describe, expect, it } from "vite-plus/test";

import { resolveIndexLandingView, TASK_AREA_UNAVAILABLE_GRACE_MS } from "./taskAreaLanding";
import { BOOT_MARK_NAVY_SRC, BOOT_MARK_PURPLE_SRC } from "./components/BootSplash";

const base = {
  bootstrapped: true,
  taskAreaFound: false,
  draftStartFailed: false,
  taskAreaGraceElapsed: false,
};

describe("start page while the task area loads", () => {
  it("shows the loading screen, not an error, while the app is still starting", () => {
    expect(resolveIndexLandingView({ ...base, bootstrapped: false })).toBe("loading");
    // The shell is up but the welcome naming the task area hasn't landed yet.
    expect(resolveIndexLandingView(base)).toBe("loading");
    expect(TASK_AREA_UNAVAILABLE_GRACE_MS).toBeGreaterThanOrEqual(10_000);
  });

  it("calls the task area unavailable only after the grace period", () => {
    expect(resolveIndexLandingView({ ...base, taskAreaGraceElapsed: true })).toBe(
      "task-area-unavailable",
    );
  });

  it("keeps loading while it opens the draft, and reports a failed start", () => {
    expect(resolveIndexLandingView({ ...base, taskAreaFound: true })).toBe("loading");
    expect(
      resolveIndexLandingView({ ...base, taskAreaFound: true, taskAreaGraceElapsed: true }),
    ).toBe("loading");
    expect(resolveIndexLandingView({ ...base, taskAreaFound: true, draftStartFailed: true })).toBe(
      "draft-start-error",
    );
  });
});

describe("index.html boot shell", () => {
  const webRoot = NodePath.resolve(import.meta.dirname, "..");

  it("keeps the markers the Vite plugin fills with the shared loading screen", () => {
    const html = NodeFS.readFileSync(NodePath.resolve(webRoot, "index.html"), "utf8");
    expect(html).toContain(`<div id="boot-shell">`);
    expect(html).toContain("<!-- fd-boot-splash:style -->");
    expect(html).toContain("<!-- fd-boot-splash:markup -->");
  });

  it("points at mark images that ship in public/", () => {
    const markup = renderBootSplashMarkup({
      purpleSrc: BOOT_MARK_PURPLE_SRC,
      navySrc: BOOT_MARK_NAVY_SRC,
      statuses: BOOT_SPLASH_APP_STATUSES,
    });
    for (const src of [BOOT_MARK_PURPLE_SRC, BOOT_MARK_NAVY_SRC]) {
      expect(markup).toContain(`src="${src}"`);
      expect(NodeFS.existsSync(NodePath.resolve(webRoot, "public", src.slice(1)))).toBe(true);
    }
  });
});
