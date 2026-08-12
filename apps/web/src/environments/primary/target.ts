import { PRIMARY_LOCAL_ENVIRONMENT_ID, type DesktopEnvironmentBootstrap } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const PrimaryEnvironmentTargetSource = Schema.Literals(["development-loopback", "desktop-managed"]);
type PrimaryEnvironmentTargetSource = typeof PrimaryEnvironmentTargetSource.Type;

const PrimaryEnvironmentUrlKind = Schema.Literals([
  "http-base-url",
  "websocket-base-url",
  "development-server-url",
  "window-location-url",
]);
type PrimaryEnvironmentUrlKind = typeof PrimaryEnvironmentUrlKind.Type;

export class PrimaryEnvironmentUrlInvalidError extends Schema.TaggedErrorClass<PrimaryEnvironmentUrlInvalidError>()(
  "PrimaryEnvironmentUrlInvalidError",
  {
    source: PrimaryEnvironmentTargetSource,
    urlKind: PrimaryEnvironmentUrlKind,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Could not parse ${this.urlKind} for the ${this.source} primary environment target.`;
  }
}

export class PrimaryEnvironmentProtocolUnsupportedError extends Schema.TaggedErrorClass<PrimaryEnvironmentProtocolUnsupportedError>()(
  "PrimaryEnvironmentProtocolUnsupportedError",
  {
    source: PrimaryEnvironmentTargetSource,
    protocol: Schema.String,
  },
) {
  override get message(): string {
    return `The ${this.source} primary environment target uses unsupported protocol ${this.protocol}.`;
  }
}

export class PrimaryEnvironmentHostUnsupportedError extends Schema.TaggedErrorClass<PrimaryEnvironmentHostUnsupportedError>()(
  "PrimaryEnvironmentHostUnsupportedError",
  {
    source: PrimaryEnvironmentTargetSource,
    hostname: Schema.String,
  },
) {
  override get message(): string {
    return `The ${this.source} primary environment target must use an exact loopback hostname.`;
  }
}

export class PrimaryEnvironmentUnavailableError extends Schema.TaggedErrorClass<PrimaryEnvironmentUnavailableError>()(
  "PrimaryEnvironmentUnavailableError",
  {},
) {
  override get message(): string {
    return "The platform-managed primary environment is unavailable.";
  }
}

export class DesktopEnvironmentBootstrapIncompleteError extends Schema.TaggedErrorClass<DesktopEnvironmentBootstrapIncompleteError>()(
  "DesktopEnvironmentBootstrapIncompleteError",
  {
    hasHttpBaseUrl: Schema.Boolean,
    hasWsBaseUrl: Schema.Boolean,
  },
) {
  override get message(): string {
    const missing = [
      ...(this.hasHttpBaseUrl ? [] : ["httpBaseUrl"]),
      ...(this.hasWsBaseUrl ? [] : ["wsBaseUrl"]),
    ];
    return `Desktop bootstrap is missing ${missing.join(" and ")} for the local environment.`;
  }
}

export const isPrimaryEnvironmentUrlInvalidError = Schema.is(PrimaryEnvironmentUrlInvalidError);
export const isPrimaryEnvironmentProtocolUnsupportedError = Schema.is(
  PrimaryEnvironmentProtocolUnsupportedError,
);
export const isPrimaryEnvironmentHostUnsupportedError = Schema.is(
  PrimaryEnvironmentHostUnsupportedError,
);
export const isPrimaryEnvironmentUnavailableError = Schema.is(PrimaryEnvironmentUnavailableError);
export const isDesktopEnvironmentBootstrapIncompleteError = Schema.is(
  DesktopEnvironmentBootstrapIncompleteError,
);

export interface PrimaryEnvironmentTarget {
  readonly source: PrimaryEnvironmentTargetSource;
  readonly generation: string;
  readonly target: {
    readonly httpBaseUrl: string;
    readonly wsBaseUrl: string;
  };
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);

function getDesktopLocalEnvironmentBootstrap(): DesktopEnvironmentBootstrap | null {
  const bootstraps = window.desktopBridge?.getLocalEnvironmentBootstraps() ?? [];
  return bootstraps.find((entry) => entry.id === PRIMARY_LOCAL_ENVIRONMENT_ID) ?? null;
}

function parseTargetUrl(input: {
  readonly rawValue: string;
  readonly source: PrimaryEnvironmentTargetSource;
  readonly urlKind: PrimaryEnvironmentUrlKind;
}): URL {
  try {
    return new URL(input.rawValue);
  } catch (cause) {
    throw new PrimaryEnvironmentUrlInvalidError({
      source: input.source,
      urlKind: input.urlKind,
      cause,
    });
  }
}

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
}

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(normalizeHostname(hostname));
}

function validateLoopbackUrl(input: {
  readonly url: URL;
  readonly source: PrimaryEnvironmentTargetSource;
  readonly protocols: ReadonlySet<string>;
}): URL {
  if (!input.protocols.has(input.url.protocol)) {
    throw new PrimaryEnvironmentProtocolUnsupportedError({
      source: input.source,
      protocol: input.url.protocol,
    });
  }
  if (
    !isLoopbackHostname(input.url.hostname) ||
    input.url.username !== "" ||
    input.url.password !== ""
  ) {
    throw new PrimaryEnvironmentHostUnsupportedError({
      source: input.source,
      hostname: input.url.hostname,
    });
  }
  return input.url;
}

function normalizeLoopbackBaseUrl(input: {
  readonly rawValue: string;
  readonly source: PrimaryEnvironmentTargetSource;
  readonly urlKind: PrimaryEnvironmentUrlKind;
  readonly protocols: ReadonlySet<string>;
}): string {
  const url = validateLoopbackUrl({
    url: parseTargetUrl(input),
    source: input.source,
    protocols: input.protocols,
  });
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function resolveBrowserDevelopmentPrimaryTarget(input: {
  readonly isDevelopment: boolean;
  readonly locationHref: string;
}): PrimaryEnvironmentTarget | null {
  if (!input.isDevelopment) return null;

  const httpUrl = validateLoopbackUrl({
    url: parseTargetUrl({
      rawValue: input.locationHref,
      source: "development-loopback",
      urlKind: "window-location-url",
    }),
    source: "development-loopback",
    protocols: new Set(["http:", "https:"]),
  });
  httpUrl.pathname = "/";
  httpUrl.search = "";
  httpUrl.hash = "";
  const wsUrl = new URL(httpUrl);
  wsUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";

  return {
    source: "development-loopback",
    generation: `origin:${httpUrl.origin}`,
    target: {
      httpBaseUrl: httpUrl.toString(),
      wsBaseUrl: wsUrl.toString(),
    },
  };
}

function resolveDesktopPrimaryTarget(): PrimaryEnvironmentTarget | null {
  const desktopBootstrap = getDesktopLocalEnvironmentBootstrap();
  if (desktopBootstrap === null) return null;
  if (!desktopBootstrap.httpBaseUrl || !desktopBootstrap.wsBaseUrl) {
    throw new DesktopEnvironmentBootstrapIncompleteError({
      hasHttpBaseUrl: Boolean(desktopBootstrap.httpBaseUrl),
      hasWsBaseUrl: Boolean(desktopBootstrap.wsBaseUrl),
    });
  }

  return {
    source: "desktop-managed",
    generation: desktopBootstrap.generation,
    target: {
      httpBaseUrl: normalizeLoopbackBaseUrl({
        rawValue: desktopBootstrap.httpBaseUrl,
        source: "desktop-managed",
        urlKind: "http-base-url",
        protocols: new Set(["http:", "https:"]),
      }),
      wsBaseUrl: normalizeLoopbackBaseUrl({
        rawValue: desktopBootstrap.wsBaseUrl,
        source: "desktop-managed",
        urlKind: "websocket-base-url",
        protocols: new Set(["ws:", "wss:"]),
      }),
    },
  };
}

function resolveHttpRequestBaseUrl(primaryTarget: PrimaryEnvironmentTarget): string {
  if (!import.meta.env.DEV || primaryTarget.source !== "desktop-managed") {
    return primaryTarget.target.httpBaseUrl;
  }
  const configuredDevServerUrl = import.meta.env.VITE_DEV_SERVER_URL?.trim();
  if (!configuredDevServerUrl) return primaryTarget.target.httpBaseUrl;

  let currentUrl: URL;
  try {
    currentUrl = new URL(window.location.href);
  } catch {
    return primaryTarget.target.httpBaseUrl;
  }
  if (currentUrl.origin === "null" || !isLoopbackHostname(currentUrl.hostname)) {
    return primaryTarget.target.httpBaseUrl;
  }
  if (currentUrl.protocol !== "http:" && currentUrl.protocol !== "https:") {
    return primaryTarget.target.httpBaseUrl;
  }

  const devServerUrl = validateLoopbackUrl({
    url: parseTargetUrl({
      rawValue: configuredDevServerUrl,
      source: "development-loopback",
      urlKind: "development-server-url",
    }),
    source: "development-loopback",
    protocols: new Set(["http:", "https:"]),
  });
  return currentUrl.origin === devServerUrl.origin
    ? `${currentUrl.origin}/`
    : primaryTarget.target.httpBaseUrl;
}

export function resolvePrimaryEnvironmentHttpUrl(
  pathname: string,
  searchParams?: Record<string, string>,
): string {
  const primaryTarget = readPrimaryEnvironmentTarget();
  if (primaryTarget === null) throw new PrimaryEnvironmentUnavailableError({});

  const url = new URL(resolveHttpRequestBaseUrl(primaryTarget));
  url.pathname = pathname;
  if (searchParams) url.search = new URLSearchParams(searchParams).toString();
  return url.toString();
}

export function readPrimaryEnvironmentTarget(): PrimaryEnvironmentTarget | null {
  return (
    resolveDesktopPrimaryTarget() ??
    resolveBrowserDevelopmentPrimaryTarget({
      isDevelopment: import.meta.env.DEV,
      locationHref: window.location.href,
    })
  );
}
