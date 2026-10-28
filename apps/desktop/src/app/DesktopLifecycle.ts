import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { makeComponentLogger } from "./DesktopObservability.ts";
import * as DesktopShutdown from "./DesktopShutdown.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronTheme from "../electron/ElectronTheme.ts";
import * as DesktopState from "./DesktopState.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";

export class DesktopLifecycleRelaunchError extends Schema.TaggedErrorClass<DesktopLifecycleRelaunchError>()(
  "DesktopLifecycleRelaunchError",
  {
    reason: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop relaunch failed for reason "${this.reason}".`;
  }
}

export type DesktopLifecycleRuntimeServices =
  | DesktopEnvironment.DesktopEnvironment
  | DesktopShutdown.DesktopShutdown
  | DesktopState.DesktopState
  | DesktopWindow.DesktopWindow
  | ElectronApp.ElectronApp
  | ElectronTheme.ElectronTheme;

/**
 * @effect-expect-leaking DesktopEnvironment | DesktopShutdown | DesktopState | DesktopWindow | ElectronApp | ElectronTheme
 */
export class DesktopLifecycle extends Context.Service<
  DesktopLifecycle,
  {
    readonly relaunch: (
      reason: string,
    ) => Effect.Effect<void, never, DesktopLifecycleRuntimeServices>;
    readonly register: Effect.Effect<void, never, Scope.Scope | DesktopLifecycleRuntimeServices>;
  }
>()("@t3tools/desktop/app/DesktopLifecycle") {}

const { logInfo: logLifecycleInfo, logError: logLifecycleError } =
  makeComponentLogger("desktop-lifecycle");

function addScopedListener<Args extends ReadonlyArray<unknown>>(
  target: unknown,
  eventName: string,
  listener: (...args: Args) => void,
): Effect.Effect<void, never, Scope.Scope> {
  const eventTarget = target as {
    on: (eventName: string, listener: (...args: Array<unknown>) => void) => unknown;
    removeListener: (eventName: string, listener: (...args: Array<unknown>) => void) => unknown;
  };
  const untypedListener = listener as unknown as (...args: Array<unknown>) => void;
  return Effect.acquireRelease(
    Effect.sync(() => {
      eventTarget.on(eventName, untypedListener);
    }),
    () =>
      Effect.sync(() => {
        eventTarget.removeListener(eventName, untypedListener);
      }),
  ).pipe(Effect.asVoid);
}

const requestDesktopShutdownAndWait = Effect.fn("desktop.lifecycle.requestShutdownAndWait")(
  function* (): Effect.fn.Return<
    void,
    never,
    DesktopShutdown.DesktopShutdown | DesktopWindow.DesktopWindow
  > {
    const shutdown = yield* DesktopShutdown.DesktopShutdown;
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    yield* desktopWindow.flushMainWindowBounds;
    yield* shutdown.request;
    yield* shutdown.awaitComplete;
  },
);

/** How long a quit may stall after shutdown before the windows are closed for it. */
export const QUIT_STALL_CLOSE_WINDOWS_AFTER = Duration.seconds(5);
/** How long closing the windows may take before the process exits outright. */
export const QUIT_STALL_EXIT_AFTER = Duration.seconds(3);

/**
 * Quits once shutdown has finished. The backend is already stopped at this
 * point, so a quit that stalls (a window that never closes) would leave a
 * dead app on screen: after a grace period the windows are closed directly,
 * and if even that does not end the process, it exits.
 */
export const quitAfterShutdown = (closeWindows: () => void) =>
  Effect.gen(function* () {
    const electronApp = yield* ElectronApp.ElectronApp;
    yield* electronApp.quit;
    yield* Effect.sleep(QUIT_STALL_CLOSE_WINDOWS_AFTER);
    yield* logLifecycleInfo("quit stalled; closing windows");
    yield* Effect.sync(closeWindows);
    yield* Effect.sleep(QUIT_STALL_EXIT_AFTER);
    yield* logLifecycleInfo("quit stalled; exiting");
    yield* electronApp.exit(0);
  });

interface QuitState {
  phase: "running" | "waiting" | "allowed";
  waitingSinceNanos: bigint;
}

// Longer than a backend's stop budget (SIGTERM, 5s grace, SIGKILL, 1s wait),
// so a double Quit at the start of a normal quit cannot cut the backend stop
// short and orphan it.
export const SHUTDOWN_STALL_THRESHOLD = Duration.seconds(10);

const startWaitingForShutdown = Effect.fn("desktop.lifecycle.startWaitingForShutdown")(function* (
  quit: QuitState,
) {
  quit.phase = "waiting";
  quit.waitingSinceNanos = yield* Clock.monotonicTimeNanos;
});

// While a quit waits on shutdown, `quitting` makes activation open nothing. If
// that shutdown stalls, a repeated Quit or SIGTERM is the user's only way out
// short of killing the process in Task Manager.
const exitIfShutdownStalled = Effect.fn("desktop.lifecycle.exitIfShutdownStalled")(function* (
  quit: QuitState,
  source: string,
) {
  const pendingMs = Number(
    ((yield* Clock.monotonicTimeNanos) - quit.waitingSinceNanos) / 1_000_000n,
  );
  if (pendingMs < Duration.toMillis(SHUTDOWN_STALL_THRESHOLD)) {
    yield* logLifecycleInfo("quit already in progress", { source, pendingMs });
    return;
  }
  yield* logLifecycleError("desktop shutdown stalled; exiting without it", { source, pendingMs });
  const electronApp = yield* ElectronApp.ElectronApp;
  yield* electronApp.exit(0);
});

const closeAllWindows = () => {
  for (const window of Electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.close();
  }
};

function handleBeforeQuit(
  event: Electron.Event,
  runEffect: <A, E>(effect: Effect.Effect<A, E, DesktopLifecycleRuntimeServices>) => Promise<A>,
  quit: QuitState,
): void {
  if (quit.phase === "allowed") {
    void runEffect(
      Effect.gen(function* () {
        const state = yield* DesktopState.DesktopState;
        yield* Ref.set(state.quitting, true);
        yield* logLifecycleInfo("before-quit received");
      }).pipe(Effect.withSpan("desktop.lifecycle.beforeQuit")),
    );
    return;
  }

  event.preventDefault();
  if (quit.phase === "waiting") {
    void runEffect(exitIfShutdownStalled(quit, "before-quit"));
    return;
  }
  void runEffect(
    Effect.gen(function* () {
      const state = yield* DesktopState.DesktopState;
      yield* startWaitingForShutdown(quit);
      yield* Ref.set(state.quitting, true);
      yield* logLifecycleInfo("before-quit received");
      yield* requestDesktopShutdownAndWait();
    }).pipe(Effect.withSpan("desktop.lifecycle.beforeQuit")),
  ).finally(() => {
    quit.phase = "allowed";
    void runEffect(
      quitAfterShutdown(closeAllWindows).pipe(
        Effect.withSpan("desktop.lifecycle.quitAfterShutdown"),
      ),
    );
  });
}

function quitFromSignal(
  signal: "SIGINT" | "SIGTERM",
  runEffect: <A, E>(effect: Effect.Effect<A, E, DesktopLifecycleRuntimeServices>) => Promise<A>,
  quit: QuitState,
): void {
  if (quit.phase === "waiting") {
    void runEffect(exitIfShutdownStalled(quit, signal));
    return;
  }
  void runEffect(
    Effect.gen(function* () {
      yield* Effect.annotateCurrentSpan({ signal });
      const electronApp = yield* ElectronApp.ElectronApp;
      const state = yield* DesktopState.DesktopState;
      const wasQuitting = yield* Ref.getAndSet(state.quitting, true);
      if (wasQuitting) return;
      yield* startWaitingForShutdown(quit);
      yield* logLifecycleInfo("process signal received", { signal });
      yield* requestDesktopShutdownAndWait();
      quit.phase = "allowed";
      yield* electronApp.quit;
    }).pipe(Effect.withSpan("desktop.lifecycle.processSignal")),
  );
}

export const make = DesktopLifecycle.of({
  relaunch: Effect.fn("desktop.lifecycle.relaunch")(function* (reason) {
    const electronApp = yield* ElectronApp.ElectronApp;
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const state = yield* DesktopState.DesktopState;
    yield* logLifecycleInfo("desktop relaunch requested", { reason });
    yield* Effect.gen(function* () {
      yield* Effect.yieldNow;
      yield* Ref.set(state.quitting, true);
      yield* requestDesktopShutdownAndWait();
      if (environment.isDevelopment) {
        yield* electronApp.exit(75);
        return;
      }
      yield* electronApp.relaunch({
        execPath: process.execPath,
        args: process.argv.slice(1),
      });
      yield* electronApp.exit(0);
    }).pipe(
      Effect.catchCause((cause) => {
        const error = new DesktopLifecycleRelaunchError({ reason, cause });
        return logLifecycleError(error.message, { error });
      }),
      Effect.forkDetach,
      Effect.asVoid,
    );
  }),
  register: Effect.gen(function* () {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    const electronApp = yield* ElectronApp.ElectronApp;
    const electronTheme = yield* ElectronTheme.ElectronTheme;
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const context = yield* Effect.context<DesktopLifecycleRuntimeServices>();
    const runEffect = Effect.runPromiseWith(context);
    const quit: QuitState = { phase: "running", waitingSinceNanos: 0n };

    // Electron scopes this lock to userData, which startup points at the real
    // product directory before lifecycle registration. A secondary launch
    // must stop here, before it can create its own backend and renderer tree.
    const isPrimaryInstance = yield* Effect.sync(() => Electron.app.requestSingleInstanceLock());
    if (!isPrimaryInstance) {
      yield* logLifecycleInfo("secondary instance exiting");
      yield* electronApp.quit;
      return yield* Effect.interrupt;
    }

    yield* electronApp.on("second-instance", () => {
      void runEffect(
        desktopWindow.activate.pipe(Effect.withSpan("desktop.lifecycle.secondInstance")),
      );
    });
    yield* electronTheme.onUpdated(() => {
      void runEffect(
        desktopWindow.syncAppearance.pipe(Effect.withSpan("desktop.lifecycle.themeUpdated")),
      );
    });
    yield* electronApp.onBeforeQuitForUpdate(() => {
      // Electron's updater owns the remaining quit/install/relaunch sequence.
      // Cancelling the following app "before-quit" event breaks that sequence,
      // most visibly on macOS where the native updater performs the relaunch.
      quit.phase = "allowed";
      void runEffect(
        logLifecycleInfo("allowing updater-controlled quit").pipe(
          Effect.withSpan("desktop.lifecycle.beforeQuitForUpdate"),
        ),
      );
    });
    yield* electronApp.on("before-quit", (event: Electron.Event) => {
      handleBeforeQuit(event, runEffect, quit);
    });
    yield* electronApp.on("activate", () => {
      void runEffect(desktopWindow.activate.pipe(Effect.withSpan("desktop.lifecycle.activate")));
    });
    yield* electronApp.on("window-all-closed", () => {
      void runEffect(
        Effect.gen(function* () {
          const app = yield* ElectronApp.ElectronApp;
          const state = yield* DesktopState.DesktopState;
          if (environment.platform !== "darwin" && !(yield* Ref.get(state.quitting))) {
            yield* app.quit;
          }
        }).pipe(Effect.withSpan("desktop.lifecycle.windowAllClosed")),
      );
    });

    if (environment.platform !== "win32") {
      yield* addScopedListener(process, "SIGINT", () => {
        quitFromSignal("SIGINT", runEffect, quit);
      });
      yield* addScopedListener(process, "SIGTERM", () => {
        quitFromSignal("SIGTERM", runEffect, quit);
      });
    }
  }).pipe(Effect.withSpan("desktop.lifecycle.register")),
});

export const layer = Layer.succeed(DesktopLifecycle, make);
