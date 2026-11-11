import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as ElectronWindow from "../electron/ElectronWindow.ts";

export interface DesktopIpcInvokeEvent {
  readonly sender: { readonly id: number };
  readonly senderFrame?: unknown;
}

export interface DesktopIpcSyncEvent extends DesktopIpcInvokeEvent {
  returnValue: unknown;
}

/** Whether an IPC event came from the main app window's top frame. */
export type DesktopIpcSenderGuard = (event: DesktopIpcInvokeEvent) => Effect.Effect<boolean>;

/** The parts of an Electron webContents the sender check reads. */
export interface DesktopIpcSecondaryWebContents {
  readonly id: number;
  readonly mainFrame: unknown;
  isDestroyed(): boolean;
  once(event: "destroyed", listener: () => void): unknown;
}

/**
 * A fork-owned window other than the main window (today: the 方德演示
 * presentation editor) that loads the desktop preload and may call a fixed
 * set of channels, but only from its top frame and only while that frame
 * still shows the page the window was opened for.
 */
export interface DesktopIpcSecondaryWindow {
  readonly webContents: DesktopIpcSecondaryWebContents;
  readonly channels: ReadonlyArray<string>;
  readonly isAllowedUrl: (url: string) => boolean;
}

export type DesktopIpcHandleListener = (
  event: DesktopIpcInvokeEvent,
  raw: unknown,
) => unknown | Promise<unknown>;

export type DesktopIpcSyncListener = (event: DesktopIpcSyncEvent) => void;

export interface DesktopIpcMain {
  removeHandler(channel: string): void;
  handle(channel: string, listener: DesktopIpcHandleListener): void;
  removeAllListeners(channel: string): void;
  on(channel: string, listener: DesktopIpcSyncListener): void;
}

export class DesktopIpcRegistrationError extends Schema.TaggedErrorClass<DesktopIpcRegistrationError>()(
  "DesktopIpcRegistrationError",
  {
    handlerKind: Schema.Literals(["invoke", "sync"]),
    channel: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to register the ${this.handlerKind} IPC handler for ${this.channel}.`;
  }
}

export class DesktopIpcUnregistrationError extends Schema.TaggedErrorClass<DesktopIpcUnregistrationError>()(
  "DesktopIpcUnregistrationError",
  {
    handlerKind: Schema.Literals(["invoke", "sync"]),
    channel: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to unregister the ${this.handlerKind} IPC handler for ${this.channel}.`;
  }
}

export class DesktopIpcUntrustedSenderError extends Schema.TaggedErrorClass<DesktopIpcUntrustedSenderError>()(
  "DesktopIpcUntrustedSenderError",
  { channel: Schema.String },
) {
  override get message(): string {
    return `Rejected ${this.channel} from a sender that is not the app window.`;
  }
}

export const DesktopIpcError = Schema.Union([
  DesktopIpcRegistrationError,
  DesktopIpcUnregistrationError,
]);
export type DesktopIpcError = typeof DesktopIpcError.Type;
export const isDesktopIpcError = Schema.is(DesktopIpcError);

export interface DesktopIpcMethod<E, R> {
  readonly channel: string;
  readonly handler: (raw: unknown) => Effect.Effect<unknown, E, R>;
}

export interface DesktopSyncIpcMethod<E, R> {
  readonly channel: string;
  readonly handler: () => Effect.Effect<unknown, E, R>;
}

export class DesktopIpc extends Context.Service<
  DesktopIpc,
  {
    readonly handle: <E, R>(
      input: DesktopIpcMethod<E, R>,
    ) => Effect.Effect<void, DesktopIpcRegistrationError, R | Scope.Scope>;
    readonly handleSync: <E, R>(
      input: DesktopSyncIpcMethod<E, R>,
    ) => Effect.Effect<void, DesktopIpcRegistrationError, R | Scope.Scope>;
    /** Lets a secondary window call `channels` until its webContents is destroyed. */
    readonly allowSecondaryWindow: (window: DesktopIpcSecondaryWindow) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/ipc/DesktopIpc") {}

function frameUrl(frame: unknown): string | undefined {
  if (typeof frame !== "object" || frame === null || !("url" in frame)) return undefined;
  return typeof frame.url === "string" ? frame.url : undefined;
}

// ipcMain is shared by every webContents, including preview guests that load
// arbitrary pages, so every channel answers only the main window's top frame
// plus any secondary window explicitly allowed for that channel.
export const make = (
  ipcMain: DesktopIpcMain,
  isMainWindowSender: DesktopIpcSenderGuard,
): DesktopIpc["Service"] => {
  const secondaryWindows = new Map<number, DesktopIpcSecondaryWindow>();

  const isSecondaryWindowSender = (channel: string, event: DesktopIpcInvokeEvent): boolean => {
    const window = secondaryWindows.get(event.sender.id);
    if (window === undefined || window.webContents.isDestroyed()) return false;
    if (!window.channels.includes(channel)) return false;
    if (window.webContents.mainFrame !== event.senderFrame) return false;
    const url = frameUrl(event.senderFrame);
    return url !== undefined && window.isAllowedUrl(url);
  };

  const isTrustedSender = (channel: string, event: DesktopIpcInvokeEvent) =>
    Effect.map(
      isMainWindowSender(event),
      (isMain) => isMain || isSecondaryWindowSender(channel, event),
    );

  return DesktopIpc.of({
    handle: Effect.fn("desktop.ipc.registerInvoke")(function* <E, R>({
      channel,
      handler,
    }: DesktopIpcMethod<E, R>) {
      yield* Effect.annotateCurrentSpan({ channel });
      const context = yield* Effect.context<R>();
      const runPromise = Effect.runPromiseWith(context);

      yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            ipcMain.removeHandler(channel);
            ipcMain.handle(channel, (event, raw) =>
              runPromise(
                Effect.gen(function* () {
                  yield* Effect.annotateCurrentSpan({ channel });
                  if (!(yield* isTrustedSender(channel, event))) {
                    yield* Effect.logWarning("Rejected IPC from an untrusted sender.");
                    return yield* new DesktopIpcUntrustedSenderError({ channel });
                  }
                  return yield* handler(raw);
                }).pipe(Effect.annotateLogs({ channel }), Effect.withSpan("desktop.ipc.invoke")),
              ),
            );
          },
          catch: (cause) =>
            new DesktopIpcRegistrationError({ handlerKind: "invoke", channel, cause }),
        }),
        () =>
          Effect.try({
            try: () => ipcMain.removeHandler(channel),
            catch: (cause) =>
              new DesktopIpcUnregistrationError({ handlerKind: "invoke", channel, cause }),
          }).pipe(Effect.orDie),
      );
    }),

    handleSync: Effect.fn("desktop.ipc.registerSync")(function* <E, R>({
      channel,
      handler,
    }: DesktopSyncIpcMethod<E, R>) {
      yield* Effect.annotateCurrentSpan({ channel });
      const context = yield* Effect.context<R>();
      const runSync = Effect.runSyncWith(context);

      yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            ipcMain.removeAllListeners(channel);
            ipcMain.on(channel, (event) => {
              event.returnValue = runSync(
                Effect.gen(function* () {
                  yield* Effect.annotateCurrentSpan({ channel });
                  // Throwing here would surface as an uncaught main-process exception.
                  if (!(yield* isTrustedSender(channel, event))) {
                    yield* Effect.logWarning("Rejected sync IPC from an untrusted sender.");
                    return undefined;
                  }
                  return yield* handler();
                }).pipe(
                  Effect.annotateLogs({ channel }),
                  Effect.withSpan("desktop.ipc.invokeSync"),
                ),
              );
            });
          },
          catch: (cause) =>
            new DesktopIpcRegistrationError({ handlerKind: "sync", channel, cause }),
        }),
        () =>
          Effect.try({
            try: () => ipcMain.removeAllListeners(channel),
            catch: (cause) =>
              new DesktopIpcUnregistrationError({ handlerKind: "sync", channel, cause }),
          }).pipe(Effect.orDie),
      );
    }),

    allowSecondaryWindow: (window) =>
      Effect.sync(() => {
        const { webContents } = window;
        secondaryWindows.set(webContents.id, window);
        webContents.once("destroyed", () => {
          if (secondaryWindows.get(webContents.id) === window) {
            secondaryWindows.delete(webContents.id);
          }
        });
      }),
  });
};

export const layer = (ipcMain: DesktopIpcMain) =>
  Layer.effect(
    DesktopIpc,
    Effect.gen(function* () {
      const electronWindow = yield* ElectronWindow.ElectronWindow;
      return make(ipcMain, (event) =>
        Effect.map(
          electronWindow.main,
          (main) =>
            Option.isSome(main) &&
            main.value.webContents.id === event.sender.id &&
            main.value.webContents.mainFrame === event.senderFrame,
        ),
      );
    }),
  );

/** Answers every sender; for tests that exercise the methods, not the guard. */
export const layerTest = (ipcMain: DesktopIpcMain) =>
  Layer.succeed(
    DesktopIpc,
    make(ipcMain, () => Effect.succeed(true)),
  );

/**
 * Convenience helpers for creating IPC methods
 */

export interface DesktopIpcMethodRegistration<
  Payload,
  EncodedPayload,
  Result,
  EncodedResult,
  E,
  R,
  PayloadDecodingServices = never,
  PayloadEncodingServices = never,
  ResultDecodingServices = never,
  ResultEncodingServices = never,
> {
  readonly channel: string;
  readonly payload: Schema.Codec<
    Payload,
    EncodedPayload,
    PayloadDecodingServices,
    PayloadEncodingServices
  >;
  readonly result: Schema.Codec<
    Result,
    EncodedResult,
    ResultDecodingServices,
    ResultEncodingServices
  >;
  readonly handler: (input: Payload) => Effect.Effect<Result, E, R>;
}

export const makeIpcMethod = <
  Payload,
  EncodedPayload,
  Result,
  EncodedResult,
  E,
  R,
  PayloadDecodingServices = never,
  PayloadEncodingServices = never,
  ResultDecodingServices = never,
  ResultEncodingServices = never,
>(
  method: DesktopIpcMethodRegistration<
    Payload,
    EncodedPayload,
    Result,
    EncodedResult,
    E,
    R,
    PayloadDecodingServices,
    PayloadEncodingServices,
    ResultDecodingServices,
    ResultEncodingServices
  >,
): DesktopIpcMethod<
  E | Schema.SchemaError,
  R | PayloadDecodingServices | ResultEncodingServices
> => {
  const decode = Schema.decodeUnknownEffect(method.payload);
  const encode = Schema.encodeUnknownEffect(method.result);

  return {
    channel: method.channel,
    handler: (raw) =>
      decode(raw).pipe(
        Effect.flatMap(method.handler),
        Effect.flatMap(encode),
        Effect.withSpan("desktop.ipc.method", { attributes: { channel: method.channel } }),
      ),
  };
};

export interface DesktopSyncIpcMethodRegistration<
  Result,
  EncodedResult,
  E,
  R,
  ResultDecodingServices = never,
  ResultEncodingServices = never,
> {
  readonly channel: string;
  readonly result: Schema.Codec<
    Result,
    EncodedResult,
    ResultDecodingServices,
    ResultEncodingServices
  >;
  readonly handler: () => Effect.Effect<Result, E, R>;
}

export const makeSyncIpcMethod = <
  Result,
  EncodedResult,
  E,
  R,
  ResultDecodingServices = never,
  ResultEncodingServices = never,
>(
  method: DesktopSyncIpcMethodRegistration<
    Result,
    EncodedResult,
    E,
    R,
    ResultDecodingServices,
    ResultEncodingServices
  >,
): DesktopSyncIpcMethod<E | Schema.SchemaError, R | ResultEncodingServices> => {
  const encode = Schema.encodeUnknownEffect(method.result);

  return {
    channel: method.channel,
    handler: () =>
      method
        .handler()
        .pipe(
          Effect.flatMap(encode),
          Effect.withSpan("desktop.ipc.method", { attributes: { channel: method.channel } }),
        ),
  };
};
