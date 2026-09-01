import { describe, expect, it } from "vite-plus/test";

import {
  MESSAGE_FEEDBACK_MAX_MESSAGES_PER_THREAD,
  MESSAGE_FEEDBACK_MAX_THREADS,
  migratePersistedMessageFeedbackState,
} from "./messageFeedbackStore";

describe("message feedback persistence", () => {
  it("migrates only supported feedback values", () => {
    expect(
      migratePersistedMessageFeedbackState({
        byThreadKey: {
          "env/thread": {
            good: "positive",
            bad: "negative",
            ignored: "neutral",
          },
        },
      }),
    ).toEqual({ byThreadKey: { "env/thread": { good: "positive", bad: "negative" } } });
  });

  it("bounds old persisted data to avoid unbounded local storage growth", () => {
    const byThreadKey: Record<string, Record<string, string>> = {};
    for (let thread = 0; thread < MESSAGE_FEEDBACK_MAX_THREADS + 3; thread += 1) {
      const messages: Record<string, string> = {};
      for (let message = 0; message < MESSAGE_FEEDBACK_MAX_MESSAGES_PER_THREAD + 3; message += 1) {
        messages[`m-${message}`] = "positive";
      }
      byThreadKey[`t-${thread}`] = messages;
    }

    const migrated = migratePersistedMessageFeedbackState({ byThreadKey });
    expect(Object.keys(migrated.byThreadKey)).toHaveLength(MESSAGE_FEEDBACK_MAX_THREADS);
    expect(Object.keys(migrated.byThreadKey["t-102"] ?? {})).toHaveLength(
      MESSAGE_FEEDBACK_MAX_MESSAGES_PER_THREAD,
    );
  });
});
