import { describe, expect, it } from "vite-plus/test";
import {
  classifyPdfPage,
  formatPageRanges,
  layoutPageText,
  pageTitle,
  parsePageSelection,
  rasterImageCoverage,
  runningHeaderLines,
  type PdfTextItem,
} from "./PdfPages.ts";

const item = (str: string, x: number, y: number, width: number, height = 10): PdfTextItem => ({
  str,
  transform: [height, 0, 0, height, x, y],
  width,
  height,
});

const codes = {
  save: 10,
  restore: 11,
  transform: 12,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintImageMaskXObject: 83,
};

describe("layoutPageText", () => {
  it("keeps table rows on one line with columns separated", () => {
    // pdf.js emits a table cell by cell; columns sit far apart on one baseline.
    const text = layoutPageText([
      item("分类", 50, 700, 20),
      item("组合pe", 150, 700, 30),
      item("占比（%）", 250, 700, 45),
      item("电子", 50, 680, 20),
      item("69.31", 150, 680, 25),
      item("56.74", 250, 680, 25),
    ]);
    expect(text).toBe("分类 | 组合pe | 占比（%）\n电子 | 69.31 | 56.74");
  });

  it("joins pieces of one sentence without inventing columns", () => {
    const text = layoutPageText([
      item("管理人：上海鸣石", 50, 700, 80),
      item("私募基金管理有限公司", 130, 700, 100),
      item("Net", 50, 680, 15),
      item("asset", 67, 680, 25),
    ]);
    expect(text).toBe("管理人：上海鸣石私募基金管理有限公司\nNet asset");
  });

  it("orders lines top to bottom and ignores empty items", () => {
    const text = layoutPageText([
      item("second", 50, 600, 30),
      item("  ", 50, 650, 5),
      item("first", 50, 700, 25),
    ]);
    expect(text).toBe("first\nsecond");
  });
});

describe("rasterImageCoverage", () => {
  const page = { x0: 0, y0: 0, x1: 600, y1: 800 };

  it("measures each image through the current transform", () => {
    const coverage = rasterImageCoverage(
      {
        fnArray: [codes.save, codes.transform, codes.paintImageXObject, codes.restore],
        argsArray: [null, [300, 0, 0, 400, 0, 0], ["img1"], null],
      },
      codes,
      page,
    );
    expect(coverage).toBeCloseTo(0.25);
  });

  it("treats a small logo as small and restores the matrix after it", () => {
    const coverage = rasterImageCoverage(
      {
        fnArray: [
          codes.save,
          codes.transform,
          codes.paintImageXObject,
          codes.restore,
          codes.paintImageXObject,
        ],
        // A 60x24 logo, then an image drawn in the restored identity matrix (1x1).
        argsArray: [null, [60, 0, 0, 24, 30, 760], ["logo"], null, ["dot"]],
      },
      codes,
      page,
    );
    expect(coverage).toBeLessThan(0.01);
  });

  it("applies form XObject matrices and clips to the page", () => {
    const coverage = rasterImageCoverage(
      {
        fnArray: [
          codes.paintFormXObjectBegin,
          codes.transform,
          codes.paintImageXObject,
          codes.paintFormXObjectEnd,
        ],
        // The form doubles everything; the 400x500 image becomes 800x1000 and is clipped.
        argsArray: [
          [
            [2, 0, 0, 2, 0, 0],
            [0, 0, 1, 1],
          ],
          [400, 0, 0, 500, 0, 0],
          ["img"],
          null,
        ],
      },
      codes,
      page,
    );
    expect(coverage).toBe(1);
  });
});

describe("classifyPdfPage", () => {
  it("separates text, figure and scanned pages", () => {
    expect(classifyPdfPage({ characters: 1200, imageCoverage: 0.01 })).toBe("text");
    expect(classifyPdfPage({ characters: 300, imageCoverage: 0.24 })).toBe("figure");
    expect(classifyPdfPage({ characters: 0, imageCoverage: 0.9 })).toBe("scanned");
    expect(classifyPdfPage({ characters: 0, imageCoverage: 0 })).toBe("scanned");
    expect(classifyPdfPage({ characters: 12, imageCoverage: 0.02 })).toBe("text");
  });
});

describe("page titles", () => {
  it("skips running headers and footers that differ only by page number", () => {
    const pages = [
      "基金绩效评估报告\n1. 产品总体概况\n请务必阅读文末免责条款 | 第 1 页",
      "基金绩效评估报告\n2.2. 周收益表现\n请务必阅读文末免责条款 | 第 2 页",
      "基金绩效评估报告\n2.3. 收益分析\n请务必阅读文末免责条款 | 第 3 页",
    ];
    const headers = runningHeaderLines(pages);
    expect(pageTitle(pages[1]!, headers)).toBe("2.2. 周收益表现");
    expect(pageTitle("基金绩效评估报告\n请务必阅读文末免责条款 | 第 9 页", headers)).toBeNull();
  });
});

describe("page selections", () => {
  it("parses single pages, ranges and lists", () => {
    expect(parsePageSelection("1,4-6", 28, 20)).toEqual([1, 4, 5, 6]);
    expect(parsePageSelection("22", 28, 4)).toEqual([22]);
    expect(parsePageSelection("3至5", 28, 4)).toEqual([3, 4, 5]);
  });

  it("explains invalid selections instead of guessing", () => {
    expect(parsePageSelection("30", 28, 4)).toContain("共 28 页");
    expect(parsePageSelection("1-6", 28, 4)).toContain("最多 4 页");
    expect(parsePageSelection("abc", 28, 4)).toContain("无法识别");
  });

  it("compresses page lists into ranges", () => {
    expect(formatPageRanges([1, 4, 5, 6, 8])).toBe("1、4–6、8");
    expect(formatPageRanges([])).toBe("");
  });
});
