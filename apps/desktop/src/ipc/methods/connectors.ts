import {
  FdConnectorConnectPayload,
  FdConnectorConnectResponse,
  FdConnectorDisconnectPayload,
  FdConnectorDisconnectResponse,
  FdConnectorGetStatePayload,
  FdConnectorGetStateResponse,
  FdConnectorRefreshPayload,
  FdConnectorRefreshResponse,
  FdConnectorSetEnabledPayload,
  FdConnectorSetEnabledResponse,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as FeishuConnector from "../../connectors/FeishuConnector.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const installConnectorStateForwarding = Effect.fn(
  "desktop.ipc.connectors.installStateForwarding",
)(function* () {
  const connector = yield* FeishuConnector.FeishuConnector;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  yield* connector.subscribe((state) =>
    electronWindow.sendAll(IpcChannels.FEISHU_CONNECTOR_STATE_CHANGED_CHANNEL, state),
  );
});

export const getFeishuState = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FEISHU_CONNECTOR_GET_STATE_CHANNEL,
  payload: FdConnectorGetStatePayload,
  result: FdConnectorGetStateResponse,
  handler: Effect.fn("desktop.ipc.connectors.feishu.getState")(function* () {
    return yield* (yield* FeishuConnector.FeishuConnector).getState;
  }),
});

export const refreshFeishu = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FEISHU_CONNECTOR_REFRESH_CHANNEL,
  payload: FdConnectorRefreshPayload,
  result: FdConnectorRefreshResponse,
  handler: Effect.fn("desktop.ipc.connectors.feishu.refresh")(function* () {
    return yield* (yield* FeishuConnector.FeishuConnector).refresh;
  }),
});

export const connectFeishu = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FEISHU_CONNECTOR_CONNECT_CHANNEL,
  payload: FdConnectorConnectPayload,
  result: FdConnectorConnectResponse,
  handler: Effect.fn("desktop.ipc.connectors.feishu.connect")(function* () {
    return yield* (yield* FeishuConnector.FeishuConnector).connect;
  }),
});

export const disconnectFeishu = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FEISHU_CONNECTOR_DISCONNECT_CHANNEL,
  payload: FdConnectorDisconnectPayload,
  result: FdConnectorDisconnectResponse,
  handler: Effect.fn("desktop.ipc.connectors.feishu.disconnect")(function* () {
    return yield* (yield* FeishuConnector.FeishuConnector).disconnect;
  }),
});

export const setFeishuEnabled = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FEISHU_CONNECTOR_SET_ENABLED_CHANNEL,
  payload: FdConnectorSetEnabledPayload,
  result: FdConnectorSetEnabledResponse,
  handler: Effect.fn("desktop.ipc.connectors.feishu.setEnabled")(function* ({ enabled }) {
    return yield* (yield* FeishuConnector.FeishuConnector).setEnabled(enabled);
  }),
});

export const methods = [
  getFeishuState,
  refreshFeishu,
  connectFeishu,
  disconnectFeishu,
  setFeishuEnabled,
] as const;
