// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { imageSize } from "image-size";
import type { ChatAttachment } from "@t3tools/contracts";
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { imageBytesMatchMimeType } from "../imageMime.ts";
import type { DocumentContext, DocumentSection } from "./DocumentContext.ts";
import { parseDocumentAttachment, validateMagicBytes } from "./DocumentParser.ts";
import {
  classifyPdfPage,
  layoutPageText,
  pageTitle,
  rasterImageCoverage,
  runningHeaderLines,
  type PdfPageSummary,
  type PdfTextItem,
} from "./PdfPages.ts";

export const VISUAL_LIMITS = {
  maxTiles: 64,
  tileEdge: 2048,
  overlap: 128,
  maxPixels: 64_000_000,
  maxImageBytes: 10 * 1024 * 1024,
  maxOutputBytes: 48 * 1024 * 1024,
} as const;

export const PDF_LIMITS = {
  /** Text extraction is cheap; this only guards against pathological files. */
  maxPages: 500,
  /** Scanned pages recognized before the turn; the rest are read on demand. */
  maxEagerScannedPages: 40,
  /** Pages one page-tool call may render. */
  maxRenderPages: 6,
} as const;

export interface VisualPart {
  readonly label: string;
  readonly bytes: Uint8Array;
  /** The PDF page this image shows, when it comes from a PDF. */
  readonly page?: number;
}

export interface PdfDocumentOutline {
  readonly pageCount: number;
  readonly pages: ReadonlyArray<PdfPageSummary>;
  /** Scanned pages that were not recognized up front. */
  readonly deferredScannedPages: ReadonlyArray<number>;
}

export interface ProcessedAttachment {
  readonly context?: DocumentContext;
  readonly images: ReadonlyArray<VisualPart>;
  readonly passthrough?: boolean;
  readonly pdf?: PdfDocumentOutline;
}

export interface AttachmentWork {
  readonly attachment: ChatAttachment;
  readonly path: string;
  /** Whether scanned PDF pages and image tiles may be rendered for vision. */
  readonly visual: boolean;
  /** Render only these PDF pages (1-based), for on-demand page viewing. */
  readonly renderPages?: ReadonlyArray<number>;
  /** Render each requested page as two overlapping halves (see `pageHalves`). */
  readonly splitPages?: boolean;
}

/**
 * Two overlapping halves of a page, split across its longer side. The vision
 * route shrinks every image to a fixed budget, so a whole page leaves chart
 * ticks and legends too small to read; each half gets that budget to itself.
 */
export function pageHalves(width: number, height: number) {
  const tall = height >= width;
  const length = tall ? height : width;
  const overlap = Math.round(length * 0.08);
  const first = Math.ceil(length / 2) + overlap;
  const secondStart = Math.floor(length / 2) - overlap;
  return tall
    ? [
        { x: 0, y: 0, width, height: first, region: "上半部分" },
        { x: 0, y: secondStart, width, height: height - secondStart, region: "下半部分" },
      ]
    : [
        { x: 0, y: 0, width: first, height, region: "左半部分" },
        { x: secondStart, y: 0, width: width - secondStart, height, region: "右半部分" },
      ];
}

export function imageTiles(width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > VISUAL_LIMITS.maxPixels
  ) {
    throw new Error("图片像素过大或尺寸无效，请裁剪后重试。");
  }
  const tiles: Array<{ x: number; y: number; width: number; height: number }> = [];
  const step = VISUAL_LIMITS.tileEdge - VISUAL_LIMITS.overlap;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      tiles.push({
        x,
        y,
        width: Math.min(VISUAL_LIMITS.tileEdge, width - x),
        height: Math.min(VISUAL_LIMITS.tileEdge, height - y),
      });
      if (tiles.length > VISUAL_LIMITS.maxTiles) throw new Error("图片分段过多，请分批上传。");
      if (x + VISUAL_LIMITS.tileEdge >= width) break;
    }
    if (y + VISUAL_LIMITS.tileEdge >= height) break;
  }
  return tiles;
}

export async function processAttachment(work: AttachmentWork): Promise<ProcessedAttachment> {
  const { attachment } = work;
  const bytes = await NodeFSP.readFile(work.path);
  if (
    bytes.length === 0 ||
    bytes.length !== attachment.sizeBytes ||
    bytes.length > (attachment.type === "image" ? VISUAL_LIMITS.maxImageBytes : 25 * 1024 * 1024)
  ) {
    throw new Error("附件大小校验失败，请重新选择文件。");
  }
  if (attachment.type === "document") {
    if (attachment.name.toLowerCase().endsWith(".pdf")) return processPdf(work, bytes);
    return { context: await parseDocumentAttachment({ attachment, path: work.path }), images: [] };
  }
  if (!imageBytesMatchMimeType(bytes, attachment.mimeType))
    throw new Error("图片内容与格式不匹配，请重新导出 PNG 或 JPEG。");
  const dimensions = imageSize(bytes);
  const tiles = imageTiles(dimensions.width, dimensions.height);
  if (!work.visual) throw new Error("当前模型未开通图片识别，请切换 Flash 后重试。");
  if (tiles.length === 1) return { images: [], passthrough: true };
  const image = await loadImage(bytes);
  const images: VisualPart[] = [];
  let totalBytes = 0;
  for (const [index, tile] of tiles.entries()) {
    const canvas = createCanvas(tile.width, tile.height);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, tile.width, tile.height);
    context.drawImage(
      image,
      tile.x,
      tile.y,
      tile.width,
      tile.height,
      0,
      0,
      tile.width,
      tile.height,
    );
    // Move cuts to blank rows inside the overlap so OCR does not invent the
    // missing half of an edge-clipped line. Neighbouring tiles retain it.
    const overlap = Math.min(VISUAL_LIMITS.overlap, tile.height - 1);
    let top = 0;
    let bottom = tile.height;
    const blankRow = (pixels: Uint8ClampedArray, row: number) => {
      const start = row * tile.width * 4;
      for (let x = 1; x < tile.width; x++) {
        const offset = start + x * 4;
        for (let channel = 0; channel < 4; channel++) {
          if (Math.abs(pixels[offset + channel]! - pixels[start + channel]!) > 6) return false;
        }
      }
      return true;
    };
    if (tile.y > 0 && overlap > 0) {
      const strip = context.getImageData(0, 0, tile.width, overlap).data;
      if (!blankRow(strip, 0)) {
        for (let row = 1; row < overlap; row++) {
          if (blankRow(strip, row)) {
            top = row;
            break;
          }
        }
      }
    }
    if (tile.y + tile.height < dimensions.height && overlap > 0) {
      const strip = context.getImageData(0, tile.height - overlap, tile.width, overlap).data;
      if (!blankRow(strip, overlap - 1)) {
        for (let row = overlap - 2; row >= 0; row--) {
          if (blankRow(strip, row)) {
            bottom = tile.height - overlap + row + 1;
            break;
          }
        }
      }
    }
    const cropped =
      top === 0 && bottom === tile.height ? canvas : createCanvas(tile.width, bottom - top);
    if (cropped !== canvas)
      cropped
        .getContext("2d")
        .drawImage(canvas, 0, top, tile.width, bottom - top, 0, 0, tile.width, bottom - top);
    const output = await cropped.encode("jpeg", 90);
    totalBytes += output.length;
    if (totalBytes > VISUAL_LIMITS.maxOutputBytes)
      throw new Error("图片分段后的体积过大，请分批上传。");
    images.push({
      label: `${attachment.name}：分段 ${index + 1}/${tiles.length}，像素区域 (${tile.x},${tile.y + top}) ${tile.width}×${bottom - top}，相邻分段有重叠`,
      bytes: output,
    });
  }
  return { images };
}

async function processPdf(work: AttachmentWork, bytes: Buffer): Promise<ProcessedAttachment> {
  if (work.attachment.type !== "document") throw new Error("PDF attachment required");
  validateMagicBytes(bytes, "pdf", work.attachment.mimeType);
  const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const root = NodePath.dirname(
    NodeModule.createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
  );
  const loading = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    cMapUrl: NodePath.join(root, "cmaps/").replaceAll("\\", "/"),
    cMapPacked: true,
    standardFontDataUrl: NodePath.join(root, "standard_fonts/").replaceAll("\\", "/"),
    wasmUrl: NodePath.join(root, "wasm/").replaceAll("\\", "/"),
  });
  const name = work.attachment.name;
  const images: VisualPart[] = [];
  let totalBytes = 0;
  const render = async (page: PDFPageProxy, index: number, pageCount: number) => {
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: Math.min(2, 1600 / Math.min(natural.width, natural.height)),
    });
    if (
      !Number.isFinite(viewport.width) ||
      !Number.isFinite(viewport.height) ||
      viewport.width < 1 ||
      viewport.height < 1
    )
      throw new Error(`PDF 第 ${index} 页尺寸无效。`);
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    const tiles: ReadonlyArray<{
      x: number;
      y: number;
      width: number;
      height: number;
      region?: string;
    }> = work.splitPages ? pageHalves(width, height) : imageTiles(width, height);
    if (images.length + tiles.length > VISUAL_LIMITS.maxTiles)
      throw new Error("PDF 渲染分段超过 64 个，请拆分后上传。");
    for (const [tileIndex, tile] of tiles.entries()) {
      const canvas = createCanvas(tile.width, tile.height);
      await page.render({
        canvas: canvas as unknown as Parameters<typeof page.render>[0]["canvas"],
        viewport,
        transform: [1, 0, 0, 1, -tile.x, -tile.y],
      }).promise;
      const output = await canvas.encode("jpeg", 90);
      totalBytes += output.length;
      if (totalBytes > VISUAL_LIMITS.maxOutputBytes)
        throw new Error("PDF 页面图片总体积过大，请拆分后上传。");
      const region = tile.region
        ? `，${tile.region}（两部分在中间有重叠）`
        : tiles.length > 1
          ? `，分段 ${tileIndex + 1}/${tiles.length}，像素位置 (${tile.x},${tile.y})，相邻分段有重叠`
          : "";
      images.push({
        label: `${name}：第 ${index}/${pageCount} 页${region}`,
        page: index,
        bytes: output,
      });
    }
  };
  try {
    const pdf = await loading.promise;
    if (pdf.numPages > PDF_LIMITS.maxPages)
      throw new Error(
        `PDF 共 ${pdf.numPages} 页，单次最多处理 ${PDF_LIMITS.maxPages} 页，请拆分后上传。`,
      );

    if (work.renderPages) {
      // The page tool asks for specific pages; text and classification are cached.
      if (work.renderPages.length > PDF_LIMITS.maxRenderPages)
        throw new Error(`一次最多查看 ${PDF_LIMITS.maxRenderPages} 页。`);
      for (const index of work.renderPages) {
        if (!Number.isInteger(index) || index < 1 || index > pdf.numPages)
          throw new Error(`页码 ${index} 超出范围，本文档共 ${pdf.numPages} 页。`);
        const page = await pdf.getPage(index);
        await render(page, index, pdf.numPages);
        page.cleanup();
      }
      return { images };
    }

    const texts: string[] = [];
    const measured: Array<{ characters: number; imageCoverage: number }> = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      const text = layoutPageText(content.items as ReadonlyArray<PdfTextItem>);
      const view = page.view;
      const imageCoverage = rasterImageCoverage(await page.getOperatorList(), OPS, {
        x0: view[0] ?? 0,
        y0: view[1] ?? 0,
        x1: view[2] ?? 0,
        y1: view[3] ?? 0,
      });
      texts.push(text);
      measured.push({ characters: text.replace(/\s/g, "").length, imageCoverage });
      page.cleanup();
    }

    const runningHeaders = runningHeaderLines(texts);
    const pages: PdfPageSummary[] = measured.map((page, offset) => ({
      index: offset + 1,
      kind: classifyPdfPage(page),
      characters: page.characters,
      imageCoverage: Math.round(page.imageCoverage * 100) / 100,
      title: pageTitle(texts[offset] ?? "", runningHeaders),
    }));
    // A page with a usable text layer never needs a paid vision request up
    // front: charts are read on demand through the page tool. Scanned pages
    // have nothing else to offer, so recognize them now, within a budget.
    const scanned = pages.filter((page) => page.kind === "scanned");
    const eager = work.visual ? scanned.slice(0, PDF_LIMITS.maxEagerScannedPages) : [];
    for (const { index } of eager) {
      const page = await pdf.getPage(index);
      await render(page, index, pdf.numPages);
      page.cleanup();
    }
    const sections: DocumentSection[] = texts.flatMap((text, offset) =>
      text
        ? [
            {
              location: "page",
              index: offset + 1,
              title: null,
              text,
              tables: [],
              imageReferences: [],
            },
          ]
        : [],
    );
    const unreadScanned = scanned.slice(eager.length).map((page) => page.index);
    return {
      images,
      pdf: { pageCount: pdf.numPages, pages, deferredScannedPages: unreadScanned },
      context: {
        attachment: work.attachment,
        parser: "pdfjs-dist/6.1.200+layout",
        sections,
        warnings: [],
        extractedCharacters: sections.reduce((sum, section) => sum + section.text.length, 0),
        truncated: false,
        ocrUsed: eager.length > 0,
      },
    };
  } catch (error) {
    if (error instanceof Error && /password|encrypted/i.test(error.message))
      throw new Error("PDF 受密码保护，请先解密后上传。", { cause: error });
    throw error;
  } finally {
    await loading.destroy();
  }
}
