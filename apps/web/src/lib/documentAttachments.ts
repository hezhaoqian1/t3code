import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_DOCUMENT_BYTES,
} from "@t3tools/contracts";

export const DESKTOP_DOCUMENT_ACCEPT = [
  ".pdf",
  ".docx",
  ".xlsx",
  ".csv",
  ".pptx",
  ".txt",
  ".md",
  ".json",
  ".xml",
  ".html",
  ".htm",
].join(",");

const DOCUMENT_MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".xml": "application/xml",
  ".html": "text/html",
  ".htm": "text/html",
};

export function documentExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

export function isSupportedDocumentFile(file: File): boolean {
  return documentExtension(file.name) in DOCUMENT_MIME_BY_EXTENSION;
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
