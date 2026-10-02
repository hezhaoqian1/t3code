import type { EnvironmentId } from "@t3tools/contracts";
import { CircleAlertIcon, RotateCcwIcon } from "lucide-react";

import {
  retryAttachmentUpload,
  type UploadableAttachment,
  useAttachmentUpload,
} from "../../lib/attachmentUploadQueue";
import { cn } from "~/lib/utils";

/**
 * Upload progress over an image thumbnail: a thin bar while uploading, and a
 * retry badge when it failed. A failed upload still sends, inline.
 */
export function ImageUploadOverlay({
  attachment,
  environmentId,
}: {
  attachment: UploadableAttachment;
  environmentId: EnvironmentId;
}) {
  const upload = useAttachmentUpload(attachment.id);
  if (!upload || upload.status === "ready") return null;
  if (upload.status === "uploading") {
    return (
      <span
        role="progressbar"
        aria-label={`正在上传 ${attachment.name}`}
        aria-valuenow={Math.round(upload.progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="pointer-events-none absolute inset-x-1 bottom-1 h-1 overflow-hidden rounded-full bg-background/70"
      >
        <span
          className="block h-full rounded-full bg-primary"
          style={{ width: `${Math.max(6, Math.round(upload.progress * 100))}%` }}
        />
      </span>
    );
  }
  return (
    <button
      type="button"
      title={`上传失败（${upload.reason}），发送时会直接附带。点击重试上传`}
      aria-label={`重新上传 ${attachment.name}`}
      onClick={() => retryAttachmentUpload({ environmentId, attachment })}
      className="absolute bottom-1 left-1 inline-flex items-center justify-center rounded bg-background/90 p-0.5 text-amber-600"
    >
      <RotateCcwIcon className="size-3" />
    </button>
  );
}

/** One-line upload status for a document chip. */
export function DocumentUploadStatus({
  attachment,
  environmentId,
}: {
  attachment: UploadableAttachment;
  environmentId: EnvironmentId;
}) {
  const upload = useAttachmentUpload(attachment.id);
  const sizeLabel = `${(attachment.sizeBytes / 1024 / 1024).toFixed(1)} MB`;
  if (upload?.status === "uploading") {
    return (
      <span className="block text-[10px] text-muted-foreground tabular-nums">
        {sizeLabel} · 上传中 {Math.round(upload.progress * 100)}%
      </span>
    );
  }
  if (upload?.status === "failed") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-amber-600">
        <CircleAlertIcon className="size-3 shrink-0" aria-hidden />
        <span className={cn("truncate")} title={upload.reason}>
          上传失败，发送时直接附带
        </span>
        <button
          type="button"
          className="shrink-0 underline-offset-2 hover:underline"
          onClick={() => retryAttachmentUpload({ environmentId, attachment })}
        >
          重试
        </button>
      </span>
    );
  }
  return (
    <span className="block text-[10px] text-muted-foreground">
      {sizeLabel} · {upload?.status === "ready" ? "已就绪" : "待解析"}
    </span>
  );
}
