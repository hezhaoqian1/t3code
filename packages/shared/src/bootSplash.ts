/**
 * The 方德 AI loading screen ("方小德正在来的路上").
 *
 * Every startup stage renders this same markup and CSS, so swapping between
 * stages never moves anything on screen:
 *   1. the Electron startup document, shown before the local service is up;
 *   2. the web index.html boot shell, shown until React mounts (injected at
 *      build time by the web Vite config);
 *   3. React's own loading screens (account check, task area).
 *
 * The two halves of the mark converge and lock together in stage 1, then the
 * mark floats along a "road". Looping animations take their phase from the
 * wall clock (`--fd-boot-phase`, set by `bootSplashPhaseScript` or by React),
 * so a stage swap continues the motion instead of restarting it.
 */

export const BOOT_SPLASH_LOOP_MS = 2400;
export const BOOT_SPLASH_TITLE = "方小德正在来的路上";

export interface BootSplashStatus {
  readonly text: string;
  /** When the line appears, measured from when the screen first renders. */
  readonly atMs: number;
}

/** Stage 1: the local service is starting (a cold Windows start takes 8-12 s). */
export const BOOT_SPLASH_STARTUP_STATUSES: ReadonlyArray<BootSplashStatus> = [
  { text: "正在启动本地服务", atMs: 0 },
  { text: "正在准备工作台", atMs: 5_000 },
  { text: "第一次启动会稍慢一些，请稍候", atMs: 14_000 },
];

/** Stages 2 and 3: the service is up and the app is loading. */
export const BOOT_SPLASH_APP_STATUSES: ReadonlyArray<BootSplashStatus> = [
  { text: "正在准备工作台", atMs: 0 },
  { text: "马上就好", atMs: 6_000 },
];

export interface BootSplashMarkupOptions {
  readonly purpleSrc: string;
  readonly navySrc: string;
  readonly statuses: ReadonlyArray<BootSplashStatus>;
  /** Play the halves-converge intro (the first stage only). */
  readonly intro?: boolean;
  /** Let the whole surface drag the frameless desktop window. */
  readonly draggable?: boolean;
  readonly title?: string;
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Inner markup of the `.fd-boot` element; React renders the element itself. */
export function renderBootSplashContent(options: BootSplashMarkupOptions): string {
  const statuses = options.statuses
    .map((status, index) => {
      const next = options.statuses[index + 1];
      const timing = `--fd-boot-in:${status.atMs}ms;${next ? `--fd-boot-out:${next.atMs}ms;` : ""}`;
      return `<span class="fd-boot-status-line${next ? "" : " fd-boot-status-last"}" style="${timing}">${escapeHtml(status.text)}</span>`;
    })
    .join("");
  return (
    `<div class="fd-boot-stage" aria-hidden="true">` +
    `<div class="fd-boot-mark">` +
    `<img class="fd-boot-half fd-boot-purple" src="${escapeHtml(options.purpleSrc)}" alt="" draggable="false">` +
    `<img class="fd-boot-half fd-boot-navy" src="${escapeHtml(options.navySrc)}" alt="" draggable="false">` +
    `</div><div class="fd-boot-shadow"></div></div>` +
    `<div class="fd-boot-road" aria-hidden="true"><span></span></div>` +
    `<div class="fd-boot-title">${escapeHtml(options.title ?? BOOT_SPLASH_TITLE)}` +
    `<span class="fd-boot-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></div>` +
    `<div class="fd-boot-status">${statuses}</div>`
  );
}

/** The whole `.fd-boot` element, for the HTML stages. */
export function renderBootSplashMarkup(options: BootSplashMarkupOptions): string {
  const attributes = [
    `class="fd-boot"`,
    `role="status"`,
    `aria-live="polite"`,
    `aria-label="${escapeHtml(options.title ?? BOOT_SPLASH_TITLE)}"`,
    `data-intro="${options.intro ? "true" : "false"}"`,
    ...(options.draggable ? [`data-drag="true"`] : []),
  ];
  return `<div ${attributes.join(" ")}>${renderBootSplashContent(options)}</div>`;
}

/** Sets the loop phase from the wall clock, so each stage continues the motion. */
export const bootSplashPhaseScript = `document.documentElement.style.setProperty("--fd-boot-phase", -(Date.now() % ${BOOT_SPLASH_LOOP_MS}) + "ms");`;

// @effect-diagnostics-next-line globalDate:off - display timing for the loading screen.
export function bootSplashPhaseMs(now: number = Date.now()): number {
  return -(now % BOOT_SPLASH_LOOP_MS);
}

/**
 * Light by default; `.dark` on an ancestor (the web app's theme class, or the
 * startup document following the OS) switches the palette. The halves are
 * brightened in dark mode so the navy stays visible on a near-black page.
 */
export const BOOT_SPLASH_CSS = `
.fd-boot{--fd-boot-fg:#262626;--fd-boot-muted:#737373;--fd-boot-track:rgba(100,116,139,.16);--fd-boot-shadow:rgba(15,23,42,.2);
position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;min-height:100%;
box-sizing:border-box;padding:24px;color:var(--fd-boot-fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;
-webkit-user-select:none;user-select:none;cursor:default}
.dark .fd-boot{--fd-boot-fg:#f5f5f5;--fd-boot-muted:#a3a3a3;--fd-boot-track:rgba(148,163,184,.18);--fd-boot-shadow:rgba(0,0,0,.55)}
.fd-boot[data-drag="true"]{-webkit-app-region:drag}
.fd-boot-stage{display:flex;flex-direction:column;align-items:center}
.fd-boot-mark{position:relative;width:76px;height:75px;animation:fd-boot-float ${BOOT_SPLASH_LOOP_MS}ms ease-in-out var(--fd-boot-phase,0ms) infinite;will-change:transform}
.fd-boot-half{position:absolute;inset:0;width:100%;height:100%;-webkit-user-drag:none}
.dark .fd-boot-purple{filter:brightness(2.7) saturate(.9)}
.dark .fd-boot-navy{filter:brightness(2.4)}
.fd-boot[data-intro="true"] .fd-boot-purple{animation:fd-boot-purple-in .78s cubic-bezier(.16,1,.3,1) both}
.fd-boot[data-intro="true"] .fd-boot-navy{animation:fd-boot-navy-in .78s cubic-bezier(.16,1,.3,1) .08s both}
.fd-boot[data-intro="true"] .fd-boot-stage{animation:fd-boot-lock .34s ease-out .78s both}
.fd-boot-shadow{width:46px;height:8px;margin-top:12px;border-radius:50%;background:radial-gradient(closest-side,var(--fd-boot-shadow),transparent);
animation:fd-boot-shadow ${BOOT_SPLASH_LOOP_MS}ms ease-in-out var(--fd-boot-phase,0ms) infinite}
.fd-boot-road{position:relative;width:132px;height:3px;margin-top:18px;overflow:hidden;border-radius:999px;background:var(--fd-boot-track);
-webkit-mask-image:linear-gradient(90deg,transparent,#000 22%,#000 78%,transparent);mask-image:linear-gradient(90deg,transparent,#000 22%,#000 78%,transparent)}
.fd-boot-road span{position:absolute;top:0;left:0;width:44px;height:100%;border-radius:999px;background:linear-gradient(90deg,#6b3a5f,#1d4a8c);
animation:fd-boot-road ${BOOT_SPLASH_LOOP_MS}ms cubic-bezier(.45,0,.55,1) var(--fd-boot-phase,0ms) infinite}
.dark .fd-boot-road span{background:linear-gradient(90deg,#b56aa0,#5b8fe0)}
.fd-boot-title{margin-top:22px;font-size:15px;font-weight:600;letter-spacing:.02em;line-height:22px;white-space:nowrap}
.fd-boot-dots{display:inline-block;width:1.2em;text-align:left}
.fd-boot-dots i{font-style:normal;animation:fd-boot-dot ${BOOT_SPLASH_LOOP_MS / 2}ms ease-in-out var(--fd-boot-phase,0ms) infinite}
.fd-boot-dots i:nth-child(2){animation-delay:calc(var(--fd-boot-phase,0ms) + 160ms)}
.fd-boot-dots i:nth-child(3){animation-delay:calc(var(--fd-boot-phase,0ms) + 320ms)}
.fd-boot-status{position:relative;width:min(320px,90vw);height:18px;margin-top:8px;font-size:12.5px;line-height:18px;color:var(--fd-boot-muted)}
.fd-boot-status-line{position:absolute;inset:0;text-align:center;white-space:nowrap;opacity:0;
animation:fd-boot-fade-in .45s ease var(--fd-boot-in,0ms) forwards,fd-boot-fade-out .3s ease var(--fd-boot-out,0ms) forwards}
.fd-boot-status-last{animation:fd-boot-fade-in .45s ease var(--fd-boot-in,0ms) forwards}
.fd-boot[data-intro="false"] .fd-boot-status-line:first-child{animation-delay:-1s,var(--fd-boot-out,0ms)}
@keyframes fd-boot-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes fd-boot-shadow{0%,100%{transform:scaleX(1);opacity:1}50%{transform:scaleX(.74);opacity:.55}}
@keyframes fd-boot-purple-in{from{opacity:0;transform:translate(-30%,-30%)}to{opacity:1;transform:none}}
@keyframes fd-boot-navy-in{from{opacity:0;transform:translate(30%,30%)}to{opacity:1;transform:none}}
@keyframes fd-boot-lock{0%{transform:scale(1)}40%{transform:scale(1.07)}100%{transform:scale(1)}}
@keyframes fd-boot-road{0%{transform:translateX(-44px)}100%{transform:translateX(132px)}}
@keyframes fd-boot-dot{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes fd-boot-fade-in{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
@keyframes fd-boot-fade-out{from{opacity:1}to{opacity:0}}
@media (prefers-reduced-motion:reduce){
.fd-boot-mark,.fd-boot-shadow,.fd-boot-dots i,.fd-boot[data-intro="true"] .fd-boot-half,.fd-boot[data-intro="true"] .fd-boot-stage{animation:none}
.fd-boot-road span{animation:none;left:44px}}
`;
