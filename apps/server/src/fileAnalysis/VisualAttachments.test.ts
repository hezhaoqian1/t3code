// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "@effect/vitest";
import { processAttachment, imageTiles, type AttachmentWork } from "./VisualAttachments.ts";
import { runAttachmentWorker } from "./AttachmentWorkerClient.ts";

async function fixture(
  name: string,
  bytes: Uint8Array,
  run: (work: AttachmentWork) => Promise<void>,
) {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fd-visual-test-"));
  try {
    const path = NodePath.join(directory, name);
    await NodeFSP.writeFile(path, bytes);
    await run({
      path,
      visual: true,
      attachment: {
        type: name.endsWith("pdf") ? "document" : "image",
        id: "fixture",
        name,
        mimeType: name.endsWith("pdf") ? "application/pdf" : "image/png",
        sizeBytes: bytes.length,
      },
    });
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
}

async function mixedPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([400, 600]).drawText("Text page revenue 123", { x: 30, y: 500, font });
  const canvas = createCanvas(400, 600);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, 400, 600);
  context.fillStyle = "red";
  context.fillRect(30, 30, 180, 150);
  const image = await pdf.embedPng(await canvas.encode("png"));
  pdf.addPage([400, 600]).drawImage(image, { x: 0, y: 0, width: 400, height: 600 });
  return pdf.save();
}

describe("visual attachments", () => {
  it("keeps an overlap-boundary text line whole in the neighbouring long-image tile", async () => {
    const canvas = createCanvas(800, 6000);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, 800, 6000);
    context.fillStyle = "black";
    context.font = "32px Arial";
    context.fillText("PROOF_IMAGE_BOTTOM_2058", 30, 5900);
    await fixture("edge.png", await canvas.encode("png"), async (work) => {
      const result = await processAttachment(work);
      expect(result.images).toHaveLength(4);
      const partial = await loadImage(Buffer.from(result.images[2]!.bytes));
      const whole = await loadImage(Buffer.from(result.images[3]!.bytes));
      const countInk = (image: typeof partial) => {
        const target = createCanvas(image.width, image.height);
        const ctx = target.getContext("2d");
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! < 128) count++;
        return count;
      };
      expect(countInk(partial)).toBe(0);
      expect(countInk(whole)).toBeGreaterThan(100);
    });
  });
  it("covers every long-image pixel with ordered overlapping tiles", () => {
    const tiles = imageTiles(1000, 20000);
    expect(tiles.length).toBeGreaterThan(8);
    expect(tiles[0]).toMatchObject({ x: 0, y: 0, width: 1000, height: 2048 });
    for (let index = 1; index < tiles.length; index++) {
      expect(tiles[index]!.y).toBe(tiles[index - 1]!.y + tiles[index - 1]!.height - 128);
    }
    expect(tiles.at(-1)!.y + tiles.at(-1)!.height).toBe(20000);
    expect(() => imageTiles(100000, 100000)).toThrow("像素");
  });

  it("renders both the text page and scanned page with original page numbers", async () => {
    await fixture("mixed.pdf", await mixedPdf(), async (work) => {
      const result = await processAttachment(work);
      expect(result.context?.sections[0]?.text).toContain("revenue 123");
      expect(result.images.map((image) => image.label)).toEqual([
        "mixed.pdf：第 1/2 页",
        "mixed.pdf：第 2/2 页",
      ]);
      const rendered = await loadImage(Buffer.from(result.images[1]!.bytes));
      const canvas = createCanvas(rendered.width, rendered.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(rendered, 0, 0);
      const pixel = ctx.getImageData(100, 100, 1, 1).data;
      expect(pixel[0]).toBeGreaterThan(200);
      expect(pixel[1]).toBeLessThan(40);
      await expect(processAttachment({ ...work, visual: false })).rejects.toThrow("第 2 页");
    });
  });

  it("runs the real parser off-thread and preserves long-image width", async () => {
    const canvas = createCanvas(800, 6000);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 800, 6000);
    ctx.fillStyle = "blue";
    ctx.fillRect(0, 5800, 800, 200);
    await fixture("long.png", await canvas.encode("png"), async (work) => {
      const result = await runAttachmentWorker(work, new AbortController().signal, "win32");
      expect(result.images).toHaveLength(4);
      const last = await loadImage(Buffer.from(result.images.at(-1)!.bytes));
      expect(last.width).toBe(800);
      const c = createCanvas(last.width, last.height);
      const context = c.getContext("2d");
      context.drawImage(last, 0, 0);
      const pixel = context.getImageData(20, last.height - 20, 1, 1).data;
      expect(pixel[2]).toBeGreaterThan(200);
      expect(pixel[0]).toBeLessThan(40);
      const controller = new AbortController();
      controller.abort();
      await expect(runAttachmentWorker(work, controller.signal, "win32")).rejects.toThrow();
    });
  });

  it("refuses oversized PDFs without silently dropping pages", async () => {
    const pdf = await PDFDocument.create();
    for (let index = 0; index < 61; index++) pdf.addPage([100, 100]);
    await fixture("large.pdf", await pdf.save(), async (work) => {
      await expect(processAttachment(work)).rejects.toThrow("61 页");
    });
  });
});
