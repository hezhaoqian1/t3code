import type { ChatAttachment, EnvironmentId } from "@t3tools/contracts";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { create } from "zustand";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { attachmentEnvironment } from "../state/attachments";
import { readPreparedConnection } from "../state/session";
import type { AttachmentUploadState, ReadyAttachmentUpload } from "./attachmentUploadState";

/**
 * Background uploads for composer attachments. An image or document starts
 * uploading to the local server as soon as it is added, so sending only
 * carries its id instead of base64 bytes over the WebSocket. Anything not
 * uploaded by send time falls back to the inline path, so a failed upload
 * never blocks a message.
 */

/** A composer image or document that can be uploaded ahead of its send. */
export interface UploadableAttachment {
  readonly id: string;
  readonly type: "image" | "document";
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly file: File;
}

const MAX_UPLOADS_PER_ENVIRONMENT = 3;
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

interface AttachmentUploadStore {
  readonly uploadsByAttachmentId: Readonly<Record<string, AttachmentUploadState>>;
}

export const useAttachmentUploadStore = create<AttachmentUploadStore>(() => ({
  uploadsByAttachmentId: {},
}));

interface UploadJob {
  readonly attachment: UploadableAttachment;
  readonly environmentId: EnvironmentId;
  readonly previous?: ReadyAttachmentUpload;
  readonly settled: Promise<void>;
  resolveSettled: () => void;
  attachmentId: string | null;
  cancelled: boolean;
  abort: (() => void) | null;
}

const jobsByAttachmentId = new Map<string, UploadJob>();
const queue: UploadJob[] = [];
const activeUploadsByEnvironment = new Map<EnvironmentId, number>();

function setUploadState(id: string, upload: AttachmentUploadState): void {
  useAttachmentUploadStore.setState((state) => ({
    uploadsByAttachmentId: { ...state.uploadsByAttachmentId, [id]: upload },
  }));
}

function clearUploadState(id: string): void {
  useAttachmentUploadStore.setState((state) => {
    if (!(id in state.uploadsByAttachmentId)) {
      return state;
    }
    const uploadsByAttachmentId = { ...state.uploadsByAttachmentId };
    delete uploadsByAttachmentId[id];
    return { uploadsByAttachmentId };
  });
}

export function readAttachmentUpload(id: string): AttachmentUploadState | undefined {
  return useAttachmentUploadStore.getState().uploadsByAttachmentId[id];
}

/** Upload state for one attachment, for chips that show progress or a retry. */
export function useAttachmentUpload(id: string): AttachmentUploadState | undefined {
  return useAttachmentUploadStore((state) => state.uploadsByAttachmentId[id]);
}

function deletePendingUpload(environmentId: EnvironmentId, attachmentId: string): void {
  void runAtomCommand(
    appAtomRegistry,
    attachmentEnvironment.remove,
    { environmentId, input: { attachmentId } },
    { reportFailure: false, reportDefect: false },
  );
}

function uploadBytes(input: {
  readonly url: string;
  readonly file: File;
  readonly onProgress: (progress: number) => void;
}): { readonly done: Promise<void>; readonly abort: () => void } {
  const xhr = new XMLHttpRequest();
  const done = new Promise<void>((resolve, reject) => {
    xhr.open("POST", input.url, true);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.setRequestHeader("Content-Type", input.file.type || "application/octet-stream");
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        input.onProgress(event.loaded / event.total);
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`上传被拒绝（${xhr.status}）`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("上传失败")));
    xhr.addEventListener("timeout", () => reject(new Error("上传超时")));
    xhr.addEventListener("abort", () => reject(new Error("上传已取消")));
    xhr.send(input.file);
  });
  return { done, abort: () => xhr.abort() };
}

async function runUpload(job: UploadJob): Promise<void> {
  const { attachment } = job;
  const minted = await runAtomCommand(
    appAtomRegistry,
    attachmentEnvironment.createUploadUrl,
    {
      environmentId: job.environmentId,
      input: {
        type: attachment.type,
        name: attachment.name,
        mimeType: attachment.mimeType || "application/octet-stream",
        sizeBytes: attachment.file.size,
      },
    },
    { reportFailure: false },
  );
  if (job.cancelled) {
    if (minted._tag === "Success") {
      deletePendingUpload(job.environmentId, minted.value.attachmentId);
    }
    return;
  }
  if (minted._tag !== "Success") {
    setUploadState(attachment.id, {
      status: "failed",
      environmentId: job.environmentId,
      reason: "无法开始上传",
      ...(job.previous ? { previous: job.previous } : {}),
    });
    return;
  }
  job.attachmentId = minted.value.attachmentId;

  const connection = readPreparedConnection(job.environmentId);
  const url = connection ? resolveAssetUrl(connection.httpBaseUrl, minted.value.relativeUrl) : null;
  if (!url) {
    setUploadState(attachment.id, {
      status: "failed",
      environmentId: job.environmentId,
      reason: "本地服务未连接",
      attachmentId: minted.value.attachmentId,
      ...(job.previous ? { previous: job.previous } : {}),
    });
    return;
  }

  let lastStep = -1;
  const upload = uploadBytes({
    url,
    file: attachment.file,
    onProgress: (progress) => {
      // Twenty steps are enough for a progress ring and spare the store a
      // re-render per network chunk.
      const step = Math.floor(progress * 20);
      if (step === lastStep || job.cancelled) {
        return;
      }
      lastStep = step;
      setUploadState(attachment.id, {
        status: "uploading",
        environmentId: job.environmentId,
        progress,
        ...(job.previous ? { previous: job.previous } : {}),
      });
    },
  });
  job.abort = upload.abort;

  try {
    await upload.done;
    if (job.cancelled) {
      return;
    }
    setUploadState(attachment.id, {
      status: "ready",
      environmentId: job.environmentId,
      attachmentId: minted.value.attachmentId,
    });
    if (job.previous) {
      deletePendingUpload(job.previous.environmentId, job.previous.attachmentId);
    }
  } catch (error) {
    if (job.cancelled) {
      return;
    }
    setUploadState(attachment.id, {
      status: "failed",
      environmentId: job.environmentId,
      reason: error instanceof Error ? error.message : "上传失败",
      attachmentId: minted.value.attachmentId,
      ...(job.previous ? { previous: job.previous } : {}),
    });
  } finally {
    job.abort = null;
  }
}

function pumpUploads(): void {
  for (let index = 0; index < queue.length; ) {
    const job = queue[index]!;
    const active = activeUploadsByEnvironment.get(job.environmentId) ?? 0;
    if (active >= MAX_UPLOADS_PER_ENVIRONMENT) {
      index += 1;
      continue;
    }
    queue.splice(index, 1);
    if (job.cancelled) {
      continue;
    }
    activeUploadsByEnvironment.set(job.environmentId, active + 1);
    void runUpload(job)
      .catch(() => {
        if (!job.cancelled) {
          setUploadState(job.attachment.id, {
            status: "failed",
            environmentId: job.environmentId,
            reason: "上传失败",
            ...(job.previous ? { previous: job.previous } : {}),
          });
        }
      })
      .finally(() => {
        if (jobsByAttachmentId.get(job.attachment.id) === job) {
          jobsByAttachmentId.delete(job.attachment.id);
        }
        const remaining = (activeUploadsByEnvironment.get(job.environmentId) ?? 1) - 1;
        if (remaining > 0) {
          activeUploadsByEnvironment.set(job.environmentId, remaining);
        } else {
          activeUploadsByEnvironment.delete(job.environmentId);
        }
        job.resolveSettled();
        pumpUploads();
      });
  }
}

/** Starts (or keeps) the background upload of one attachment. Safe to call repeatedly. */
export function startAttachmentUpload(input: {
  readonly environmentId: EnvironmentId;
  readonly attachment: UploadableAttachment;
}): void {
  const { attachment } = input;
  const existingJob = jobsByAttachmentId.get(attachment.id);
  if (existingJob?.environmentId === input.environmentId) {
    return;
  }
  const existing = readAttachmentUpload(attachment.id);
  if (existing?.environmentId === input.environmentId && existing.status !== "uploading") {
    // Ready, or failed and waiting for an explicit retry.
    return;
  }
  if (
    existing &&
    "previous" in existing &&
    existing.previous?.environmentId === input.environmentId
  ) {
    cancelAttachmentUpload(attachment.id);
    if (existing.status === "failed" && existing.attachmentId) {
      deletePendingUpload(existing.environmentId, existing.attachmentId);
    }
    setUploadState(attachment.id, existing.previous);
    return;
  }

  if (existingJob) {
    cancelAttachmentUpload(attachment.id);
  }
  const previous = existing?.status === "ready" ? existing : existing?.previous;
  let resolveSettled: () => void = () => {};
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  const job: UploadJob = {
    attachment,
    environmentId: input.environmentId,
    ...(previous ? { previous } : {}),
    settled,
    resolveSettled,
    attachmentId: null,
    cancelled: false,
    abort: null,
  };
  jobsByAttachmentId.set(attachment.id, job);
  queue.push(job);
  setUploadState(attachment.id, {
    status: "uploading",
    environmentId: input.environmentId,
    progress: 0,
    ...(previous ? { previous } : {}),
  });
  pumpUploads();
}

export function cancelAttachmentUpload(id: string): void {
  const job = jobsByAttachmentId.get(id);
  if (!job) {
    return;
  }
  job.cancelled = true;
  jobsByAttachmentId.delete(id);
  const queuedIndex = queue.indexOf(job);
  if (queuedIndex !== -1) {
    queue.splice(queuedIndex, 1);
  }
  job.abort?.();
  if (job.attachmentId) {
    deletePendingUpload(job.environmentId, job.attachmentId);
  }
  job.resolveSettled();
}

/** Forgets an attachment's upload and deletes any server copy nobody has sent. */
export function releaseAttachmentUpload(id: string): void {
  const upload = readAttachmentUpload(id);
  cancelAttachmentUpload(id);
  if (upload?.status === "ready") {
    deletePendingUpload(upload.environmentId, upload.attachmentId);
  } else if (upload) {
    if (upload.status === "failed" && upload.attachmentId) {
      deletePendingUpload(upload.environmentId, upload.attachmentId);
    }
    if (upload.previous) {
      deletePendingUpload(upload.previous.environmentId, upload.previous.attachmentId);
    }
  }
  clearUploadState(id);
}

export function retryAttachmentUpload(input: {
  readonly environmentId: EnvironmentId;
  readonly attachment: UploadableAttachment;
}): void {
  const previous = readAttachmentUpload(input.attachment.id);
  cancelAttachmentUpload(input.attachment.id);
  if (previous?.status === "failed" && previous.attachmentId) {
    deletePendingUpload(previous.environmentId, previous.attachmentId);
  }
  if (previous && "previous" in previous && previous.previous) {
    setUploadState(input.attachment.id, previous.previous);
  } else {
    clearUploadState(input.attachment.id);
  }
  startAttachmentUpload(input);
}

/** Resolves once every listed upload has finished, failed or been cancelled. */
export async function awaitAttachmentUploads(ids: ReadonlyArray<string>): Promise<void> {
  await Promise.all(ids.map((id) => jobsByAttachmentId.get(id)?.settled));
}

/**
 * The attachments as uploaded references, or null when any is not ready for
 * `environmentId` (the caller then sends the bytes inline instead).
 */
export function getUploadedAttachments(input: {
  readonly environmentId: EnvironmentId;
  readonly attachments: ReadonlyArray<UploadableAttachment>;
}): ChatAttachment[] | null {
  const uploaded: ChatAttachment[] = [];
  for (const attachment of input.attachments) {
    const upload = readAttachmentUpload(attachment.id);
    if (upload?.status !== "ready" || upload.environmentId !== input.environmentId) {
      return null;
    }
    uploaded.push({
      type: attachment.type,
      id: upload.attachmentId,
      name: attachment.name,
      mimeType: attachment.mimeType || "application/octet-stream",
      sizeBytes: attachment.file.size,
    });
  }
  return uploaded;
}

export function releaseAttachmentUploads(
  attachments: ReadonlyArray<{ readonly id: string }>,
): void {
  for (const attachment of attachments) {
    releaseAttachmentUpload(attachment.id);
  }
}
