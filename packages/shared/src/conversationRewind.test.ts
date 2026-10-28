import { describe, expect, it } from "vite-plus/test";

import {
  compareIsoTimestamps,
  conversationRewindAnchor,
  isFdEnterpriseHistoryMessageId,
  isMessageRemovedByRewind,
  isTurnEntryRemovedByRewind,
} from "./conversationRewind.ts";

const anchor = conversationRewindAnchor({
  messageId: "user-2",
  messageCreatedAt: "2026-10-01T02:00:00.000Z",
  removedTurnIds: ["turn-2"],
})!;

describe("conversation rewind rules", () => {
  it("is a checkpoint-only revert without an anchor", () => {
    expect(conversationRewindAnchor({})).toBeNull();
    expect(conversationRewindAnchor({ messageId: "user-2" })).toBeNull();
  });

  it("removes the anchor, later turn-less messages and messages of removed turns", () => {
    const at = "2026-10-01T03:00:00.000Z";
    expect(
      isMessageRemovedByRewind(
        { id: "user-2", role: "user", turnId: null, createdAt: "2026-10-01T02:00:00.000Z" },
        anchor,
      ),
    ).toBe(true);
    expect(
      isMessageRemovedByRewind({ id: "user-3", role: "user", turnId: null, createdAt: at }, anchor),
    ).toBe(true);
    expect(
      isMessageRemovedByRewind(
        { id: "assistant-2", role: "assistant", turnId: "turn-2", createdAt: at },
        anchor,
      ),
    ).toBe(true);
    expect(
      isMessageRemovedByRewind(
        { id: "assistant-1", role: "assistant", turnId: "turn-1", createdAt: at },
        anchor,
      ),
    ).toBe(false);
    expect(
      isMessageRemovedByRewind(
        { id: "user-1", role: "user", turnId: null, createdAt: "2026-10-01T01:00:00.000Z" },
        anchor,
      ),
    ).toBe(false);
    expect(
      isMessageRemovedByRewind(
        { id: "system", role: "system", turnId: null, createdAt: at },
        anchor,
      ),
    ).toBe(false);
  });

  it("treats turn-less entries by time and turn entries by turn", () => {
    expect(
      isTurnEntryRemovedByRewind({ turnId: null, createdAt: "2026-10-01T02:00:01Z" }, anchor),
    ).toBe(true);
    expect(
      isTurnEntryRemovedByRewind({ turnId: null, createdAt: "2026-10-01T01:59:59Z" }, anchor),
    ).toBe(false);
    expect(
      isTurnEntryRemovedByRewind({ turnId: "turn-1", createdAt: "2026-10-01T09:00:00Z" }, anchor),
    ).toBe(false);
  });

  it("compares timestamps written with and without milliseconds", () => {
    expect(compareIsoTimestamps("2026-10-01T02:00:00Z", "2026-10-01T02:00:00.000Z")).toBe(0);
    expect(compareIsoTimestamps("2026-10-01T02:00:00Z", "2026-10-01T02:00:00.001Z")).toBe(-1);
    expect(compareIsoTimestamps("2026-10-01T02:00:01Z", "2026-10-01T02:00:00.999Z")).toBe(1);
  });

  it("recognizes FD Skill history messages", () => {
    expect(isFdEnterpriseHistoryMessageId("fd-enterprise-history:7:20")).toBe(true);
    expect(isFdEnterpriseHistoryMessageId("user-2")).toBe(false);
  });
});
