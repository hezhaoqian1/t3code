import {
  FdAccountGetStatePayload,
  FdAccountGetStateResponse,
  FdAccountLoginPayload,
  FdAccountLoginResponse,
  FdAccountLogoutPayload,
  FdAccountLogoutResponse,
  FdAccountReloadPayload,
  FdAccountReloadResponse,
  FdAccountRetryRevocationPayload,
  FdAccountRetryRevocationResponse,
  FdUsageGetSummaryPayload,
  FdUsageGetSummaryResponse,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as FdIdentity from "../../fd-identity/FdIdentity.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const installAccountStateForwarding = Effect.fn(
  "desktop.ipc.account.installStateForwarding",
)(function* () {
  const identity = yield* FdIdentity.FdIdentity;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  yield* identity.subscribe((state) =>
    electronWindow.sendAll(IpcChannels.FD_ACCOUNT_STATE_CHANGED_CHANNEL, state),
  );
});

export const getState = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FD_ACCOUNT_GET_STATE_CHANNEL,
  payload: FdAccountGetStatePayload,
  result: FdAccountGetStateResponse,
  handler: Effect.fn("desktop.ipc.account.getState")(function* () {
    return yield* (yield* FdIdentity.FdIdentity).getState;
  }),
});

export const login = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FD_ACCOUNT_LOGIN_CHANNEL,
  payload: FdAccountLoginPayload,
  result: FdAccountLoginResponse,
  handler: Effect.fn("desktop.ipc.account.login")(function* (input) {
    return yield* (yield* FdIdentity.FdIdentity).login(input);
  }),
});

export const logout = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FD_ACCOUNT_LOGOUT_CHANNEL,
  payload: FdAccountLogoutPayload,
  result: FdAccountLogoutResponse,
  handler: Effect.fn("desktop.ipc.account.logout")(function* () {
    return yield* (yield* FdIdentity.FdIdentity).logout;
  }),
});

export const reload = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FD_ACCOUNT_RELOAD_CHANNEL,
  payload: FdAccountReloadPayload,
  result: FdAccountReloadResponse,
  handler: Effect.fn("desktop.ipc.account.reload")(function* () {
    return yield* (yield* FdIdentity.FdIdentity).reload;
  }),
});

export const retryRevocation = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FD_ACCOUNT_RETRY_REVOCATION_CHANNEL,
  payload: FdAccountRetryRevocationPayload,
  result: FdAccountRetryRevocationResponse,
  handler: Effect.fn("desktop.ipc.account.retryRevocation")(function* () {
    return yield* (yield* FdIdentity.FdIdentity).retryRevocation;
  }),
});

export const getUsageSummary = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FD_USAGE_GET_SUMMARY_CHANNEL,
  payload: FdUsageGetSummaryPayload,
  result: FdUsageGetSummaryResponse,
  handler: Effect.fn("desktop.ipc.account.getUsageSummary")(function* () {
    return yield* (yield* FdIdentity.FdIdentity).getUsageSummary;
  }),
});

export const methods = [getState, login, logout, reload, retryRevocation, getUsageSummary] as const;
