import { describe, expect, it } from "@effect/vitest";

import { FdResponsesError, type FdResponsesEvent } from "../fd-agent/FdResponsesProtocol.ts";
import type { FdResponsesStreamer } from "../fd-agent/FdAgentKernel.ts";
import { FD_VISION_LIMITS, FdVisionService } from "./FdVisionService.ts";

const image = {
  type: "input_image" as const,
  image_url: "data:image/png;base64,aGVsbG8=",
};

function streamer(events: ReadonlyArray<FdResponsesEvent>): FdResponsesStreamer {
  return {
    stream: async function* (request) {
      expect(request.model).toBe("deepseek-v4-flash-vision-exp");
      expect(request.round).toBe(1);
      expect(request.input[0]).toMatchObject({ role: "user" });
      yield* events;
    },
  };
}

describe("FdVisionService", () => {
  it("returns bounded visual evidence without exposing the original image to callers", async () => {
    const service = new FdVisionService(
      streamer([
        { type: "text-delta", text: "表格中有三行数据。" },
        { type: "completed", finishReason: "stop" },
      ]),
    );

    await expect(service.analyze({ images: [image], userPrompt: "请看这张图" })).resolves.toBe(
      "表格中有三行数据。",
    );
  });

  it("rejects an empty result and more images than the protocol budget", async () => {
    const service = new FdVisionService(streamer([{ type: "completed", finishReason: "stop" }]));
    await expect(service.analyze({ images: [] })).rejects.toBeInstanceOf(FdResponsesError);
    await expect(
      service.analyze({
        images: Array.from({ length: FD_VISION_LIMITS.maxImages + 1 }, () => image),
      }),
    ).rejects.toBeInstanceOf(FdResponsesError);
  });
});
