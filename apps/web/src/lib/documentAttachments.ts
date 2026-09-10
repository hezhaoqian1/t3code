import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_DOCUMENT_BYTES,
} from "@t3tools/contracts";
import { DOCUMENT_EXTENSIONS, DOCUMENT_MIME_BY_EXTENSION } from "@t3tools/shared/documentFormats";

export const DESKTOP_DOCUMENT_ACCEPT = DOCUMENT_EXTENSIONS.join(",");

export function documentExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

export function isSupportedDocumentFile(file: File): boolean {
  return Object.hasOwn(DOCUMENT_MIME_BY_EXTENSION, documentExtension(file.name));
}

export function documentMimeType(file: File): string {
  const inferred = DOCUMENT_MIME_BY_EXTENSION[documentExtension(file.name)];
  return inferred ?? (file.type || "application/octet-stream");
}

export function validateDesktopDocumentFile(file: File): string | null {
  if (!isSupportedDocumentFile(file)) {
    return `暂不支持“${file.name}”，请上传 PDF、PPTX、DOCX、XLSX 或文本文件。`;
  }
  if (file.size <= 0) {
    return `“${file.name}”为空，无法分析。`;
  }
  if (file.size > PROVIDER_SEND_TURN_MAX_DOCUMENT_BYTES) {
    return `“${file.name}”超过 ${Math.round(PROVIDER_SEND_TURN_MAX_DOCUMENT_BYTES / 1024 / 1024)} MB 限制。`;
  }
  return null;
}

export function attachmentCapacity(currentCount: number): number {
  return Math.max(0, PROVIDER_SEND_TURN_MAX_ATTACHMENTS - currentCount);
}
