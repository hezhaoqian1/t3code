import { describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import { prepareAttachments } from "./PrepareAttachments.ts";
import type { FdVisionAnalyzeInput } from "../fd-vision/FdVisionService.ts";

const turn = {
  threadId: ThreadId.make("test"),
  input: "分析报告",
  attachments: [
    {
      type: "document" as const,
      id: "test-00000000-0000-0000-0000-000000000001",
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
    },
  ],
};

describe("prepare attachments", () => {
  it("handles more than eight PDF pages using the selected Kimi model and source labels", async () => {
    const requests: FdVisionAnalyzeInput[] = [];
    const result = await prepareAttachments({
      platform: "win32",
      turn,
      model: "kimi-k3",
      attachmentsDir: "/tmp/attachments",
      signal: new AbortController().signal,
      process: async () => ({
        images: Array.from({ length: 12 }, (_, index) => ({
          label: `report.pdf page ${index + 1}`,
          bytes: new Uint8Array([1, 2]),
        })),
      }),
      vision: {
        analyze: async (request) => {
          requests.push(request);
          return "revenue 123";
        },
      },
    });
    expect(requests).toHaveLength(12);
    expect(
      requests.every((request) => request.model === "kimi-k3" && request.images.length === 1),
    ).toBe(true);
    expect(result.attachments).toEqual([]);
    expect(result.input).toContain("report.pdf page 12");
    expect(result.input).toContain('trust="none"');
  });

  it("uses the shared vision preprocessor for PDF pages with text models", async () => {
    const requests: FdVisionAnalyzeInput[] = [];
    let visualRequested = false;
    const result = await prepareAttachments({
      platform: "win32",
      turn,
      model: "glm-5.2",
      attachmentsDir: "/tmp/attachments",
      signal: new AbortController().signal,
      process: async (input) => {
        visualRequested = input.visual;
        return { images: [{ label: "page 1", bytes: new Uint8Array([1]) }] };
      },
      vision: {
        analyze: async (request) => {
          requests.push(request);
          return "text";
        },
      },
    });
    expect(requests[0]?.model).toBe("deepseek-flash");
    expect(visualRequested).toBe(true);
    expect(result.input).toContain("page 1");
  });

  it("uses the selected dynamically authorized visual model on native routes", async () => {
    const requests: FdVisionAnalyzeInput[] = [];
    await prepareAttachments({
      platform: "win32",
      turn,
      model: "qwen-vl-enterprise",
      attachmentsDir: "/tmp/attachments",
      signal: new AbortController().signal,
      process: async () => ({ images: [{ label: "page 1", bytes: new Uint8Array([1]) }] }),
      vision: {
        analyze: async (request) => {
          requests.push(request);
          return "text";
        },
      },
    });
    expect(requests[0]?.model).toBe("qwen-vl-enterprise");
  });

  it("still rejects standalone images for models without a vision route", async () => {
    const originalAttachment = turn.attachments[0]!;
    const imageTurn = {
      ...turn,
      attachments: [
        {
          type: "image" as const,
          id: originalAttachment.id,
          name: "image.png",
          mimeType: "image/png",
          sizeBytes: originalAttachment.sizeBytes,
        },
      ],
    };
    let calls = 0;
    await expect(
      prepareAttachments({
        platform: "win32",
        turn: imageTurn,
        model: "glm-5.2",
        attachmentsDir: "/tmp/attachments",
        signal: new AbortController().signal,
        process: async () => ({ images: [{ label: "image.png", bytes: new Uint8Array([1]) }] }),
        vision: {
          analyze: async () => {
            calls++;
            return "text";
          },
        },
      }),
    ).rejects.toThrow("未开通视觉");
    expect(calls).toBe(0);
  });

  it("stops before the next page after cancellation", async () => {
    const controller = new AbortController();
    let calls = 0;
    await expect(
      prepareAttachments({
        platform: "win32",
        turn,
        model: "kimi-k3",
        attachmentsDir: "/tmp/attachments",
        signal: controller.signal,
        process: async () => ({
          images: Array.from({ length: 3 }, () => ({ label: "page", bytes: new Uint8Array([1]) })),
        }),
        vision: {
          analyze: async () => {
            calls++;
            controller.abort();
            return "text";
          },
        },
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe("pasted text attachments", () => {
  const pastedTurn = {
    threadId: ThreadId.make("test"),
    input: "帮我找出报错原因",
    attachments: [
      {
        type: "document" as const,
        id: "test-00000000-0000-0000-0000-000000000002",
        name: "粘贴内容.txt",
        mimeType: "text/plain",
        sizeBytes: 40_000,
        source: "pasted-text" as const,
      },
    ],
  };

  it("sends a folded paste as the employee's own words without parsing it", async () => {
    const result = await prepareAttachments({
      platform: "win32",
      turn: pastedTurn,
      model: "deepseek-v4-flash",
      attachmentsDir: "/tmp/attachments",
      signal: new AbortController().signal,
      process: async () => {
        throw new Error("pasted text must not go through the document parser");
      },
      readText: async () => "ERROR at line 42\r\nretrying",
      vision: {
        analyze: async () => {
          throw new Error("no vision for pasted text");
        },
      },
    });
    expect(result.attachments).toEqual([]);
    expect(result.input).toContain("帮我找出报错原因");
    expect(result.input).toContain('<pasted-text name="粘贴内容.txt">\nERROR at line 42\nretrying');
    expect(result.input).toContain("按用户的原话对待");
    expect(result.input).not.toContain('trust="none"');
  });
});
