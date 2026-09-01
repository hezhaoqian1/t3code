import { memo, useRef } from "react";
import { ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";

import type { MessageFeedback } from "../../messageFeedbackStore";
import { useMessageFeedbackStore } from "../../messageFeedbackStore";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { anchoredToastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function showFeedbackToast(anchor: HTMLButtonElement | null, title: string) {
  if (!anchor) return;
  anchoredToastManager.add({
    data: { tooltipStyle: true },
    positionerProps: { anchor },
    timeout: 1100,
    title,
  });
}

export const MessageFeedbackControls = memo(function MessageFeedbackControls({
  threadKey,
  messageId,
}: {
  threadKey: string;
  messageId: string;
}) {
  const feedback = useMessageFeedbackStore(
    (state) => state.byThreadKey[threadKey]?.[messageId] ?? null,
  );
  const setFeedback = useMessageFeedbackStore((state) => state.setFeedback);
  const positiveRef = useRef<HTMLButtonElement>(null);
  const negativeRef = useRef<HTMLButtonElement>(null);

  const updateFeedback = (next: MessageFeedback, anchor: HTMLButtonElement | null) => {
    try {
      const nextFeedback = feedback === next ? null : next;
      setFeedback(threadKey, messageId, nextFeedback);
      showFeedbackToast(anchor, nextFeedback === null ? "已取消反馈" : "感谢你的反馈");
    } catch {
      showFeedbackToast(anchor, "反馈暂时无法保存");
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-0.5" data-message-feedback={feedback ?? "none"}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              ref={positiveRef}
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="回答有帮助"
              aria-pressed={feedback === "positive"}
              className={cn(
                "text-muted-foreground hover:text-foreground",
                feedback === "positive" &&
                  "bg-accent text-primary hover:bg-accent hover:text-primary",
              )}
              onClick={() => updateFeedback("positive", positiveRef.current)}
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
              aria-pressed={feedback === "negative"}
              className={cn(
                "text-muted-foreground hover:text-foreground",
                feedback === "negative" &&
                  "bg-accent text-destructive hover:bg-accent hover:text-destructive",
              )}
              onClick={() => updateFeedback("negative", negativeRef.current)}
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
