import type { ChatDocumentAttachment } from "@t3tools/contracts";

export type DocumentSectionLocation = "document" | "page" | "slide" | "sheet";

export interface DocumentWarning {
  readonly code: "truncated" | "ocr_unavailable" | "no_text" | "parser_warning" | "unsupported";
  readonly message: string;
}

export interface DocumentSection {
  readonly location: DocumentSectionLocation;
  readonly index: number | null;
  readonly title: string | null;
  readonly text: string;
  readonly tables: ReadonlyArray<string>;
  readonly imageReferences: ReadonlyArray<string>;
}

export interface DocumentContext {
  readonly attachment: ChatDocumentAttachment;
  readonly parser: string;
  readonly sections: ReadonlyArray<DocumentSection>;
  readonly warnings: ReadonlyArray<DocumentWarning>;
  readonly extractedCharacters: number;
  readonly truncated: boolean;
  readonly ocrUsed: boolean;
}

export const DOCUMENT_CONTEXT_MAX_CHARACTERS = 160_000;
export const DOCUMENT_CONTEXT_SINGLE_SECTION_MAX_CHARACTERS = DOCUMENT_CONTEXT_MAX_CHARACTERS;

export interface FormattedDocuments {
  readonly text: string;
  /** Sections left out per attachment id, as section indexes (pages for PDFs). */
  readonly omitted: ReadonlyMap<string, ReadonlyArray<number>>;
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/**
 * Formats extracted document text for the model within a UTF-8 byte budget.
 * Paged documents (PDF pages, slides) are added whole, in order, and the pages
 * that do not fit are reported back so the caller can point the model at the
 * page tools; unpaged text is cut at the budget like before.
 */
export function formatAttachmentDocuments(
  contexts: ReadonlyArray<DocumentContext>,
  options: { readonly maxBytes: number; readonly omittedNotice?: (name: string) => string },
): FormattedDocuments {
  const sections: string[] = [];
  const omitted = new Map<string, number[]>();
  let remaining = options.maxBytes;
  let cut = false;

  for (const [attachmentIndex, context] of contexts.entries()) {
    for (const section of context.sections) {
      const location =
        section.index === null
          ? "文档"
          : section.location === "sheet"
            ? `${locationLabel(section.location)} ${section.index}`
            : `第 ${section.index} ${locationLabel(section.location)}`;
      const header = [
        `[附件 ${attachmentIndex + 1}]`,
        `文件：${context.attachment.name}`,
        `来源：${location}`,
        section.title ? `标题：${section.title}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const whole = `${header}\n内容：\n${section.text}`;
      const paged =
        section.index !== null && (section.location === "page" || section.location === "slide");
      const pagesOmitted = omitted.get(context.attachment.id);
      if (!pagesOmitted && utf8Bytes(whole) + 8 <= remaining) {
        sections.push(whole);
        remaining -= utf8Bytes(whole) + 8;
        continue;
      }
      if (paged) {
        // Whole pages only, and once one is left out so are the rest: the
        // model sees a clean prefix and a list of what to read next.
        omitted.set(context.attachment.id, [...(pagesOmitted ?? []), section.index!]);
        continue;
      }
      const budget = remaining - utf8Bytes(header) - 64;
      if (budget <= 0) {
        cut = true;
        continue;
      }
      const body = Buffer.from(section.text, "utf8")
        .subarray(0, budget)
        .toString("utf8")
        .replace(/\uFFFD+$/, "");
      sections.push(`${header}\n内容：\n${body}\n[本段内容已截断]`);
      remaining -= utf8Bytes(sections.at(-1)!) + 8;
      cut = true;
    }
  }

  const warnings = contexts.flatMap((context) =>
    context.warnings.map((warning) => `附件 ${context.attachment.name}：${warning.message}`),
  );
  for (const context of contexts) {
    if (omitted.has(context.attachment.id))
      warnings.push(
        options.omittedNotice?.(context.attachment.name) ??
          `附件 ${context.attachment.name} 的部分页面未放入本轮，不能声称已完整阅读。`,
      );
  }
  if (cut) warnings.push("附件总文本超过本轮容量，部分内容未提供，不能声称已完整阅读。");
  if (sections.length === 0 && warnings.length === 0) return { text: "", omitted };
  return {
    text: [
      "以下是用户本轮上传文件的可读内容。请引用页码、幻灯片或工作表来源；如果内容已截断或来自扫描件，请明确说明。",
      sections.join("\n\n---\n\n"),
      warnings.length > 0 ? `[附件提示]\n${warnings.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    omitted,
  };
}

export function formatDocumentContext(contexts: ReadonlyArray<DocumentContext>): string {
  return formatAttachmentDocuments(contexts, { maxBytes: DOCUMENT_CONTEXT_MAX_CHARACTERS * 3 })
    .text;
}

function locationLabel(location: DocumentSectionLocation): string {
  switch (location) {
    case "page":
      return "页";
    case "slide":
      return "张幻灯片";
    case "sheet":
      return "工作表";
    default:
      return "文档";
  }
}
