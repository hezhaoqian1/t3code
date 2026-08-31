import * as Effect from "effect/Effect";

import * as DesktopIpc from "./DesktopIpc.ts";
import { getClientSettings, setClientSettings } from "./methods/clientSettings.ts";
import {
  checkForUpdate,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  setUpdateChannel,
} from "./methods/updates.ts";
import {
  confirm,
  getAppBranding,
  getLocalEnvironmentBootstraps,
  getLocalEnvironmentBearerToken,
  refreshLocalEnvironmentBearerToken,
  getWindowFullscreenState,
  openExternal,
  openPath,
  pickFolder,
  pickThemeFiles,
  setTheme,
  showContextMenu,
} from "./methods/window.ts";
import * as PreviewIpc from "./methods/preview.ts";
import * as AccountIpc from "./methods/account.ts";
import * as ConnectorIpc from "./methods/connectors.ts";
import * as PresentationIpc from "./methods/presentation.ts";

export const installDesktopIpcHandlers = Effect.fn("desktop.ipc.installHandlers")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  yield* PreviewIpc.installPreviewEventForwarding();
  yield* AccountIpc.installAccountStateForwarding();
  yield* ConnectorIpc.installConnectorStateForwarding();

  yield* ipc.handleSync(getAppBranding);
  yield* ipc.handleSync(getWindowFullscreenState);
  yield* ipc.handleSync(getLocalEnvironmentBootstraps);
  yield* ipc.handle(getLocalEnvironmentBearerToken);
  yield* ipc.handle(refreshLocalEnvironmentBearerToken);

  yield* ipc.handle(getClientSettings);
  yield* ipc.handle(setClientSettings);
  yield* ipc.handle(pickFolder);
  yield* ipc.handle(pickThemeFiles);
  yield* ipc.handle(confirm);
  yield* ipc.handle(setTheme);
  yield* ipc.handle(showContextMenu);
  yield* ipc.handle(openExternal);
  yield* ipc.handle(openPath);
  yield* ipc.handle(getUpdateState);
  yield* ipc.handle(setUpdateChannel);
  yield* ipc.handle(downloadUpdate);
  yield* ipc.handle(installUpdate);
  yield* ipc.handle(checkForUpdate);
  for (const previewMethod of PreviewIpc.methods) {
    yield* ipc.handle(previewMethod);
  }
  for (const accountMethod of AccountIpc.methods) {
    yield* ipc.handle(accountMethod);
  }
  for (const connectorMethod of ConnectorIpc.methods) {
    yield* ipc.handle(connectorMethod);
  }
  for (const presentationMethod of PresentationIpc.methods) {
    yield* ipc.handle(presentationMethod);
  }
});
