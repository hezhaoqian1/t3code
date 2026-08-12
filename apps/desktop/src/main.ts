for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code !== "EPIPE") throw err;
  });
}

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeOS from "node:os";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";

import * as NetService from "@t3tools/shared/Net";
import { HostProcessArchitecture, HostProcessPlatform } from "@t3tools/shared/hostProcess";

import * as DesktopIpc from "./ipc/DesktopIpc.ts";
import * as ElectronApp from "./electron/ElectronApp.ts";
import * as ElectronDialog from "./electron/ElectronDialog.ts";
import * as ElectronMenu from "./electron/ElectronMenu.ts";
import * as ElectronPowerMonitor from "./electron/ElectronPowerMonitor.ts";
import * as ElectronProtocol from "./electron/ElectronProtocol.ts";
import * as ElectronSafeStorage from "./electron/ElectronSafeStorage.ts";
import * as ElectronShell from "./electron/ElectronShell.ts";
import * as ElectronTheme from "./electron/ElectronTheme.ts";
import * as ElectronUpdater from "./electron/ElectronUpdater.ts";
import * as ElectronWindow from "./electron/ElectronWindow.ts";
import * as DesktopApp from "./app/DesktopApp.ts";
import * as DesktopAppIdentity from "./app/DesktopAppIdentity.ts";
import * as DesktopApplicationMenu from "./window/DesktopApplicationMenu.ts";
import * as DesktopAssets from "./app/DesktopAssets.ts";
import * as DesktopBackendConfiguration from "./backend/DesktopBackendConfiguration.ts";
import * as DesktopBackendPool from "./backend/DesktopBackendPool.ts";
import * as DesktopLocalEnvironmentAuth from "./backend/DesktopLocalEnvironmentAuth.ts";
import * as DesktopEnvironment from "./app/DesktopEnvironment.ts";
import * as DesktopLifecycle from "./app/DesktopLifecycle.ts";
import * as DesktopLinuxUrlHandler from "./app/DesktopLinuxUrlHandler.ts";
import * as DesktopShutdown from "./app/DesktopShutdown.ts";
import * as DesktopObservability from "./app/DesktopObservability.ts";
import * as DesktopClientSettings from "./settings/DesktopClientSettings.ts";
import * as DesktopAppSettings from "./settings/DesktopAppSettings.ts";
import * as DesktopPreReadyPlatform from "./app/DesktopPreReadyPlatform.ts";
import * as DesktopShellEnvironment from "./shell/DesktopShellEnvironment.ts";
import * as DesktopState from "./app/DesktopState.ts";
import * as DesktopTelemetryPublisher from "./telemetry/DesktopTelemetryPublisher.ts";
import * as FdCredentialPublisher from "./fd-identity/FdCredentialPublisher.ts";
import * as FdIdentity from "./fd-identity/FdIdentity.ts";
import * as DesktopUpdates from "./updates/DesktopUpdates.ts";
import * as BrowserSession from "./preview/BrowserSession.ts";
import * as PreviewManager from "./preview/Manager.ts";
import * as DesktopWindow from "./window/DesktopWindow.ts";

const desktopEnvironmentLayer = Layer.unwrap(
  Effect.gen(function* () {
    const metadata = yield* Effect.service(ElectronApp.ElectronApp).pipe(
      Effect.flatMap((app) => app.metadata),
    );
    const platform = yield* HostProcessPlatform;
    const processArch = yield* HostProcessArchitecture;
    return DesktopEnvironment.layer({
      dirname: __dirname,
      homeDirectory: NodeOS.homedir(),
      platform,
      processArch,
      ...metadata,
    });
  }),
);

const electronLayer = Layer.mergeAll(
  ElectronApp.layer,
  ElectronDialog.layer,
  ElectronMenu.layer,
  ElectronPowerMonitor.layer,
  ElectronProtocol.layer,
  ElectronSafeStorage.layer,
  ElectronShell.layer,
  ElectronTheme.layer,
  ElectronUpdater.layer,
  ElectronWindow.layer,
  DesktopIpc.layer(Electron.ipcMain),
);

const desktopFoundationBaseLayer = Layer.mergeAll(
  DesktopState.layer,
  DesktopShutdown.layer,
  DesktopAppSettings.layer,
  DesktopClientSettings.layer,
  DesktopAssets.layer,
  DesktopObservability.layer,
).pipe(Layer.provideMerge(desktopEnvironmentLayer));

const desktopFoundationLayer = DesktopAppIdentity.layer.pipe(
  Layer.provideMerge(desktopFoundationBaseLayer),
);

const desktopPreviewLayer = PreviewManager.layer.pipe(
  Layer.provideMerge(BrowserSession.layer),
  Layer.provideMerge(desktopFoundationLayer),
);

const desktopWindowLayer = DesktopWindow.layer.pipe(
  Layer.provideMerge(desktopPreviewLayer),
  Layer.provideMerge(desktopFoundationLayer),
);

const fdCredentialPublisherLayer = FdCredentialPublisher.layer;

const desktopBackendLayer = DesktopBackendPool.layer.pipe(
  Layer.provideMerge(DesktopBackendConfiguration.layer),
  Layer.provideMerge(DesktopTelemetryPublisher.layer),
  Layer.provideMerge(desktopWindowLayer),
);

const desktopLocalEnvironmentAuthLayer = DesktopLocalEnvironmentAuth.layer.pipe(
  Layer.provideMerge(desktopBackendLayer),
);

const desktopApplicationLayer = Layer.mergeAll(
  DesktopLifecycle.layer,
  DesktopApplicationMenu.layer,
  DesktopLinuxUrlHandler.layer,
  DesktopShellEnvironment.layer,
  FdIdentity.layer,
).pipe(
  Layer.provideMerge(DesktopUpdates.layer),
  Layer.provideMerge(desktopLocalEnvironmentAuthLayer),
  Layer.provideMerge(fdCredentialPublisherLayer),
  Layer.provideMerge(desktopFoundationLayer),
);

const desktopApplicationRuntimeLayer = desktopApplicationLayer.pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(NodeHttpClient.layerUndici),
  Layer.provideMerge(NetService.layer),
  Layer.provideMerge(electronLayer),
);

const desktopRuntimeLayer = desktopApplicationRuntimeLayer.pipe(
  Layer.provideMerge(DesktopPreReadyPlatform.layer),
);

DesktopApp.program.pipe(Effect.provide(desktopRuntimeLayer), NodeRuntime.runMain);
