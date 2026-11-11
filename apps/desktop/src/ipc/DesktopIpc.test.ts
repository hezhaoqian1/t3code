import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({}));

import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopIpc from "./DesktopIpc.ts";

const invokeMethod: DesktopIpc.DesktopIpcMethod<never, never> = {
  channel: "desktop.test.invoke",
  handler: () => Effect.void,
};

const syncMethod: DesktopIpc.DesktopSyncIpcMethod<never, never> = {
  channel: "desktop.test.sync",
  handler: () => Effect.void,
};

function makeIpcMain(
  overrides: Partial<DesktopIpc.DesktopIpcMain> = {},
): DesktopIpc.DesktopIpcMain {
  return {
    removeHandler: vi.fn(),
    handle: vi.fn(),
    removeAllListeners: vi.fn(),
    on: vi.fn(),
    ...overrides,
  };
}

describe("DesktopIpc", () => {
  it.effect("preserves invoke registration context and cause", () =>
    Effect.gen(function* () {
      const cause = new Error("invoke registration failed");
      const ipcMain = makeIpcMain({
        handle: () => {
          throw cause;
        },
      });
      const ipc = DesktopIpc.make(ipcMain, () => Effect.succeed(true));

      const error = yield* Effect.flip(Effect.scoped(ipc.handle(invokeMethod)));

      assert.instanceOf(error, DesktopIpc.DesktopIpcRegistrationError);
      assert.isTrue(DesktopIpc.isDesktopIpcError(error));
      assert.strictEqual(error.handlerKind, "invoke");
      assert.strictEqual(error.channel, invokeMethod.channel);
      assert.strictEqual(error.cause, cause);
      assert.include(error.message, "invoke");
      assert.include(error.message, invokeMethod.channel);
      assert.notInclude(error.message, cause.message);
    }),
  );

  it.effect("preserves sync unregistration context and cause in the finalizer defect", () =>
    Effect.gen(function* () {
      const cause = new Error("sync unregistration failed");
      let removeCount = 0;
      const ipcMain = makeIpcMain({
        removeAllListeners: () => {
          removeCount += 1;
          if (removeCount === 2) throw cause;
        },
      });
      const ipc = DesktopIpc.make(ipcMain, () => Effect.succeed(true));

      const exit = yield* Effect.exit(Effect.scoped(ipc.handleSync(syncMethod)));

      assert.isTrue(exit._tag === "Failure");
      if (exit._tag === "Success") return;
      const error = Cause.squash(exit.cause);
      assert.instanceOf(error, DesktopIpc.DesktopIpcUnregistrationError);
      assert.isTrue(DesktopIpc.isDesktopIpcError(error));
      assert.strictEqual(error.handlerKind, "sync");
      assert.strictEqual(error.channel, syncMethod.channel);
      assert.strictEqual(error.cause, cause);
      assert.notInclude(error.message, cause.message);
    }),
  );

  it.effect("answers only the main window's top frame", () =>
    Effect.gen(function* () {
      const mainFrame = { url: "fdai://app/" };
      const invoke = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
      const sync = new Map<string, DesktopIpc.DesktopIpcSyncListener>();
      const ipc = yield* DesktopIpc.DesktopIpc.pipe(
        Effect.provide(
          DesktopIpc.layer({
            removeHandler: (channel) => void invoke.delete(channel),
            handle: (channel, listener) => void invoke.set(channel, listener),
            removeAllListeners: (channel) => void sync.delete(channel),
            on: (channel, listener) => void sync.set(channel, listener),
          }).pipe(
            Layer.provide(
              Layer.mock(ElectronWindow.ElectronWindow, {
                main: Effect.succeedSome({
                  webContents: { id: 1, mainFrame },
                } as unknown as Electron.BrowserWindow),
              }),
            ),
          ),
        ),
      );
      yield* ipc.handle(
        DesktopIpc.makeIpcMethod({
          channel: "token",
          payload: Schema.Void,
          result: Schema.String,
          handler: () => Effect.succeed("secret"),
        }),
      );
      yield* ipc.handleSync({ channel: "token-sync", handler: () => Effect.succeed("secret") });

      const senders = {
        app: { sender: { id: 1 }, senderFrame: mainFrame },
        appSubframe: { sender: { id: 1 }, senderFrame: { url: "fdai://app/" } },
        appWithoutFrame: { sender: { id: 1 }, senderFrame: null },
        previewGuest: { sender: { id: 2 }, senderFrame: { url: "https://example.com/" } },
      };
      const results: Record<string, unknown> = {};
      for (const [name, sender] of Object.entries(senders)) {
        const event = { ...sender, returnValue: "unset" as unknown };
        sync.get("token-sync")!(event);
        results[name] = [
          yield* Effect.promise(() =>
            Promise.resolve(invoke.get("token")!(sender, undefined)).catch(() => "rejected"),
          ),
          event.returnValue,
        ];
      }
      assert.deepEqual(results, {
        app: ["secret", "secret"],
        appSubframe: ["rejected", undefined],
        appWithoutFrame: ["rejected", undefined],
        previewGuest: ["rejected", undefined],
      });
    }).pipe(Effect.scoped),
  );

  it.effect("answers nothing before the main window exists", () =>
    Effect.gen(function* () {
      const invoke = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
      const ipc = yield* DesktopIpc.DesktopIpc.pipe(
        Effect.provide(
          DesktopIpc.layer(
            makeIpcMain({ handle: (channel, listener) => void invoke.set(channel, listener) }),
          ).pipe(
            Layer.provide(Layer.mock(ElectronWindow.ElectronWindow, { main: Effect.succeedNone })),
          ),
        ),
      );
      yield* ipc.handle({ channel: "token", handler: () => Effect.succeed("secret") });

      const result = yield* Effect.promise(() =>
        Promise.resolve(invoke.get("token")!({ sender: { id: 1 }, senderFrame: {} }, undefined))
          .then(() => "answered")
          .catch((error: unknown) => error),
      );
      assert.notStrictEqual(result, "answered");
      assert.include(String(result), "token");
    }).pipe(Effect.scoped),
  );

  it.effect("answers a secondary window only on its channels, top frame and page", () =>
    Effect.gen(function* () {
      const invoke = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
      const sync = new Map<string, DesktopIpc.DesktopIpcSyncListener>();
      const ipc = DesktopIpc.make(
        makeIpcMain({
          handle: (channel, listener) => void invoke.set(channel, listener),
          on: (channel, listener) => void sync.set(channel, listener),
        }),
        (event) => Effect.succeed(event.sender.id === 1),
      );
      for (const channel of ["read", "write", "token"]) {
        yield* ipc.handle({ channel, handler: () => Effect.succeed(channel) });
      }
      yield* ipc.handleSync({ channel: "branding", handler: () => Effect.succeed("branding") });

      const editorFrame = { url: "file:///editor/index.html?desktopProjectPath=%2Fdeck" };
      let destroyed = false;
      let onDestroyed: (() => void) | undefined;
      yield* ipc.allowSecondaryWindow({
        webContents: {
          id: 5,
          get mainFrame() {
            return editorFrame;
          },
          isDestroyed: () => destroyed,
          once: (_event, listener) => {
            onDestroyed = listener;
          },
        },
        channels: ["read", "write"],
        isAllowedUrl: (url) => {
          const parsed = new URL(url);
          return parsed.protocol === "file:" && parsed.pathname === "/editor/index.html";
        },
      });

      const call = (channel: string, event: DesktopIpc.DesktopIpcInvokeEvent) =>
        Effect.promise(() =>
          Promise.resolve(invoke.get(channel)!(event, undefined)).catch(() => "rejected"),
        );
      const editor = { sender: { id: 5 }, senderFrame: editorFrame };

      assert.strictEqual(yield* call("read", editor), "read");
      assert.strictEqual(yield* call("write", editor), "write");
      // Channels the editor was not allowed stay closed, sync ones included.
      assert.strictEqual(yield* call("token", editor), "rejected");
      const syncEvent = { ...editor, returnValue: "unset" as unknown };
      sync.get("branding")!(syncEvent);
      assert.isUndefined(syncEvent.returnValue);
      // Subframes and other webContents do not inherit the editor's access.
      assert.strictEqual(
        yield* call("read", { sender: { id: 5 }, senderFrame: { url: editorFrame.url } }),
        "rejected",
      );
      assert.strictEqual(
        yield* call("read", { sender: { id: 6 }, senderFrame: editorFrame }),
        "rejected",
      );
      // The editor loses access once it navigates off the bundled page.
      editorFrame.url = "https://example.com/editor/index.html";
      assert.strictEqual(yield* call("read", editor), "rejected");
      editorFrame.url = "file:///editor/index.html#slide-2";
      assert.strictEqual(yield* call("read", editor), "read");

      destroyed = true;
      assert.strictEqual(yield* call("read", editor), "rejected");
      // A destroyed editor is forgotten, so a reused webContents id gains nothing.
      destroyed = false;
      onDestroyed!();
      assert.strictEqual(yield* call("read", editor), "rejected");
      assert.strictEqual(yield* call("token", { sender: { id: 1 }, senderFrame: {} }), "token");
    }).pipe(Effect.scoped),
  );
});
