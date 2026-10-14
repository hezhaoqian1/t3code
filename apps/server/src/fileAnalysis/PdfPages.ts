/**
 * Page-level reading of a PDF's text layer and drawing operators. Pure helpers
 * over pdf.js output so the worker, the page tools, and tests share one model
 * of "what is on this page".
 */

/** The subset of a pdf.js text item this module reads. */
export interface PdfTextItem {
  readonly str: string;
  readonly transform: ReadonlyArray<number>;
  readonly width: number;
  readonly height: number;
  readonly hasEOL?: boolean;
}

/** The subset of a pdf.js operator list this module reads. */
export interface PdfOperatorList {
  readonly fnArray: ReadonlyArray<number>;
  readonly argsArray: ReadonlyArray<unknown>;
}

/** Operator codes from pdf.js `OPS`, passed in so this module stays pure. */
export interface PdfOperatorCodes {
  readonly save: number;
  readonly restore: number;
  readonly transform: number;
  readonly paintFormXObjectBegin: number;
  readonly paintFormXObjectEnd: number;
  readonly paintImageXObject: number;
  readonly paintInlineImageXObject: number;
  readonly paintImageMaskXObject: number;
}

export interface PdfPageBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * - `text`: the text layer carries the page; images are decoration (logos).
 * - `figure`: text plus a chart or picture whose values are not in the text.
 * - `scanned`: no usable text layer; only visual recognition can read it.
 */
export type PdfPageKind = "text" | "figure" | "scanned";

export interface PdfPageSummary {
  readonly index: number;
  readonly kind: PdfPageKind;
  readonly characters: number;
  /** Share of the page area covered by raster images, 0..1. */
  readonly imageCoverage: number;
  /** First meaningful line, to help the model find the right page. */
  readonly title: string | null;
}

/** Images covering less than this are logos, icons or rules. */
export const FIGURE_IMAGE_COVERAGE = 0.05;
/** A page with fewer characters than this has no usable text layer. */
export const SCANNED_PAGE_MAX_CHARACTERS = 30;
/** A scanned page is mostly one picture; small images alone are not a scan. */
export const SCANNED_IMAGE_COVERAGE = 0.25;

const COLUMN_SEPARATOR = " | ";

/**
 * Rebuilds the reading order of a page from text item positions. Items that
 * share a baseline become one line, ordered left to right; a wide gap between
 * items becomes " | " so table rows keep their columns instead of being split
 * into one cell per line.
 */
export function layoutPageText(items: ReadonlyArray<PdfTextItem>): string {
  const positioned = items
    .filter((item) => item.str.trim().length > 0)
    .map((item) => ({
      str: item.str,
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      width: Math.max(0, item.width),
      height: Math.abs(item.height) || Math.abs(item.transform[3] ?? 0) || 10,
    }));
  if (positioned.length === 0) return "";

  positioned.sort((left, right) => right.y - left.y || left.x - right.x);
  const lines: Array<{ y: number; height: number; items: typeof positioned }> = [];
  for (const item of positioned) {
    const line = lines.find(
      (candidate) =>
        Math.abs(candidate.y - item.y) <=
        Math.max(1.5, 0.45 * Math.min(candidate.height, item.height)),
    );
    if (line) line.items.push(item);
    else lines.push({ y: item.y, height: item.height, items: [item] });
  }
  lines.sort((left, right) => right.y - left.y);

  return lines
    .map((line) => {
      const ordered = line.items.toSorted((left, right) => left.x - right.x);
      let text = "";
      let previous: (typeof ordered)[number] | undefined;
      for (const item of ordered) {
        if (previous) {
          // A word space is about a quarter of the font size; table columns
          // leave noticeably more room even in dense layouts.
          const gap = item.x - (previous.x + previous.width);
          const size = Math.min(previous.height, item.height);
          if (gap > size * 0.6) text += COLUMN_SEPARATOR;
          else if (gap > size * 0.12 && !/\s$/.test(text) && !/^\s/.test(item.str)) text += " ";
        }
        text += item.str;
        previous = item;
      }
      return text.replace(/[ \t]+/g, " ").trim();
    })
    .filter((line) => line.length > 0)
    .join("\n");
}

type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function asMatrix(value: unknown): Matrix | undefined {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return undefined;
  const numbers = Array.from(value as ArrayLike<unknown>);
  if (
    numbers.length < 6 ||
    !numbers.slice(0, 6).every((n) => typeof n === "number" && Number.isFinite(n))
  )
    return undefined;
  return numbers.slice(0, 6) as unknown as Matrix;
}

/**
 * Share of the page covered by raster images. pdf.js paints every image into
 * the unit square of the current transformation matrix, so tracking
 * save/restore/transform (and form XObject matrices) gives each image's box.
 * Overlapping images are counted once per image, capped at the page area.
 */
export function rasterImageCoverage(
  operators: PdfOperatorList,
  codes: PdfOperatorCodes,
  page: PdfPageBox,
): number {
  const pageArea = (page.x1 - page.x0) * (page.y1 - page.y0);
  if (!(pageArea > 0)) return 0;
  const stack: Matrix[] = [];
  let current = IDENTITY;
  let covered = 0;
  const images = new Set([
    codes.paintImageXObject,
    codes.paintInlineImageXObject,
    codes.paintImageMaskXObject,
  ]);
  for (const [index, op] of operators.fnArray.entries()) {
    const args = operators.argsArray[index];
    if (op === codes.save) {
      stack.push(current);
    } else if (op === codes.restore) {
      current = stack.pop() ?? IDENTITY;
    } else if (op === codes.transform) {
      const matrix = asMatrix(args);
      if (matrix) current = multiply(current, matrix);
    } else if (op === codes.paintFormXObjectBegin) {
      stack.push(current);
      const matrix = Array.isArray(args) ? asMatrix(args[0]) : undefined;
      if (matrix) current = multiply(current, matrix);
    } else if (op === codes.paintFormXObjectEnd) {
      current = stack.pop() ?? IDENTITY;
    } else if (images.has(op)) {
      const corners = [
        [current[4], current[5]],
        [current[0] + current[4], current[1] + current[5]],
        [current[2] + current[4], current[3] + current[5]],
        [current[0] + current[2] + current[4], current[1] + current[3] + current[5]],
      ] as const;
      const xs = corners.map(([x]) => x);
      const ys = corners.map(([, y]) => y);
      const width = Math.min(page.x1, Math.max(...xs)) - Math.max(page.x0, Math.min(...xs));
      const height = Math.min(page.y1, Math.max(...ys)) - Math.max(page.y0, Math.min(...ys));
      if (width > 0 && height > 0) covered += width * height;
    }
  }
  return Math.min(1, covered / pageArea);
}

export function classifyPdfPage(input: {
  readonly characters: number;
  readonly imageCoverage: number;
}): PdfPageKind {
  if (input.characters < SCANNED_PAGE_MAX_CHARACTERS) {
    return input.characters === 0 || input.imageCoverage >= SCANNED_IMAGE_COVERAGE
      ? "scanned"
      : "text";
  }
  return input.imageCoverage >= FIGURE_IMAGE_COVERAGE ? "figure" : "text";
}

/** First line with real content, skipping running headers shared by most pages. */
export function pageTitle(text: string, runningHeaders: ReadonlySet<string>): string | null {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length < 2 || runningHeaders.has(runningLineKey(line))) continue;
    return line.length > 40 ? `${[...line].slice(0, 40).join("")}…` : line;
  }
  return null;
}

/** Page numbers change from page to page; the rest of a running footer does not. */
function runningLineKey(line: string): string {
  return line.trim().replace(/\d+/g, "#");
}

/** Lines that repeat on at least half of the pages (running headers and footers). */
export function runningHeaderLines(pageTexts: ReadonlyArray<string>): ReadonlySet<string> {
  if (pageTexts.length < 3) return new Set();
  const counts = new Map<string, number>();
  for (const text of pageTexts) {
    for (const line of new Set(text.split("\n").map(runningLineKey))) {
      if (line) counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }
  return new Set(
    [...counts]
      .filter(([, count]) => count >= Math.ceil(pageTexts.length / 2))
      .map(([line]) => line),
  );
}

/**
 * Parses an employee- or model-supplied page selection such as "3", "3-5" or
 * "1,4-6" into sorted unique page numbers within the document.
 */
export function parsePageSelection(
  selection: string,
  pageCount: number,
  maximum: number,
): ReadonlyArray<number> | string {
  const pages = new Set<number>();
  for (const part of selection.split(/[,，、\s]+/).filter(Boolean)) {
    const match = /^(\d+)(?:\s*[-–~～至到]\s*(\d+))?$/.exec(part);
    if (!match) return `无法识别页码“${part}”，请使用 3、3-5 或 1,4-6 这样的格式。`;
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (start < 1 || end < start || end > pageCount)
      return `页码 ${part} 超出范围，本文档共 ${pageCount} 页。`;
    for (let page = start; page <= end; page++) {
      pages.add(page);
      if (pages.size > maximum) return `一次最多 ${maximum} 页，请分批读取。`;
    }
  }
  if (pages.size === 0) return "请提供要读取的页码。";
  return [...pages].toSorted((left, right) => left - right);
}

/** Compresses sorted page numbers into ranges: [1,2,3,5] -> "1–3、5". */
export function formatPageRanges(pages: ReadonlyArray<number>): string {
  const ranges: string[] = [];
  let start: number | undefined;
  let previous: number | undefined;
  for (const page of [...pages, Number.NaN]) {
    if (start !== undefined && previous !== undefined && page === previous + 1) {
      previous = page;
      continue;
    }
    if (start !== undefined && previous !== undefined)
      ranges.push(start === previous ? `${start}` : `${start}–${previous}`);
    start = page;
    previous = page;
  }
  return ranges.join("、");
}
