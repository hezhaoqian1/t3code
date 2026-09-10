// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { imageSize } from "image-size";
import type { ChatAttachment } from "@t3tools/contracts";
import { imageBytesMatchMimeType } from "../imageMime.ts";
import type { DocumentContext, DocumentSection } from "./DocumentContext.ts";
import { parseDocumentAttachment, validateMagicBytes } from "./DocumentParser.ts";

export const VISUAL_LIMITS = {
  maxPages: 60,
  maxTiles: 64,
  tileEdge: 2048,
  overlap: 128,
  maxPixels: 64_000_000,
  maxImageBytes: 10 * 1024 * 1024,
  maxOutputBytes: 48 * 1024 * 1024,
} as const;

export interface VisualPart {
  readonly label: string;
  readonly bytes: Uint8Array;
}

export interface ProcessedAttachment {
  readonly context?: DocumentContext;
  readonly images: ReadonlyArray<VisualPart>;
  readonly passthrough?: boolean;
}

export interface AttachmentWork {
  readonly attachment: ChatAttachment;
  readonly path: string;
  readonly visual: boolean;
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
  if (!work.visual) throw new Error("当前模型未开通图片识别，请切换 Kimi K3 后重试。");
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
    const output = await canvas.encode("jpeg", 90);
    totalBytes += output.length;
    if (totalBytes > VISUAL_LIMITS.maxOutputBytes)
      throw new Error("图片分段后的体积过大，请分批上传。");
    images.push({
      label: `${attachment.name}：分段 ${index + 1}/${tiles.length}，像素区域 (${tile.x},${tile.y}) ${tile.width}×${tile.height}，相邻分段有重叠`,
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
  const images: VisualPart[] = [];
  const sections: DocumentSection[] = [];
  let totalBytes = 0;
  try {
    const pdf = await loading.promise;
    if (pdf.numPages > VISUAL_LIMITS.maxPages)
      throw new Error(
        `PDF 共 ${pdf.numPages} 页，单次最多处理 ${VISUAL_LIMITS.maxPages} 页，请拆分后上传。`,
      );
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
        .join("")
        .trim();
      const operators = await page.getOperatorList();
      const hasRaster = operators.fnArray.some((op) =>
        [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].includes(
          op,
        ),
      );
      if (!work.visual && (!text || hasRaster))
        throw new Error(
          `PDF 第 ${index} 页包含扫描图或嵌入图片，当前模型无法完整读取，请切换 Kimi K3 后重试。`,
        );
      if (text)
        sections.push({
          location: "page",
          index,
          title: null,
          text,
          tables: [],
          imageReferences: [],
        });
      if (work.visual) {
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
        const tiles = imageTiles(Math.ceil(viewport.width), Math.ceil(viewport.height));
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
          const region =
            tiles.length > 1
              ? `，分段 ${tileIndex + 1}/${tiles.length}，像素位置 (${tile.x},${tile.y})，相邻分段有重叠`
              : "";
          images.push({
            label: `${work.attachment.name}：第 ${index}/${pdf.numPages} 页${region}`,
            bytes: output,
          });
        }
      }
      page.cleanup();
    }
    return {
      images,
      context: {
        attachment: work.attachment,
        parser: "pdfjs-dist/6.1.200",
        sections,
        warnings: work.visual
          ? []
          : [{ code: "parser_warning", message: "当前仅提取文字层，未分析图表和页面布局。" }],
        extractedCharacters: sections.reduce((sum, section) => sum + section.text.length, 0),
        truncated: false,
        ocrUsed: false,
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
