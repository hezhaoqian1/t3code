import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthReviewWriteScope,
  AuthTerminalOperateScope,
  type AuthEnvironmentScope,
  type ServerAuthBootstrapMethod,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";

export interface BootstrapGrant {
  readonly method: ServerAuthBootstrapMethod;
  readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
  readonly subject: string;
  readonly label?: string;
  readonly expiresAt: DateTime.DateTime;
}

export class UnknownBootstrapCredentialError extends Schema.TaggedErrorClass<UnknownBootstrapCredentialError>()(
  "UnknownBootstrapCredentialError",
  {},
) {
  override get message(): string {
    return "Unknown bootstrap credential.";
  }
}

export class BootstrapCredentialConsumeError extends Schema.TaggedErrorClass<BootstrapCredentialConsumeError>()(
  "BootstrapCredentialConsumeError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to validate bootstrap credential.";
  }
}

export type BootstrapCredentialError =
  | UnknownBootstrapCredentialError
  | BootstrapCredentialConsumeError;

export const isBootstrapCredentialInternalError = (
  error: BootstrapCredentialError,
): error is BootstrapCredentialConsumeError => error._tag === "BootstrapCredentialConsumeError";

export class BootstrapCredentialStore extends Context.Service<
  BootstrapCredentialStore,
  {
    readonly consume: (
      credential: string,
      input: {
        readonly use: "browser-session" | "access-token";
        readonly origin?: string;
        readonly proofKeyThumbprint?: string;
      },
    ) => Effect.Effect<BootstrapGrant, BootstrapCredentialError>;
  }
>()("t3/auth/BootstrapCredentialStore") {}

export const layer = Layer.effect(
  BootstrapCredentialStore,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    return BootstrapCredentialStore.of({
      consume: (credential, input) => {
        const isDesktopCredential =
          credential.length > 0 && credential === config.desktopBootstrapToken;
        const isDevelopmentBrowserCredential =
          credential.length > 0 &&
          credential === config.developmentBootstrapToken &&
          input.use === "browser-session" &&
          config.mode === "web" &&
          config.devUrl !== undefined &&
          ServerConfig.isLoopbackHttpUrl(config.devUrl) &&
          input.origin === config.devUrl.origin;
        return isDesktopCredential || isDevelopmentBrowserCredential
          ? DateTime.now.pipe(
              Effect.map((now) => ({
                method: "desktop-bootstrap" as const,
                scopes: [
                  AuthOrchestrationReadScope,
                  AuthOrchestrationOperateScope,
                  AuthTerminalOperateScope,
                  AuthReviewWriteScope,
                ],
                subject: isDesktopCredential ? "desktop-bootstrap" : "development-bootstrap",
                expiresAt: DateTime.add(now, { hours: 24 }),
              })),
            )
          : Effect.fail(new UnknownBootstrapCredentialError({}));
      },
    });
  }),
);
