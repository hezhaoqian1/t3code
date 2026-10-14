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
  /**
   * A worksheet or CSV whose `text` is one row per line. The prompt may carry
   * only its first rows; `dataPath` holds every row as UTF-8 CSV.
   */
  readonly table?: SectionTable;
}

export interface SectionTable {
  readonly rows: number;
  readonly columns: number;
  readonly dataPath?: string;
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

/** A table the prompt carries only partly, for the attachment guide. */
export interface PartialTable {
  readonly sheetIndex: number | null;
  readonly name: string;
  readonly rows: number;
  readonly columns: number;
  /** Rows (counting the header line) placed in the prompt. */
  readonly includedRows: number;
  readonly dataPath?: string;
}

export interface FormattedDocuments {
  readonly text: string;
  /** Pages or slides left out per attachment id. */
  readonly omitted: ReadonlyMap<string, ReadonlyArray<number>>;
  /** Tables cut short per attachment id. */
  readonly partialTables: ReadonlyMap<string, ReadonlyArray<PartialTable>>;
}

const SECTION_SEPARATOR = "\n\n---\n\n";

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/** The longest prefix of `value` within `maxBytes`, without splitting a character. */
function utf8Prefix(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  return Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8").replace(/�+$/, "");
}

/**
 * Splits `budget` among demands so small ones are met in full and the rest
 * share what is left equally (water-filling).
 */
function fairShares(demands: ReadonlyArray<number>, budget: number): number[] {
  const shares = demands.map(() => 0);
  let remaining = Math.max(0, budget);
  let open = demands.map((_, index) => index);
  while (open.length > 0 && remaining > 0) {
    const equal = Math.floor(remaining / open.length);
    const satisfied = open.filter((index) => demands[index]! - shares[index]! <= equal);
    if (satisfied.length === 0) {
      for (const index of open) shares[index]! += equal;
      break;
    }
    for (const index of satisfied) {
      remaining -= demands[index]! - shares[index]!;
      shares[index] = demands[index]!;
    }
    open = open.filter((index) => !satisfied.includes(index));
  }
  return shares;
}

function sectionHeader(
  attachmentIndex: number,
  context: DocumentContext,
  section: DocumentSection,
) {
  const location =
    section.index === null
      ? "文档"
      : section.location === "sheet"
        ? `${locationLabel(section.location)} ${section.index}`
        : `第 ${section.index} ${locationLabel(section.location)}`;
  return [
    `[附件 ${attachmentIndex + 1}]`,
    `文件：${context.attachment.name}`,
    `来源：${location}`,
    section.title ? `标题：${section.title}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Formats extracted document text for the model within a UTF-8 byte budget.
 * Each attachment gets a fair share, so one large file cannot crowd out the
 * others. PDF pages and slides are added whole, in order, and the ones that do
 * not fit are reported back; tables are cut at row boundaries and reported
 * with how many rows the prompt carries; other text is cut at the budget.
 */
export function formatAttachmentDocuments(
  contexts: ReadonlyArray<DocumentContext>,
  options: {
    readonly maxBytes: number;
    readonly omittedNotice?: (name: string) => string;
    readonly partialTableNotice?: (name: string) => string;
  },
): FormattedDocuments {
  const rendered = contexts.map((context, attachmentIndex) =>
    context.sections.map((section) => {
      const header = sectionHeader(attachmentIndex, context, section);
      return { section, header, whole: `${header}\n内容：\n${section.text}` };
    }),
  );
  const demands = rendered.map((sections) =>
    sections.reduce((sum, item) => sum + utf8Bytes(item.whole) + SECTION_SEPARATOR.length, 0),
  );
  const shares = fairShares(demands, options.maxBytes);

  const sections: string[] = [];
  const omitted = new Map<string, number[]>();
  const partialTables = new Map<string, PartialTable[]>();
  let cut = false;

  for (const [attachmentIndex, context] of contexts.entries()) {
    const items = rendered[attachmentIndex]!;
    let budget = shares[attachmentIndex]!;
    const paged = items.every(
      (item) =>
        item.section.index !== null &&
        (item.section.location === "page" || item.section.location === "slide"),
    );
    if (paged) {
      // Whole pages only, and once one is left out so are the rest: the
      // model sees a clean prefix and a list of what to read next.
      for (const item of items) {
        const size = utf8Bytes(item.whole) + SECTION_SEPARATOR.length;
        if (!omitted.has(context.attachment.id) && size <= budget) {
          sections.push(item.whole);
          budget -= size;
        } else {
          omitted.set(context.attachment.id, [
            ...(omitted.get(context.attachment.id) ?? []),
            item.section.index!,
          ]);
        }
      }
      continue;
    }
    const itemShares = fairShares(
      items.map((item) => utf8Bytes(item.whole) + SECTION_SEPARATOR.length),
      budget,
    );
    for (const [itemIndex, item] of items.entries()) {
      const share = itemShares[itemIndex]! - SECTION_SEPARATOR.length;
      const table = item.section.table;
      if (utf8Bytes(item.whole) <= share) {
        // The section text may itself be only a preview of a longer table.
        const lines = item.section.text.split("\n").length;
        if (table && table.rows > lines) {
          const list = partialTables.get(context.attachment.id) ?? [];
          list.push({
            sheetIndex: item.section.index,
            name: item.section.title ?? context.attachment.name,
            rows: table.rows,
            columns: table.columns,
            includedRows: lines,
            ...(table.dataPath ? { dataPath: table.dataPath } : {}),
          });
          partialTables.set(context.attachment.id, list);
          sections.push(
            `${item.whole}\n[本表共 ${table.rows} 行，此处只放入前 ${lines} 行，见 [表格附件说明]]`,
          );
        } else {
          sections.push(item.whole);
        }
        continue;
      }
      const prefix = `${item.header}\n内容：\n`;
      const bodyBudget = share - utf8Bytes(prefix) - 200;
      if (table) {
        const lines = item.section.text.split("\n");
        let kept = 0;
        let used = 0;
        for (const line of lines) {
          const size = utf8Bytes(line) + 1;
          if (used + size > bodyBudget) break;
          used += size;
          kept++;
        }
        const list = partialTables.get(context.attachment.id) ?? [];
        list.push({
          sheetIndex: item.section.index,
          name: item.section.title ?? context.attachment.name,
          rows: table.rows,
          columns: table.columns,
          includedRows: kept,
          ...(table.dataPath ? { dataPath: table.dataPath } : {}),
        });
        partialTables.set(context.attachment.id, list);
        if (kept === 0) continue;
        sections.push(
          `${prefix}${lines.slice(0, kept).join("\n")}\n[本表共 ${table.rows} 行，此处只放入前 ${kept} 行，见 [表格附件说明]]`,
        );
        continue;
      }
      cut = true;
      if (bodyBudget <= 0) continue;
      sections.push(`${prefix}${utf8Prefix(item.section.text, bodyBudget)}\n[本段内容已截断]`);
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
    if (partialTables.has(context.attachment.id))
      warnings.push(
        options.partialTableNotice?.(context.attachment.name) ??
          `附件 ${context.attachment.name} 的表格只放入了前面部分行，不能据此推断全表结果。`,
      );
  }
  if (cut) warnings.push("附件总文本超过本轮容量，部分内容未提供，不能声称已完整阅读。");
  if (sections.length === 0 && warnings.length === 0) return { text: "", omitted, partialTables };
  return {
    text: [
      "以下是用户本轮上传文件的可读内容。请引用页码、幻灯片或工作表来源；如果内容已截断或来自扫描件，请明确说明。",
      sections.join(SECTION_SEPARATOR),
      warnings.length > 0 ? `[附件提示]\n${warnings.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    omitted,
    partialTables,
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
