/**
 * Shared rules for "rewind the conversation to before a user message".
 *
 * A rewind names the user message it rewinds to (the anchor) and the provider
 * turns that started at or after it. The server event store, the server read
 * model and every client apply the same rules, so a rewind removes exactly the
 * same messages, activities and plans everywhere. Checkpoints are not needed:
 * app-created task folders are not Git repositories and have none.
 */

export interface ConversationRewindAnchor {
  /** The user message the thread rewinds to before. It is removed too. */
  readonly messageId: string;
  /** That message's creation time; turn-less entries created later are removed. */
  readonly messageCreatedAt: string;
  /** Provider turns that started at or after the anchor. */
  readonly removedTurnIds: ReadonlySet<string>;
}

/** Reads the anchor from a `thread.reverted` payload, or null for a checkpoint-only revert. */
export function conversationRewindAnchor(payload: {
  readonly messageId?: string | undefined;
  readonly messageCreatedAt?: string | undefined;
  readonly removedTurnIds?: ReadonlyArray<string> | undefined;
}): ConversationRewindAnchor | null {
  if (payload.messageId === undefined || payload.messageCreatedAt === undefined) {
    return null;
  }
  return {
    messageId: payload.messageId,
    messageCreatedAt: payload.messageCreatedAt,
    removedTurnIds: new Set(payload.removedTurnIds ?? []),
  };
}

/**
 * Orders two ISO timestamps. Providers and the server format them slightly
 * differently (with or without milliseconds), so compare instants rather than
 * strings when both parse.
 */
export function compareIsoTimestamps(left: string, right: string): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime < rightTime ? -1 : 1;
  }
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return 0;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Whether an activity, plan or other turn-scoped entry leaves the thread. An
 * entry of a removed turn goes; an entry of a kept turn stays even if it was
 * written late; a turn-less entry goes when it was created after the anchor.
 */
export function isTurnEntryRemovedByRewind(
  entry: { readonly turnId: string | null; readonly createdAt: string },
  anchor: ConversationRewindAnchor,
): boolean {
  if (entry.turnId !== null) {
    return anchor.removedTurnIds.has(entry.turnId);
  }
  return compareIsoTimestamps(entry.createdAt, anchor.messageCreatedAt) > 0;
}

/**
 * Whether a message leaves the thread. Thinking traces (`reasoning`) go with
 * their turn like answers do. Thread-level system messages stay; a system
 * message bound to a removed turn goes, which covers thinking traces sent to
 * clients that predate the reasoning role.
 */
export function isMessageRemovedByRewind(
  message: {
    readonly id: string;
    readonly role: string;
    readonly turnId: string | null;
    readonly createdAt: string;
  },
  anchor: ConversationRewindAnchor,
): boolean {
  if (message.id === anchor.messageId) {
    return true;
  }
  if (message.role === "system") {
    return message.turnId !== null && anchor.removedTurnIds.has(message.turnId);
  }
  return isTurnEntryRemovedByRewind(message, anchor);
}

/**
 * FD Skill (enterprise) answers keep their history on the enterprise service
 * and carry ids with this prefix. That history cannot be rewound locally.
 */
const FD_ENTERPRISE_HISTORY_MESSAGE_ID_PREFIX = "fd-enterprise-history:";

export function isFdEnterpriseHistoryMessageId(messageId: string): boolean {
  return messageId.startsWith(FD_ENTERPRISE_HISTORY_MESSAGE_ID_PREFIX);
}
