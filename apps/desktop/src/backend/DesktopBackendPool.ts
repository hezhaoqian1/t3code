import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as DesktopBackendConfiguration from "./DesktopBackendConfiguration.ts";
import * as DesktopBackendManager from "./DesktopBackendManager.ts";

export type BackendInstanceId = DesktopBackendManager.BackendInstanceId;
export const BackendInstanceId = DesktopBackendManager.BackendInstanceId;
export const PRIMARY_INSTANCE_ID = DesktopBackendManager.PRIMARY_INSTANCE_ID;
export type DesktopBackendInstance = DesktopBackendManager.DesktopBackendInstance;

export class DesktopBackendPool extends Context.Service<
  DesktopBackendPool,
  {
    readonly primary: Effect.Effect<DesktopBackendInstance>;
    readonly list: Effect.Effect<ReadonlyArray<DesktopBackendInstance>>;
  }
>()("@t3tools/desktop/backend/DesktopBackendPool") {}

export const layer = Layer.effect(
  DesktopBackendPool,
  Effect.gen(function* () {
    const configuration = yield* DesktopBackendConfiguration.DesktopBackendConfiguration;
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    const primary = yield* DesktopBackendManager.makeBackendInstance({
      id: DesktopBackendManager.PRIMARY_INSTANCE_ID,
      label: configuration.resolvePrimaryLabel,
      configResolve: configuration.resolvePrimary,
      onReady: (httpBaseUrl) =>
        desktopWindow
          .handleBackendReady(httpBaseUrl)
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("Failed to open the main window after backend readiness.").pipe(
                Effect.annotateLogs({ component: "desktop-backend", error: error.message }),
              ),
            ),
          ),
      onShutdown: () => desktopWindow.handleBackendNotReady,
    });

    return DesktopBackendPool.of({
      primary: Effect.succeed(primary),
      list: Effect.succeed([primary]),
    });
  }),
);

export const layerTest = (
  instances: ReadonlyArray<DesktopBackendInstance>,
): Layer.Layer<DesktopBackendPool> =>
  Layer.effect(
    DesktopBackendPool,
    Effect.gen(function* () {
      const primary = instances[0];
      if (primary === undefined) {
        return yield* Effect.die("DesktopBackendPool.layerTest requires one primary instance");
      }
      return DesktopBackendPool.of({
        primary: Effect.succeed(primary),
        list: Effect.succeed([primary]),
      });
    }),
  );
