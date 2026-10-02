import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  isQueuedDispatchAcknowledged,
  isQueuedMessageDue,
  QUEUED_DISPATCH_ACK_TIMEOUT_MS,
  useSendQueueStore,
} from "../sendQueueStore";
import { useThreadShell } from "../state/entities";
import { useEnvironment } from "../state/environments";
import { sendQueuedMessage } from "./chat/sendQueuedMessage";

/**
 * Sends queued messages when they are due, for every task with a queue,
 * whether or not the task is on screen. Mounted once at the root.
 */
export function QueuedMessageSender() {
  const threadKeys = useSendQueueStore(useShallow((state) => Object.keys(state.byThreadKey)));
  return threadKeys.map((threadKey) => <ThreadQueueSender key={threadKey} threadKey={threadKey} />);
}

/**
 * Watches one task while it has queued messages. The shell carries the
 * session state and pending requests, so this works while the employee looks
 * at another task.
 */
function ThreadQueueSender({ threadKey }: { threadKey: string }) {
  const threadRef = useMemo(() => parseScopedThreadKey(threadKey), [threadKey]);
  const shell = useThreadShell(threadRef);
  const environment = useEnvironment(threadRef?.environmentId ?? null);
  const head = useSendQueueStore((state) => state.byThreadKey[threadKey]?.[0]);
  const sending = useSendQueueStore(
    (state) =>
      state.byThreadKey[threadKey]?.some((message) => message.status === "sending") ?? false,
  );
  const lastDispatch = useSendQueueStore((state) => state.lastDispatchByThreadKey[threadKey]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const latestTurnId = shell?.latestTurn?.turnId ?? null;
  const latestTurnRequestedAt = shell?.latestTurn?.requestedAt ?? null;
  const dispatchAcknowledged = isQueuedDispatchAcknowledged({
    dispatch: lastDispatch,
    latestTurnId,
    latestTurnRequestedAt,
    nowMs,
  });

  // An unacknowledged dispatch re-checks once its timeout passes, so a lost
  // acknowledgement cannot stall the queue.
  useEffect(() => {
    if (!lastDispatch || dispatchAcknowledged) return;
    const remaining = lastDispatch.dispatchedAt + QUEUED_DISPATCH_ACK_TIMEOUT_MS - Date.now();
    const timer = setTimeout(() => setNowMs(Date.now()), Math.max(0, remaining) + 50);
    return () => clearTimeout(timer);
  }, [dispatchAcknowledged, lastDispatch]);

  const due =
    threadRef !== null &&
    shell !== null &&
    head !== undefined &&
    !sending &&
    isQueuedMessageDue({
      message: head,
      sessionStatus: shell.session?.status ?? null,
      hasPendingRequest: shell.hasPendingApprovals || shell.hasPendingUserInput,
      connected: environment?.connection.phase === "connected",
      dispatchAcknowledged,
    });
  const headId = head?.id;
  useEffect(() => {
    if (!due || !threadRef || headId === undefined) return;
    void sendQueuedMessage(threadRef, headId);
  }, [due, headId, threadRef]);
  return null;
}
