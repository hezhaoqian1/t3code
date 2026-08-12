import type {
  FdAccountLoginInput,
  FdAccountLoginResult,
  FdAccountLogoutResult,
  FdAccountReloadResult,
  FdAccountState,
  FdRetryRevocationResult,
  FdUsageSummary,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { safeStorage } from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { CredentialVault } from "./CredentialVault.ts";
import * as FdCredentialPublisher from "./FdCredentialPublisher.ts";
import { FdIdentityBroker } from "./FdIdentityBroker.ts";
import { ElectronSafeStorageAdapter } from "./ElectronSafeStorageAdapter.ts";
import { loadFdEnterpriseConfig } from "./EnterpriseConfig.ts";
import { NewApiClient } from "./NewApiClient.ts";

export class FdIdentity extends Context.Service<
  FdIdentity,
  {
    readonly initialize: Effect.Effect<void>;
    readonly getState: Effect.Effect<FdAccountState>;
    readonly login: (input: FdAccountLoginInput) => Effect.Effect<FdAccountLoginResult>;
    readonly logout: Effect.Effect<FdAccountLogoutResult>;
    readonly reload: Effect.Effect<FdAccountReloadResult>;
    readonly retryRevocation: Effect.Effect<FdRetryRevocationResult>;
    readonly getUsageSummary: Effect.Effect<FdUsageSummary>;
    readonly subscribe: (
      listener: (state: FdAccountState) => Effect.Effect<void>,
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("@t3tools/desktop/fd-identity/FdIdentity") {}

export const make = Effect.fn("fdIdentity.make")(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const publisher = yield* FdCredentialPublisher.FdCredentialPublisher;
  const context = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(context);
  const runPromise = Effect.runPromiseWith(context);
  const config = yield* Effect.tryPromise(() =>
    loadFdEnterpriseConfig({
      isPackaged: environment.isPackaged,
      resourcesPath: environment.resourcesPath,
      rootDir: environment.rootDir,
      env: process.env,
    }),
  ).pipe(Effect.orDie);
  const broker = yield* Effect.acquireRelease(
    Effect.sync(
      () =>
        new FdIdentityBroker({
          vault: new CredentialVault(
            environment.path.join(environment.stateDir, "fd-identity"),
            new ElectronSafeStorageAdapter(safeStorage),
          ),
          client: new NewApiClient({ baseUrl: config.newApiOrigin }),
          publisher: {
            set: (credentials) =>
              runPromise(publisher.set({ ...credentials, newApiOrigin: config.newApiOrigin })),
            clear: (reason) => runPromise(publisher.clear(reason)),
          },
        }),
    ),
    (broker) => Effect.tryPromise(() => broker.dispose()).pipe(Effect.orDie),
  );

  const fromPromise = <A>(operation: () => Promise<A>) =>
    Effect.tryPromise(operation).pipe(Effect.orDie);

  return FdIdentity.of({
    initialize: fromPromise(() => broker.initialize()),
    getState: Effect.sync(() => broker.getState()),
    login: (input) => fromPromise(() => broker.login(input)),
    logout: fromPromise(() => broker.logout()),
    reload: fromPromise(() => broker.reload()),
    retryRevocation: fromPromise(() => broker.retryRevocation()),
    getUsageSummary: fromPromise(() => broker.getUsageSummary()),
    subscribe: (listener) =>
      Effect.acquireRelease(
        Effect.sync(() =>
          broker.subscribe((state) => {
            runFork(listener(state));
          }),
        ),
        (unsubscribe) => Effect.sync(unsubscribe),
      ).pipe(Effect.asVoid),
  });
});

export const layer = Layer.effect(FdIdentity, make());
