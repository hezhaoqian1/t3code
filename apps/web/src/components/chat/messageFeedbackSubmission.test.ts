import { AsyncResult } from "effect/unstable/reactivity";
import * as Cause from "effect/Cause";
import { describe, expect, it, vi } from "vite-plus/test";

import { submitMessageFeedback } from "./messageFeedbackSubmission";

describe("submitMessageFeedback", () => {
  it("confirms feedback and reports success after submission", async () => {
    const onPendingFeedbackChange = vi.fn();
    const onConfirmed = vi.fn();
    const onSuccess = vi.fn();

    await submitMessageFeedback({
      currentFeedback: null,
      requestedFeedback: "positive",
      input: (feedback) => ({ feedback }),
      submit: vi.fn().mockResolvedValue(AsyncResult.success(undefined)),
      onPendingFeedbackChange,
      onConfirmed,
      onSuccess,
    });

    expect(onPendingFeedbackChange.mock.calls).toEqual([["positive"], [undefined]]);
    expect(onConfirmed).toHaveBeenCalledWith("positive");
    expect(onSuccess).toHaveBeenCalledWith("positive");
  });

  it("silently rolls back optimistic feedback when submission fails", async () => {
    const onPendingFeedbackChange = vi.fn();
    const onConfirmed = vi.fn();
    const onSuccess = vi.fn();

    await submitMessageFeedback({
      currentFeedback: null,
      requestedFeedback: "negative",
      input: (feedback) => ({ feedback }),
      submit: vi
        .fn()
        .mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("network unavailable")))),
      onPendingFeedbackChange,
      onConfirmed,
      onSuccess,
    });

    expect(onPendingFeedbackChange.mock.calls).toEqual([["negative"], [undefined]]);
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("silently rolls back optimistic feedback when submission rejects", async () => {
    const onPendingFeedbackChange = vi.fn();
    const onConfirmed = vi.fn();
    const onSuccess = vi.fn();

    await expect(
      submitMessageFeedback({
        currentFeedback: null,
        requestedFeedback: "positive",
        input: (feedback) => ({ feedback }),
        submit: vi.fn().mockRejectedValue(new Error("connection closed")),
        onPendingFeedbackChange,
        onConfirmed,
        onSuccess,
      }),
    ).resolves.toBeUndefined();

    expect(onPendingFeedbackChange.mock.calls).toEqual([["positive"], [undefined]]);
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("turns the active rating into a cancellation", async () => {
    const onConfirmed = vi.fn();

    await submitMessageFeedback({
      currentFeedback: "positive",
      requestedFeedback: "positive",
      input: (feedback) => ({ feedback }),
      submit: vi.fn().mockResolvedValue(AsyncResult.success(undefined)),
      onPendingFeedbackChange: vi.fn(),
      onConfirmed,
      onSuccess: vi.fn(),
    });

    expect(onConfirmed).toHaveBeenCalledWith(null);
  });
});
