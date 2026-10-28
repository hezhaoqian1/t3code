import type { CheckpointRef, MessageId, OrchestrationThread, TurnId } from "@t3tools/contracts";
import {
  compareIsoTimestamps,
  isFdEnterpriseHistoryMessageId,
  isMessageRemovedByRewind,
} from "@t3tools/shared/conversationRewind";

/** The parts of a projected turn row a rewind plan reads. */
export interface ConversationRewindTurnRow {
  readonly turnId: TurnId | null;
  readonly pendingMessageId: MessageId | null;
  readonly requestedAt: string;
  readonly checkpointTurnCount: number | null;
}

export type ConversationRewindRejection = "message-not-found" | "not-user-message" | "fd-skill";

export type ConversationRewindPlan =
  | {
      readonly _tag: "Planned";
      readonly messageId: MessageId;
      readonly messageCreatedAt: string;
      /** Turns that started at or after the anchor, oldest first. */
      readonly removedTurnIds: ReadonlyArray<TurnId>;
      /** Highest checkpoint count that survives the rewind (0 without checkpoints). */
      readonly retainedCheckpointTurnCount: number;
      readonly staleCheckpointRefs: ReadonlyArray<CheckpointRef>;
    }
  | {
      readonly _tag: "Rejected";
      readonly reason: ConversationRewindRejection;
    };

/**
 * Plans a rewind to before one user message. Turns are matched by when they
 * were requested, not by checkpoint numbers, so threads in folders without Git
 * (and so without checkpoints) can be rewound too.
 *
 * `maxCheckpointTurnCount` is set when files are restored as well: turns whose
 * checkpoint lies past the restored checkpoint leave the conversation with it.
 */
export function planConversationRewind(input: {
  readonly thread: Pick<
    OrchestrationThread,
    "messages" | "activities" | "proposedPlans" | "checkpoints"
  >;
  readonly turns: ReadonlyArray<ConversationRewindTurnRow>;
  readonly messageId: MessageId;
  readonly maxCheckpointTurnCount?: number;
}): ConversationRewindPlan {
  const anchor = input.thread.messages.find((message) => message.id === input.messageId);
  if (!anchor) {
    return { _tag: "Rejected", reason: "message-not-found" };
  }
  if (isFdEnterpriseHistoryMessageId(anchor.id)) {
    return { _tag: "Rejected", reason: "fd-skill" };
  }
  if (anchor.role !== "user") {
    return { _tag: "Rejected", reason: "not-user-message" };
  }
  const cutoff = anchor.createdAt;
  const exceedsCheckpoint = (checkpointTurnCount: number | null) =>
    input.maxCheckpointTurnCount !== undefined &&
    checkpointTurnCount !== null &&
    checkpointTurnCount > input.maxCheckpointTurnCount;

  // Turns requested before the anchor stay, even when something of theirs was
  // written after it (a late activity, or a message steered into a running turn).
  const keptTurnIds = new Set<TurnId>();
  const removedAt = new Map<TurnId, string>();
  const markRemoved = (turnId: TurnId, at: string) => {
    const previous = removedAt.get(turnId);
    if (previous === undefined || compareIsoTimestamps(at, previous) < 0) {
      removedAt.set(turnId, at);
    }
  };
  for (const turn of input.turns) {
    if (turn.turnId === null) continue;
    const kept =
      compareIsoTimestamps(turn.requestedAt, cutoff) < 0 &&
      turn.pendingMessageId !== anchor.id &&
      !exceedsCheckpoint(turn.checkpointTurnCount);
    if (kept) keptTurnIds.add(turn.turnId);
    else markRemoved(turn.turnId, turn.requestedAt);
  }
  // Entries of turns the projection never recorded fall on the side of the
  // anchor they were written on.
  const markUnknownAfterCutoff = (turnId: TurnId | null, createdAt: string) => {
    if (turnId === null || keptTurnIds.has(turnId)) return;
    if (compareIsoTimestamps(createdAt, cutoff) > 0) markRemoved(turnId, createdAt);
  };
  for (const message of input.thread.messages) {
    markUnknownAfterCutoff(message.turnId, message.createdAt);
  }
  for (const activity of input.thread.activities) {
    markUnknownAfterCutoff(activity.turnId, activity.createdAt);
  }
  for (const plan of input.thread.proposedPlans) {
    markUnknownAfterCutoff(plan.turnId, plan.createdAt);
  }
  for (const checkpoint of input.thread.checkpoints) {
    if (keptTurnIds.has(checkpoint.turnId)) continue;
    if (
      exceedsCheckpoint(checkpoint.checkpointTurnCount) ||
      compareIsoTimestamps(checkpoint.completedAt, cutoff) > 0
    ) {
      markRemoved(checkpoint.turnId, checkpoint.completedAt);
    }
  }

  const removedTurnIds = [...removedAt.entries()]
    .toSorted(
      ([leftId, leftAt], [rightId, rightAt]) =>
        compareIsoTimestamps(leftAt, rightAt) || leftId.localeCompare(rightId),
    )
    .map(([turnId]) => turnId);
  const removedTurnIdSet = new Set<string>(removedTurnIds);
  const rewindAnchor = {
    messageId: anchor.id,
    messageCreatedAt: cutoff,
    removedTurnIds: removedTurnIdSet,
  };
  // FD Skill answers live on the enterprise service; rewinding past them would
  // leave that history (and the Skill's own model context) out of step.
  if (
    input.thread.messages.some(
      (message) =>
        isFdEnterpriseHistoryMessageId(message.id) &&
        isMessageRemovedByRewind(message, rewindAnchor),
    )
  ) {
    return { _tag: "Rejected", reason: "fd-skill" };
  }

  let retainedCheckpointTurnCount = 0;
  const staleCheckpointRefs: Array<CheckpointRef> = [];
  for (const checkpoint of input.thread.checkpoints) {
    if (
      removedTurnIdSet.has(checkpoint.turnId) ||
      exceedsCheckpoint(checkpoint.checkpointTurnCount)
    ) {
      staleCheckpointRefs.push(checkpoint.checkpointRef);
    } else {
      retainedCheckpointTurnCount = Math.max(
        retainedCheckpointTurnCount,
        checkpoint.checkpointTurnCount,
      );
    }
  }

  return {
    _tag: "Planned",
    messageId: anchor.id,
    messageCreatedAt: cutoff,
    removedTurnIds,
    retainedCheckpointTurnCount,
    staleCheckpointRefs,
  };
}
