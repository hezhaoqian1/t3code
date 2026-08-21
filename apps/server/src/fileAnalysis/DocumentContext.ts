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

export const DOCUMENT_CONTEXT_MAX_CHARACTERS = 40_000;
export const DOCUMENT_CONTEXT_SINGLE_SECTION_MAX_CHARACTERS = 16_000;

export function formatDocumentContext(contexts: ReadonlyArray<DocumentContext>): string {
  const sections: string[] = [];
  let remaining = DOCUMENT_CONTEXT_MAX_CHARACTERS;

  for (const [attachmentIndex, context] of contexts.entries()) {
    for (const section of context.sections) {
      if (remaining <= 0) break;
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
      const bodyBudget = Math.max(
        0,
        Math.min(remaining - header.length - 20, DOCUMENT_CONTEXT_SINGLE_SECTION_MAX_CHARACTERS),
      );
      if (bodyBudget <= 0) break;
      const body = section.text.slice(0, bodyBudget);
      const sectionText = `${header}\n内容：\n${body}${body.length < section.text.length ? "\n[本段内容已截断]" : ""}`;
      sections.push(sectionText);
      remaining -= sectionText.length;
    }
  }

  if (sections.length === 0) return "";
  const warnings = contexts.flatMap((context) =>
    context.warnings.map((warning) => `附件 ${context.attachment.name}：${warning.message}`),
  );
  return [
    "以下是用户本轮上传文件的可读内容。请引用页码、幻灯片或工作表来源；如果内容已截断或来自扫描件，请明确说明。",
    sections.join("\n\n---\n\n"),
    warnings.length > 0 ? `[附件提示]\n${warnings.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
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
