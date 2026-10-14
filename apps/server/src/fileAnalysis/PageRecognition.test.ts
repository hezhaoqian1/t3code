import { describe, expect, it } from "vite-plus/test";
import { FdResponsesError } from "../fd-agent/FdResponsesProtocol.ts";
import { recognizePages, type RecognitionJob } from "./PageRecognition.ts";

const jobs = (count: number): RecognitionJob[] =>
  Array.from({ length: count }, (_, index) => ({
    label: `第 ${index + 1} 页`,
    page: index + 1,
    bytes: new Uint8Array([index]),
  }));

describe("recognizePages", () => {
  it("runs a few pages at a time and keeps the original order", async () => {
    let active = 0;
    let peak = 0;
    const outcomes = await recognizePages({
      jobs: jobs(7),
      signal: new AbortController().signal,
      concurrency: 3,
      analyze: async (job) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setImmediate(resolve));
        active--;
        return `text of ${job.page}`;
      },
    });
    expect(peak).toBe(3);
    expect(outcomes.map((outcome) => ("evidence" in outcome ? outcome.evidence : ""))).toEqual(
      Array.from({ length: 7 }, (_, index) => `text of ${index + 1}`),
    );
  });

  it("retries a transient failure and reports a page that keeps failing without losing the rest", async () => {
    const attempts = new Map<number, number>();
    const outcomes = await recognizePages({
      jobs: jobs(3),
      signal: new AbortController().signal,
      retryDelaysMs: [0, 0],
      analyze: async (job) => {
        const count = (attempts.get(job.page!) ?? 0) + 1;
        attempts.set(job.page!, count);
        if (job.page === 1 && count === 1) throw new FdResponsesError("network_error");
        if (job.page === 2) throw new FdResponsesError("timeout");
        return `ok ${job.page}`;
      },
    });
    expect(attempts.get(1)).toBe(2);
    expect(attempts.get(2)).toBe(3);
    expect(outcomes[0]).toMatchObject({ page: 1, evidence: "ok 1" });
    expect(outcomes[1]).toMatchObject({ page: 2, failure: expect.stringContaining("超时") });
    expect(outcomes[2]).toMatchObject({ page: 3, evidence: "ok 3" });
  });

  it("does not retry an authorization failure", async () => {
    let calls = 0;
    const [outcome] = await recognizePages({
      jobs: jobs(1),
      signal: new AbortController().signal,
      retryDelaysMs: [0, 0],
      analyze: async () => {
        calls++;
        throw new FdResponsesError("forbidden");
      },
    });
    expect(calls).toBe(1);
    expect(outcome).toMatchObject({ failure: expect.stringContaining("授权") });
  });

  it("stops every page when the turn is cancelled", async () => {
    const controller = new AbortController();
    let calls = 0;
    await expect(
      recognizePages({
        jobs: jobs(5),
        signal: controller.signal,
        concurrency: 1,
        analyze: async () => {
          calls++;
          controller.abort();
          return "text";
        },
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
