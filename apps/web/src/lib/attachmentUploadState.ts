import type { EnvironmentId } from "@t3tools/contracts";

/** An upload the server has stored and can attach to a turn by id. */
export interface ReadyAttachmentUpload {
  readonly status: "ready";
  readonly environmentId: EnvironmentId;
  readonly attachmentId: string;
}

/**
 * Where one composer attachment's background upload stands. `previous` keeps
 * an earlier ready upload alive while a replacement is in flight, so switching
 * environments back and forth never loses a usable upload.
 */
export type AttachmentUploadState =
  | {
      readonly status: "uploading";
      readonly environmentId: EnvironmentId;
      readonly progress: number;
      readonly previous?: ReadyAttachmentUpload;
    }
  | ReadyAttachmentUpload
  | {
      readonly status: "failed";
      readonly environmentId: EnvironmentId;
      readonly reason: string;
      readonly attachmentId?: string;
      readonly previous?: ReadyAttachmentUpload;
    };
