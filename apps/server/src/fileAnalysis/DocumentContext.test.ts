import { describe, expect, it } from "vite-plus/test";
import { formatDocumentContext, type DocumentContext } from "./DocumentContext.ts";

describe("long document evidence", () => {
  it("keeps the middle and ending of a 70 KB text attachment", () => {
    const text = `START\n${"background ".repeat(3000)}\nMIDDLE\n${"background ".repeat(3000)}\nEND`;
    const context: DocumentContext = {
      attachment: {
        type: "document",
        id: "test",
        name: "long.txt",
        mimeType: "text/plain",
        sizeBytes: text.length,
      },
      parser: "text",
      sections: [
        { location: "document", index: null, title: null, text, tables: [], imageReferences: [] },
      ],
      warnings: [],
      extractedCharacters: text.length,
      truncated: false,
      ocrUsed: false,
    };
    const result = formatDocumentContext([context]);
    expect(result).toContain(text);
    expect(result).not.toContain("[本段内容已截断]");
  });
});
