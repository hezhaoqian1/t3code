import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";

/**
 * A three-page report like the fund reports employees attach:
 * 1. text with a small header logo on the page,
 * 2. text plus a chart drawn as an image,
 * 3. a scanned page (one image, no text layer).
 */
export async function reportPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const swatch = async (color: string, width: number, height: number) => {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    context.fillStyle = color;
    context.fillRect(width * 0.1, height * 0.1, width * 0.8, height * 0.8);
    return pdf.embedPng(await canvas.encode("png"));
  };
  const logo = await swatch("navy", 60, 20);

  const first = pdf.addPage([400, 600]);
  first.drawImage(logo, { x: 20, y: 560, width: 60, height: 20 });
  first.drawText("Holdings by industry", { x: 30, y: 500, font, size: 12 });
  first.drawText("Industry", { x: 30, y: 470, font, size: 10 });
  first.drawText("PE", { x: 200, y: 470, font, size: 10 });
  first.drawText("Electronics", { x: 30, y: 450, font, size: 10 });
  first.drawText("69.31", { x: 200, y: 450, font, size: 10 });

  const second = pdf.addPage([400, 600]);
  second.drawImage(logo, { x: 20, y: 560, width: 60, height: 20 });
  second.drawText("Net value chart for the reporting period", { x: 30, y: 520, font, size: 12 });
  second.drawImage(await swatch("green", 300, 200), { x: 50, y: 250, width: 300, height: 200 });

  const third = pdf.addPage([400, 600]);
  third.drawImage(await swatch("red", 400, 600), { x: 0, y: 0, width: 400, height: 600 });
  return pdf.save();
}
