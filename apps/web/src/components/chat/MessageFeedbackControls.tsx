import type { DesktopMessageFeedbackInput, EnvironmentId } from "@t3tools/contracts";
import { memo, useRef, useState } from "react";
import { ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";

import type { MessageFeedback } from "../../messageFeedbackStore";
import { useMessageFeedbackStore } from "../../messageFeedbackStore";
import { desktopMessageFeedbackCommand } from "../../state/messageFeedback";
import { useAtomCommand } from "../../state/use-atom-command";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { anchoredToastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { submitMessageFeedback } from "./messageFeedbackSubmission";

function showFeedbackToast(anchor: HTMLButtonElement | null, title: string) {
  if (!anchor) return;
  anchoredToastManager.add({
    data: { tooltipStyle: true },
    positionerProps: { anchor },
    timeout: 1100,
    title,
  });
}

function toDesktopRating(feedback: MessageFeedback | null): DesktopMessageFeedbackInput["rating"] {
  return feedback === "positive" ? "like" : feedback === "negative" ? "dislike" : null;
}

export const MessageFeedbackControls = memo(function MessageFeedbackControls({
  environmentId,
  threadKey,
  clientThreadId,
  messageId,
  userInput,
  assistantOutput,
}: {
  environmentId: EnvironmentId;
  threadKey: string;
  clientThreadId: string;
  messageId: string;
  userInput: string;
  assistantOutput: string;
}) {
  const feedback = useMessageFeedbackStore(
    (state) => state.byThreadKey[threadKey]?.[messageId] ?? null,
  );
  const setFeedback = useMessageFeedbackStore((state) => state.setFeedback);
  const submitFeedback = useAtomCommand(desktopMessageFeedbackCommand, {
    reportFailure: false,
    reportDefect: false,
  });
  const [pendingFeedback, setPendingFeedback] = useState<MessageFeedback | null | undefined>();
  const displayedFeedback = pendingFeedback === undefined ? feedback : pendingFeedback;
  const positiveRef = useRef<HTMLButtonElement>(null);
  const negativeRef = useRef<HTMLButtonElement>(null);

  const updateFeedback = (next: MessageFeedback, anchor: HTMLButtonElement | null) => {
    const enterpriseIds = /^fd-enterprise-history:(\d+):(\d+)$/.exec(messageId);

    return submitMessageFeedback({
      currentFeedback: feedback,
      requestedFeedback: next,
      input: (nextFeedback) => ({
        environmentId,
        input: {
          clientThreadId,
          clientMessageId: messageId,
          rating: toDesktopRating(nextFeedback),
          userInput,
          assistantOutput,
          model: "",
          requestId: messageId,
          ...(enterpriseIds
            ? {
                enterpriseConversationId: Number(enterpriseIds[1]),
                enterpriseMessageId: Number(enterpriseIds[2]),
              }
            : {}),
        },
      }),
      submit: submitFeedback,
      onPendingFeedbackChange: setPendingFeedback,
      onConfirmed: (nextFeedback) => setFeedback(threadKey, messageId, nextFeedback),
      onSuccess: (nextFeedback) =>
        showFeedbackToast(anchor, nextFeedback === null ? "已取消反馈" : "感谢你的反馈"),
    });
  };

  return (
    <div
      className="flex shrink-0 items-center gap-0.5"
      data-message-feedback={displayedFeedback ?? "none"}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              ref={positiveRef}
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="回答有帮助"
              aria-pressed={displayedFeedback === "positive"}
              disabled={pendingFeedback !== undefined}
              className={cn(
                "text-muted-foreground hover:text-foreground",
                displayedFeedback === "positive" &&
                  "bg-accent text-primary hover:bg-accent hover:text-primary",
              )}
              onClick={() => void updateFeedback("positive", positiveRef.current)}
            />
          }
        >
          <ThumbsUpIcon className="size-3" />
        </TooltipTrigger>
        <TooltipPopup side="top">回答有帮助</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              ref={negativeRef}
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="回答需要改进"
              aria-pressed={displayedFeedback === "negative"}
              disabled={pendingFeedback !== undefined}
              className={cn(
                "text-muted-foreground hover:text-foreground",
                displayedFeedback === "negative" &&
                  "bg-accent text-destructive hover:bg-accent hover:text-destructive",
              )}
              onClick={() => void updateFeedback("negative", negativeRef.current)}
            />
          }
        >
          <ThumbsDownIcon className="size-3" />
        </TooltipTrigger>
        <TooltipPopup side="top">回答需要改进</TooltipPopup>
      </Tooltip>
    </div>
  );
});
