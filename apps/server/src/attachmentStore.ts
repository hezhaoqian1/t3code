// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { ChatAttachment } from "@t3tools/contracts";
import { DOCUMENT_EXTENSIONS } from "@t3tools/shared/documentFormats";

import {
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "./attachmentPaths.ts";
import { inferImageExtension, SAFE_IMAGE_FILE_EXTENSIONS } from "./imageMime.ts";

const SAFE_DOCUMENT_FILE_EXTENSIONS = DOCUMENT_EXTENSIONS;
const ALL_ATTACHMENT_FILENAME_EXTENSIONS = [
  ...SAFE_IMAGE_FILE_EXTENSIONS,
  ...SAFE_DOCUMENT_FILE_EXTENSIONS,
  ".bin",
];
const ATTACHMENT_ID_THREAD_SEGMENT_MAX_CHARS = 80;
const ATTACHMENT_ID_THREAD_SEGMENT_PATTERN = "[a-z0-9_]+(?:-[a-z0-9_]+)*";
const ATTACHMENT_ID_UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ATTACHMENT_ID_PATTERN = new RegExp(
  `^(${ATTACHMENT_ID_THREAD_SEGMENT_PATTERN})-(${ATTACHMENT_ID_UUID_PATTERN})$`,
  "i",
);

/**
 * Thread segment of an attachment uploaded ahead of its send. The turn that
 * sends it copies it under the thread's own id ("claims" it); unclaimed
 * uploads expire.
 */
export const PENDING_ATTACHMENT_THREAD_SEGMENT = "pending";
const PENDING_ATTACHMENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PARTIAL_UPLOAD_MAX_AGE_MS = 60 * 60 * 1000;

export function toSafeThreadAttachmentSegment(threadId: string): string | null {
  const segment = threadId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, ATTACHMENT_ID_THREAD_SEGMENT_MAX_CHARS)
    .replace(/[-_]+$/g, "");
  if (segment.length === 0) {
    return null;
  }
  // A real thread must never land in the namespace reserved for uploads.
  return segment === PENDING_ATTACHMENT_THREAD_SEGMENT ? "_pending" : segment;
}

/** Id for an upload that no thread owns yet. */
export function createPendingAttachmentId(): string {
  return `${PENDING_ATTACHMENT_THREAD_SEGMENT}-${NodeCrypto.randomUUID()}`;
}

/** File extension an uploaded attachment is stored under. */
export function attachmentStorageExtension(input: {
  readonly type: "image" | "document";
  readonly name: string;
  readonly mimeType: string;
}): string {
  return input.type === "image"
    ? inferImageExtension({ mimeType: input.mimeType, fileName: input.name })
    : safeDocumentExtension(input.name);
}

export function createAttachmentId(threadId: string): string | null {
  const threadSegment = toSafeThreadAttachmentSegment(threadId);
  if (!threadSegment) {
    return null;
  }
  return `${threadSegment}-${NodeCrypto.randomUUID()}`;
}

export function parseThreadSegmentFromAttachmentId(attachmentId: string): string | null {
  const normalizedId = normalizeAttachmentRelativePath(attachmentId);
  if (!normalizedId || normalizedId.includes("/") || normalizedId.includes(".")) {
    return null;
  }
  const match = normalizedId.match(ATTACHMENT_ID_PATTERN);
  if (!match) {
    return null;
  }
  return match[1]?.toLowerCase() ?? null;
}

export function attachmentRelativePath(attachment: ChatAttachment): string {
  switch (attachment.type) {
    case "image": {
      const extension = inferImageExtension({
        mimeType: attachment.mimeType,
        fileName: attachment.name,
      });
      return `${attachment.id}${extension}`;
    }
    case "document": {
      const extension = safeDocumentExtension(attachment.name);
      return `${attachment.id}${extension}`;
    }
  }
}

export function resolveAttachmentPath(input: {
  readonly attachmentsDir: string;
  readonly attachment: ChatAttachment;
}): string | null {
  return resolveAttachmentRelativePath({
    attachmentsDir: input.attachmentsDir,
    relativePath: attachmentRelativePath(input.attachment),
  });
}

export function resolveAttachmentPathById(input: {
  readonly attachmentsDir: string;
  readonly attachmentId: string;
}): string | null {
  const normalizedId = normalizeAttachmentRelativePath(input.attachmentId);
  if (!normalizedId || normalizedId.includes("/") || normalizedId.includes(".")) {
    return null;
  }
  for (const extension of ALL_ATTACHMENT_FILENAME_EXTENSIONS) {
    const maybePath = resolveAttachmentRelativePath({
      attachmentsDir: input.attachmentsDir,
      relativePath: `${normalizedId}${extension}`,
    });
    if (maybePath && NodeFS.existsSync(maybePath)) {
      return maybePath;
    }
  }
  return null;
}

export type AttachmentClaimPlan =
  | {
      readonly ok: true;
      readonly finalId: string;
      readonly currentPath: string;
      readonly finalPath: string;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Where a pending upload goes when a turn on `threadId` sends it. Only
 * pending uploads can be claimed, so a client cannot point a turn at another
 * thread's attachment.
 */
export function planAttachmentClaim(input: {
  readonly attachmentsDir: string;
  readonly threadId: string;
  readonly attachmentId: string;
}): AttachmentClaimPlan {
  const requestedSegment = parseThreadSegmentFromAttachmentId(input.attachmentId);
  if (!requestedSegment) {
    return { ok: false, reason: "附件标识无效" };
  }
  if (requestedSegment !== PENDING_ATTACHMENT_THREAD_SEGMENT) {
    return { ok: false, reason: "附件不是待发送的上传" };
  }
  if (!toSafeThreadAttachmentSegment(input.threadId)) {
    return { ok: false, reason: "任务标识无效" };
  }
  const currentPath = resolveAttachmentPathById({
    attachmentsDir: input.attachmentsDir,
    attachmentId: input.attachmentId,
  });
  if (!currentPath) {
    return { ok: false, reason: "上传的文件已过期或被移除，请重新添加附件" };
  }
  const finalId = createAttachmentId(input.threadId);
  if (!finalId) {
    return { ok: false, reason: "无法创建附件标识" };
  }
  const finalPath = resolveAttachmentRelativePath({
    attachmentsDir: input.attachmentsDir,
    relativePath: `${finalId}${NodePath.extname(currentPath)}`,
  });
  if (!finalPath) {
    return { ok: false, reason: "无法确定附件存储位置" };
  }
  return { ok: true, finalId, currentPath, finalPath };
}

/** Deletes uploads nobody sent within a day and partial uploads older than an hour. */
export function sweepStalePendingAttachments(input: {
  readonly attachmentsDir: string;
  readonly nowMs: number;
}): { readonly deleted: number } {
  let entries: string[];
  try {
    entries = NodeFS.readdirSync(input.attachmentsDir);
  } catch {
    return { deleted: 0 };
  }

  let deleted = 0;
  for (const entry of entries) {
    const isPartial = entry.endsWith(".part");
    const attachmentId = isPartial
      ? entry.slice(0, entry.indexOf("."))
      : parseAttachmentIdFromRelativePath(entry);
    if (
      !attachmentId ||
      parseThreadSegmentFromAttachmentId(attachmentId) !== PENDING_ATTACHMENT_THREAD_SEGMENT
    ) {
      continue;
    }
    const resolved = resolveAttachmentRelativePath({
      attachmentsDir: input.attachmentsDir,
      relativePath: entry,
    });
    if (!resolved) {
      continue;
    }
    try {
      const maxAgeMs = isPartial ? PARTIAL_UPLOAD_MAX_AGE_MS : PENDING_ATTACHMENT_MAX_AGE_MS;
      if (input.nowMs - NodeFS.statSync(resolved).mtimeMs > maxAgeMs) {
        NodeFS.unlinkSync(resolved);
        deleted += 1;
      }
    } catch {
      continue;
    }
  }
  return { deleted };
}

function safeDocumentExtension(name: string): string {
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  return SAFE_DOCUMENT_FILE_EXTENSIONS.includes(extension) ? extension : ".bin";
}

export function parseAttachmentIdFromRelativePath(relativePath: string): string | null {
  const normalized = normalizeAttachmentRelativePath(relativePath);
  if (!normalized || normalized.includes("/")) {
    return null;
  }
  const extensionIndex = normalized.lastIndexOf(".");
  if (extensionIndex <= 0) {
    return null;
  }
  const id = normalized.slice(0, extensionIndex);
  return id.length > 0 && !id.includes(".") ? id : null;
}
