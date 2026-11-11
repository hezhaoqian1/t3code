import {
  BOOT_SPLASH_CSS,
  BOOT_SPLASH_STARTUP_STATUSES,
  bootSplashPhaseScript,
  renderBootSplashMarkup,
} from "@t3tools/shared/bootSplash";

import { BOOT_MARK_NAVY_DATA_URL, BOOT_MARK_PURPLE_DATA_URL } from "./bootMarkImages.ts";

/**
 * The zero-dependency document the main window shows while the local service
 * starts (8-12 s on a cold Windows start). It is the shared 方德 AI loading
 * screen with the halves-converge intro, and the web boot shell continues it
 * without a visible jump once the app loads. The images are inlined because
 * nothing can serve them yet; the whole surface drags the frameless window.
 */
export function buildStartupDocumentHtml(): string {
  const splash = renderBootSplashMarkup({
    purpleSrc: BOOT_MARK_PURPLE_DATA_URL,
    navySrc: BOOT_MARK_NAVY_DATA_URL,
    statuses: BOOT_SPLASH_STARTUP_STATUSES,
    intro: true,
    draggable: true,
  });
  return (
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>方德 AI</title>` +
    `<script>try{if(matchMedia("(prefers-color-scheme: dark)").matches)document.documentElement.classList.add("dark")}catch(e){}${bootSplashPhaseScript}</script>` +
    `<style>html,body{height:100%;margin:0;overflow:hidden;background:#ffffff}html.dark,html.dark body{background:#0a0a0a}${BOOT_SPLASH_CSS}</style>` +
    `</head><body>${splash}</body></html>`
  );
}

export const STARTUP_DOCUMENT_URL = `data:text/html;charset=utf-8,${encodeURIComponent(buildStartupDocumentHtml())}`;
