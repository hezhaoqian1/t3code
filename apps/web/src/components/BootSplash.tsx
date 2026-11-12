import {
  BOOT_SPLASH_APP_STATUSES,
  BOOT_SPLASH_TITLE,
  bootSplashPhaseMs,
  renderBootSplashContent,
  type BootSplashStatus,
} from "@t3tools/shared/bootSplash";
import { useMemo, useState, type CSSProperties } from "react";

import { cn } from "~/lib/utils";
import { WindowDragStrip } from "./WindowDragStrip";

export const BOOT_MARK_PURPLE_SRC = "/boot-mark-purple.png";
export const BOOT_MARK_NAVY_SRC = "/boot-mark-navy.png";

/**
 * The 方德 AI loading screen, the same one the Electron startup document and
 * index.html show (packages/shared/src/bootSplash.ts; its CSS ships in
 * index.html). The loop phase follows the wall clock, so replacing an earlier
 * stage continues the motion instead of restarting it.
 */
export function BootSplash({
  statuses = BOOT_SPLASH_APP_STATUSES,
  title = BOOT_SPLASH_TITLE,
  className,
}: {
  readonly statuses?: ReadonlyArray<BootSplashStatus>;
  readonly title?: string;
  readonly className?: string;
}) {
  const [phaseMs] = useState(() => bootSplashPhaseMs());
  const content = useMemo(
    () =>
      renderBootSplashContent({
        purpleSrc: BOOT_MARK_PURPLE_SRC,
        navySrc: BOOT_MARK_NAVY_SRC,
        statuses,
        title,
      }),
    [statuses, title],
  );
  return (
    <div
      className={cn("fd-boot", className)}
      role="status"
      aria-live="polite"
      aria-label={title}
      data-intro="false"
      style={{ "--fd-boot-phase": `${phaseMs}ms` } as CSSProperties}
      // Static markup from our own constants, shared with the HTML stages.
      dangerouslySetInnerHTML={{ __html: content }}
    />
  );
}

/** Full-window loading screen (before the app shell exists). */
export function BootSplashScreen() {
  return (
    <main className="relative h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <WindowDragStrip />
      <BootSplash />
    </main>
  );
}

/** The 方德 mark, assembled and still, on a transparent background. */
export function BrandMark({ className }: { readonly className?: string }) {
  return (
    <span aria-hidden className={cn("relative inline-block shrink-0", className)}>
      <img className="fd-boot-half fd-boot-purple" src={BOOT_MARK_PURPLE_SRC} alt="" />
      <img className="fd-boot-half fd-boot-navy" src={BOOT_MARK_NAVY_SRC} alt="" />
    </span>
  );
}
