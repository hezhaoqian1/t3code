import * as Schema from "effect/Schema";

import { PortSchema, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const DesktopBackendBootstrap = Schema.Struct({
  mode: Schema.Literal("desktop"),
  noBrowser: Schema.Boolean,
  port: PortSchema,
  t3Home: Schema.String,
  taskWorkspaceRoot: Schema.optional(TrimmedNonEmptyString),
  host: Schema.Literal("127.0.0.1"),
  desktopBootstrapToken: Schema.String,
  otlpTracesUrl: Schema.optional(Schema.String),
  otlpMetricsUrl: Schema.optional(Schema.String),
  desktopTelemetryFd: Schema.optionalKey(PositiveInt),
  desktopTelemetryControlFd: Schema.optionalKey(PositiveInt),
  fdRuntimeCredentialFd: Schema.optionalKey(Schema.Literal(6)),
  resourceMonitorPath: Schema.optionalKey(TrimmedNonEmptyString),
  fdConnectorSkillsRoot: Schema.optionalKey(TrimmedNonEmptyString),
  fdConnectorBinPath: Schema.optionalKey(TrimmedNonEmptyString),
  fdConnectorConfigDir: Schema.optionalKey(TrimmedNonEmptyString),
  fdConnectorStatePath: Schema.optionalKey(TrimmedNonEmptyString),
}).annotate({ parseOptions: { onExcessProperty: "error" } });

export type DesktopBackendBootstrap = typeof DesktopBackendBootstrap.Type;
