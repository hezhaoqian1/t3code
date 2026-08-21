// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs/promises";
import * as NodePath from "node:path";

import type { ChatDocumentAttachment } from "@t3tools/contracts";
import { OfficeParser, type SupportedFileType } from "officeparser";
import * as XLSX from "xlsx";

import {
  type DocumentContext,
  type DocumentSection,
  type DocumentSectionLocation,
  type DocumentWarning,
  DOCUMENT_CONTEXT_SINGLE_SECTION_MAX_CHARACTERS,
} from "./DocumentContext.ts";

const SUPPORTED_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "xlsx",
  "csv",
  "pptx",
  "txt",
  "md",
  "json",
  "xml",
  "html",
  "htm",
]);

const SUPPORTED_TEXT_EXTENSIONS = new Set(["txt", "md", "json", "xml", "html", "htm", "csv"]);

export class DocumentParseError extends Error {
  readonly code: "unsupported" | "invalid_mime" | "empty" | "encrypted" | "parser_failed";

  constructor(code: DocumentParseError["code"], message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "DocumentParseError";
    this.code = code;
  }
}

export async function parseDocumentAttachment(input: {
  readonly attachment: ChatDocumentAttachment;
  readonly path: string;
}): Promise<DocumentContext> {
  const extension = extensionOf(input.attachment.name);
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new DocumentParseError("unsupported", `暂不支持 .${extension || "unknown"} 文件。`);
  }

  const bytes = await NodeFS.readFile(input.path);
  if (bytes.byteLength === 0) {
    throw new DocumentParseError("empty", "文件为空，无法分析。 ");
  }
  if (bytes.byteLength !== input.attachment.sizeBytes) {
    throw new DocumentParseError("invalid_mime", "文件大小校验失败，请重新选择文件。 ");
  }
  validateMagicBytes(bytes, extension, input.attachment.mimeType);

  try {
    if (extension === "xlsx") {
      return parseWorkbookAttachment(input.attachment, bytes);
    }
    if (SUPPORTED_TEXT_EXTENSIONS.has(extension)) {
      const text = bytes
        .toString("utf8")
        .replace(/^\uFEFF/, "")
        .trim();
      if (!text) {
        throw new DocumentParseError("empty", "没有提取到可分析的文字。");
      }
      return {
        attachment: input.attachment,
        parser: `native-utf8/${extension}`,
        sections: [
          {
            location: "document",
            index: null,
            title: null,
            text,
            tables: [],
            imageReferences: [],
          },
        ],
        warnings: [],
        extractedCharacters: text.length,
        truncated: false,
        ocrUsed: false,
      };
    }
    const ast = await OfficeParser.parseOffice(bytes, {
      fileType: extension as SupportedFileType,
      ocr: false,
      extractAttachments: false,
    });
    const sections = collectSections(ast as unknown as OfficeAst);
    const extractedCharacters = sections.reduce((total, section) => total + section.text.length, 0);
    if (extractedCharacters === 0) {
      throw new DocumentParseError(
        "empty",
        extension === "pdf"
          ? "没有提取到文字，扫描版 PDF 暂不支持 OCR。"
          : "没有提取到可分析的文字。",
      );
    }
    const warnings: DocumentWarning[] = [];
    if (extractedCharacters > DOCUMENT_CONTEXT_SINGLE_SECTION_MAX_CHARACTERS) {
      warnings.push({ code: "truncated", message: "内容较长，本轮只使用受控范围。" });
    }
    for (const warning of ast.warnings ?? []) {
      warnings.push({ code: "parser_warning", message: String(warning) });
    }
    return {
      attachment: input.attachment,
      parser: `officeparser@7.8.0/${extension}`,
      sections,
      warnings,
      extractedCharacters,
      truncated: warnings.some((warning) => warning.code === "truncated"),
      ocrUsed: false,
    };
  } catch (error) {
    if (error instanceof DocumentParseError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/password|encrypted/i.test(message)) {
      throw new DocumentParseError("encrypted", "文件受密码保护，请先解密后重试。", error);
    }
    throw new DocumentParseError("parser_failed", "文件解析失败，请检查文件是否完整。", error);
  }
}

function parseWorkbookAttachment(
  attachment: ChatDocumentAttachment,
  bytes: Buffer,
): DocumentContext {
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true });
  const sections: DocumentSection[] = [];
  for (const [index, sheetName] of workbook.SheetNames.entries()) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      blankrows: false,
    });
    const text = rows
      .slice(0, 5_000)
      .map((row) =>
        row
          .map((cell) => String(cell ?? ""))
          .join("\t")
          .trimEnd(),
      )
      .filter(Boolean)
      .join("\n")
      .trim();
    if (!text) continue;
    sections.push({
      location: "sheet",
      index: index + 1,
      title: sheetName,
      text,
      tables: [text.slice(0, DOCUMENT_CONTEXT_SINGLE_SECTION_MAX_CHARACTERS)],
      imageReferences: [],
    });
  }
  const extractedCharacters = sections.reduce((total, section) => total + section.text.length, 0);
  if (extractedCharacters === 0) {
    throw new DocumentParseError("empty", "没有提取到可分析的文字。");
  }
  const truncated = sections.some(
    (section) => section.text.length > DOCUMENT_CONTEXT_SINGLE_SECTION_MAX_CHARACTERS,
  );
  return {
    attachment,
    parser: "xlsx@0.18.5",
    sections,
    warnings: truncated ? [{ code: "truncated", message: "内容较长，本轮只使用受控范围。" }] : [],
    extractedCharacters,
    truncated,
    ocrUsed: false,
  };
}

export async function parseDocumentAttachmentFromPath(
  attachment: ChatDocumentAttachment,
  attachmentsDir: string,
): Promise<DocumentContext> {
  const extension = extensionOf(attachment.name);
  const path = NodePath.join(attachmentsDir, `${attachment.id}.${extension}`);
  return parseDocumentAttachment({ attachment, path });
}

interface OfficeAst {
  readonly content?: ReadonlyArray<OfficeNode>;
  readonly warnings?: ReadonlyArray<unknown>;
}

interface OfficeNode {
  readonly type?: string;
  readonly text?: string;
  readonly metadata?: Record<string, unknown>;
  readonly children?: ReadonlyArray<OfficeNode>;
  readonly notes?: ReadonlyArray<OfficeNode>;
}

function collectSections(ast: OfficeAst): DocumentSection[] {
  const content = Array.isArray(ast.content) ? ast.content : [];
  if (content.length === 0) return [];
  const sections: DocumentSection[] = [];
  const hasStructuredSections = content.some((node) =>
    ["slide", "page", "sheet"].includes(String(node.type)),
  );
  if (hasStructuredSections) {
    for (const [index, node] of content.entries()) {
      const type = String(node.type);
      if (!["slide", "page", "sheet"].includes(type)) continue;
      const number = numberFromMetadata(node.metadata) ?? index + 1;
      const text = collectNodeText(node).trim();
      if (!text) continue;
      sections.push({
        location: type as DocumentSectionLocation,
        index: number,
        title: firstTitle(node),
        text,
        tables: collectTableText(node),
        imageReferences: collectImageReferences(node),
      });
    }
    return sections;
  }

  const text = content.map(collectNodeText).join("\n").trim();
  return text
    ? [
        {
          location: "document",
          index: null,
          title: firstTitle({ children: content }),
          text,
          tables: collectTableText({ children: content }),
          imageReferences: collectImageReferences({ children: content }),
        },
      ]
    : [];
}

function collectNodeText(node: OfficeNode): string {
  const own = typeof node.text === "string" ? node.text : "";
  const children = (node.children ?? []).map(collectNodeText).filter(Boolean).join("\n");
  const notes = (node.notes ?? []).map(collectNodeText).filter(Boolean).join("\n");
  return [own, children, notes].filter(Boolean).join("\n");
}

function collectTableText(node: OfficeNode): string[] {
  const tables: string[] = [];
  const visit = (current: OfficeNode) => {
    if (current.type === "table" || current.type === "sheet") {
      const text = collectNodeText(current).trim();
      if (text) tables.push(text.slice(0, DOCUMENT_CONTEXT_SINGLE_SECTION_MAX_CHARACTERS));
    }
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return tables;
}

function collectImageReferences(node: OfficeNode): string[] {
  const references: string[] = [];
  const visit = (current: OfficeNode) => {
    if (current.type === "image" || current.type === "chart") {
      references.push(current.type);
    }
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return references;
}

function firstTitle(node: OfficeNode): string | null {
  const candidates: string[] = [];
  const visit = (current: OfficeNode) => {
    if (current.type === "paragraph" && current.text?.trim()) candidates.push(current.text.trim());
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return candidates[0]?.slice(0, 200) ?? null;
}

function numberFromMetadata(metadata: Record<string, unknown> | undefined): number | null {
  if (!metadata) return null;
  for (const key of ["slideNumber", "pageNumber", "sheetNumber"]) {
    const value = metadata[key];
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  return null;
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

function validateMagicBytes(bytes: Buffer, extension: string, mimeType: string): void {
  const isPdf = bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  const isZip = bytes.subarray(0, 2).toString("ascii") === "PK";
  const isText = SUPPORTED_TEXT_EXTENSIONS.has(extension);
  if (extension === "pdf" && !isPdf) {
    throw new DocumentParseError("invalid_mime", "文件不是有效的 PDF。 ");
  }
  if (["docx", "xlsx", "pptx"].includes(extension) && !isZip) {
    throw new DocumentParseError("invalid_mime", "文件内容与扩展名不匹配。 ");
  }
  if (!isText && !isPdf && !isZip) {
    throw new DocumentParseError("invalid_mime", `无法验证 ${mimeType || extension} 文件类型。`);
  }
}
