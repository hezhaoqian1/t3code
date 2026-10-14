// @effect-diagnostics globalTimers:off
import { FdResponsesError } from "../fd-agent/FdResponsesProtocol.ts";
import { visionFailureMessage } from "../fd-vision/FdVisionService.ts";

export interface RecognitionJob {
  readonly label: string;
  readonly bytes: Uint8Array;
  readonly page?: number;
}

export type RecognitionOutcome =
  | { readonly label: string; readonly page?: number; readonly evidence: string }
  | { readonly label: string; readonly page?: number; readonly failure: string };

export const RECOGNITION_CONCURRENCY = 3;
export const RECOGNITION_RETRY_DELAYS_MS = [1_500, 4_000] as const;

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Recognizes page images and image tiles a few at a time. A transient failure
 * is retried; a page that still fails is reported in its outcome instead of
 * discarding every other page. Cancellation stops everything. Outcomes keep
 * the order of `jobs`.
 */
export async function recognizePages(input: {
  readonly jobs: ReadonlyArray<RecognitionJob>;
  readonly analyze: (job: RecognitionJob, signal: AbortSignal) => Promise<string>;
  readonly signal: AbortSignal;
  readonly concurrency?: number;
  readonly retryDelaysMs?: ReadonlyArray<number>;
  readonly onSettled?: (completed: number, total: number) => Promise<void> | void;
}): Promise<ReadonlyArray<RecognitionOutcome>> {
  const outcomes: RecognitionOutcome[] = Array.from({ length: input.jobs.length });
  const retryDelays = input.retryDelaysMs ?? RECOGNITION_RETRY_DELAYS_MS;
  let next = 0;
  let completed = 0;
  const recognize = async (job: RecognitionJob): Promise<RecognitionOutcome> => {
    for (let attempt = 0; ; attempt++) {
      input.signal.throwIfAborted();
      try {
        const evidence = await input.analyze(job, input.signal);
        return { label: job.label, ...(job.page ? { page: job.page } : {}), evidence };
      } catch (error) {
        input.signal.throwIfAborted();
        const retryable = !(error instanceof FdResponsesError) || error.retryable;
        const delay = retryDelays[attempt];
        if (!retryable || delay === undefined) {
          return {
            label: job.label,
            ...(job.page ? { page: job.page } : {}),
            failure: visionFailureMessage(error),
          };
        }
        await abortableDelay(delay, input.signal);
      }
    }
  };
  const worker = async () => {
    while (next < input.jobs.length) {
      const index = next++;
      outcomes[index] = await recognize(input.jobs[index]!);
      completed++;
      await input.onSettled?.(completed, input.jobs.length);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(input.concurrency ?? RECOGNITION_CONCURRENCY, input.jobs.length) },
      worker,
    ),
  );
  return outcomes;
}
