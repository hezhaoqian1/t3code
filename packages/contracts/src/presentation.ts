import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString, PositiveInt } from "./baseSchemas.ts";

export const PresentationTurnSelection = Schema.Struct({
  operation: Schema.Literals(["create", "revise"]),
  artifactId: Schema.optional(TrimmedNonEmptyString),
});
export type PresentationTurnSelection = typeof PresentationTurnSelection.Type;

export const PresentationStyle = Schema.Literals(["fd-finance", "executive", "minimal"]);
export type PresentationStyle = typeof PresentationStyle.Type;

export const PresentationImagePolicy = Schema.Literals([
  "source-only",
  "source-and-stock",
  "no-images",
]);
export type PresentationImagePolicy = typeof PresentationImagePolicy.Type;

export const PresentationAnimationPolicy = Schema.Literals(["subtle", "none"]);
export type PresentationAnimationPolicy = typeof PresentationAnimationPolicy.Type;

export const PresentationRequest = Schema.Struct({
  prompt: TrimmedNonEmptyString,
  sourcePaths: Schema.Array(TrimmedNonEmptyString),
  style: Schema.optional(PresentationStyle),
  pageCount: Schema.optional(PositiveInt),
  imagePolicy: Schema.optional(PresentationImagePolicy),
  animationPolicy: Schema.optional(PresentationAnimationPolicy),
  templatePath: Schema.optional(TrimmedNonEmptyString),
});
export type PresentationRequest = typeof PresentationRequest.Type;

export const PresentationArtifact = Schema.Struct({
  kind: Schema.Literals(["pptx", "pptd", "preview"]),
  path: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
});
export type PresentationArtifact = typeof PresentationArtifact.Type;

/**
 * A durable presentation result attached to a thread activity. Paths are
 * local to the managed task workspace and are intentionally explicit so the
 * desktop host can open or export the project without asking the user to
 * install a second toolchain.
 */
export const PresentationArtifactDescriptor = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  projectPath: TrimmedNonEmptyString,
  pptdPath: TrimmedNonEmptyString,
  pptxPath: Schema.optional(TrimmedNonEmptyString),
  previewPath: Schema.optional(TrimmedNonEmptyString),
  pageCount: PositiveInt,
  version: PositiveInt,
  operation: Schema.Literals(["create", "revise"]),
  updatedAt: TrimmedNonEmptyString,
});
export type PresentationArtifactDescriptor = typeof PresentationArtifactDescriptor.Type;

export const PresentationProgress = Schema.Struct({
  phase: Schema.Literals([
    "analyzing",
    "designing",
    "rendering",
    "exporting",
    "complete",
    "failed",
  ]),
  percent: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100)),
  message: TrimmedNonEmptyString,
});
export type PresentationProgress = typeof PresentationProgress.Type;

export const PresentationCapabilityManifest = Schema.Struct({
  id: Schema.Literal("fd-presentation-studio"),
  version: TrimmedNonEmptyString,
  skillRoot: TrimmedNonEmptyString,
  sha256: Schema.String,
  maxPackageBytes: PositiveInt,
  signature: Schema.optionalKey(Schema.String),
  publicKey: Schema.optionalKey(Schema.String),
});
export type PresentationCapabilityManifest = typeof PresentationCapabilityManifest.Type;

export const PresentationExportInput = Schema.Struct({
  projectPath: TrimmedNonEmptyString,
});
export type PresentationExportInput = typeof PresentationExportInput.Type;

export const PresentationExportResult = Schema.Struct({
  projectPath: TrimmedNonEmptyString,
  pptxPath: TrimmedNonEmptyString,
  pageCount: PositiveInt,
});
export type PresentationExportResult = typeof PresentationExportResult.Type;

export const PresentationOpenInput = Schema.Struct({
  projectPath: TrimmedNonEmptyString,
});
export type PresentationOpenInput = typeof PresentationOpenInput.Type;

export const PresentationProjectFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  content: Schema.String,
  dataUrl: Schema.optional(Schema.String),
});
export type PresentationProjectFile = typeof PresentationProjectFile.Type;

export const PresentationReadProjectInput = Schema.Struct({
  projectPath: TrimmedNonEmptyString,
});
export type PresentationReadProjectInput = typeof PresentationReadProjectInput.Type;

export const PresentationReadProjectResult = Schema.Struct({
  projectPath: TrimmedNonEmptyString,
  files: Schema.Array(PresentationProjectFile),
});
export type PresentationReadProjectResult = typeof PresentationReadProjectResult.Type;

export const PresentationWriteFileInput = Schema.Struct({
  projectPath: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString,
  content: Schema.String,
});
export type PresentationWriteFileInput = typeof PresentationWriteFileInput.Type;
