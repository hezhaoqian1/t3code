import { describe, expect, it } from "vite-plus/test";
import { DOCUMENT_EXTENSIONS } from "@t3tools/shared/documentFormats";
import {
  DESKTOP_DOCUMENT_ACCEPT,
  documentMimeType,
  normalizeDocumentFile,
  isSupportedDocumentFile,
  validateDesktopDocumentFile,
} from "./documentAttachments";

describe("document format selection", () => {
  it.each(DOCUMENT_EXTENSIONS)(
    "accepts and infers %s even when the OS omits the MIME type",
    (extension) => {
      const file = new File(["fixture"], `report${extension.toUpperCase()}`);
      expect(isSupportedDocumentFile(file)).toBe(true);
      expect(validateDesktopDocumentFile(file)).toBeNull();
      expect(documentMimeType(file)).not.toBe("application/octet-stream");
      expect(DESKTOP_DOCUMENT_ACCEPT.split(",")).toContain(extension);
    },
  );
  it("rejects unsupported archives and empty files", () => {
    expect(validateDesktopDocumentFile(new File(["zip"], "files.zip"))).toContain("暂不支持");
    expect(validateDesktopDocumentFile(new File([], "report.pdf"))).toContain("为空");
  });
  it.each(DOCUMENT_EXTENSIONS)(
    "normalizes the uploaded %s blob without changing its bytes",
    async (extension) => {
      const original = new File(["validation token 7319"], `report${extension}`, {
        type: "application/octet-stream",
        lastModified: 12345,
      });
      const upload = normalizeDocumentFile(original);
      expect(upload.type).toBe(documentMimeType(original));
      expect(upload.name).toBe(original.name);
      expect(upload.lastModified).toBe(original.lastModified);
      expect(await upload.text()).toBe(await original.text());
    },
  );
});
