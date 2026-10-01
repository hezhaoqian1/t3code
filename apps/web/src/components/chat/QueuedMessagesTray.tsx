import { memo, useState } from "react";
import {
  ArrowUpIcon,
  ClockIcon,
  CornerDownRightIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";

import type { QueuedMessage } from "../../sendQueueStore";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

interface QueuedMessagesTrayProps {
  messages: ReadonlyArray<QueuedMessage>;
  /** "steer" while a turn runs, "send" once the thread is idle. */
  sendNowAction: "steer" | "send";
  sendNowBlockedReason: string | null;
  editingId: string | null;
  onSendNow: (id: string) => void;
  onEditStart: (id: string) => void;
  onEditCancel: () => void;
  onSave: (id: string, text: string) => void;
  onRemove: (id: string) => void;
}

/**
 * Messages typed while the agent works, docked above the composer. They go
 * out in order once the turn ends; each row can steer the running turn now,
 * be edited, or be removed.
 */
export const QueuedMessagesTray = memo(function QueuedMessagesTray({
  messages,
  sendNowAction,
  sendNowBlockedReason,
  editingId,
  onSendNow,
  onEditStart,
  onEditCancel,
  onSave,
  onRemove,
}: QueuedMessagesTrayProps) {
  if (messages.length === 0) return null;
  const steering = sendNowAction === "steer";
  const hint =
    sendNowBlockedReason ??
    (steering ? "当前任务结束后依次发送，点「引导」可立即插入" : "即将依次发送");

  return (
    <div className="mx-auto mb-1.5 w-full max-w-3xl px-2" data-chat-send-queue="true">
      <div className="rounded-2xl border border-border/70 bg-card/95 py-1 shadow-xs">
        <div className="flex min-w-0 items-center gap-1.5 px-3 pt-1 pb-0.5 text-muted-foreground text-xs">
          <ClockIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="shrink-0 font-medium text-foreground/80">排队中 {messages.length}</span>
          <span className="ml-auto min-w-0 truncate" role="status" title={hint}>
            {hint}
          </span>
        </div>
        <ul className="max-h-48 overflow-y-auto px-1">
          {messages.map((message, index) => {
            const sending = message.status === "sending";
            const failed = message.status === "failed";
            if (message.id === editingId) {
              return (
                <li key={message.id} className="px-2 py-1.5" data-queued-message-id={message.id}>
                  <QueuedMessageEditor
                    message={message}
                    index={index}
                    onSave={onSave}
                    onCancel={onEditCancel}
                  />
                </li>
              );
            }
            const sendLabel = sending
              ? steering
                ? "引导中"
                : "发送中"
              : failed
                ? "重试"
                : steering
                  ? "引导"
                  : "发送";
            const sendTitle =
              sendNowBlockedReason ??
              (steering ? "立即插入当前任务，AI 会在下一步读取这条消息" : "立即作为新消息发送");
            return (
              <li
                key={message.id}
                className="group flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 hover:bg-accent/50"
                data-queued-message-id={message.id}
              >
                <CornerDownRightIcon
                  className="size-3.5 shrink-0 text-muted-foreground/70"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="block w-full truncate text-left text-foreground/90 text-sm leading-6 disabled:cursor-default"
                    title={message.text}
                    disabled={sending}
                    onClick={() => onEditStart(message.id)}
                  >
                    {message.text}
                  </button>
                  {message.error ? (
                    <div className="truncate text-destructive text-xs" title={message.error}>
                      {message.error}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    className="rounded-full px-2.5"
                    disabled={sending || sendNowBlockedReason !== null || !message.text.trim()}
                    title={sendTitle}
                    aria-label={`${sendLabel}排队消息 ${index + 1}`}
                    onClick={() => onSendNow(message.id)}
                  >
                    {sending ? (
                      <Spinner className="size-3.5" aria-hidden />
                    ) : failed ? (
                      <RotateCcwIcon aria-hidden />
                    ) : steering ? (
                      <CornerDownRightIcon aria-hidden />
                    ) : (
                      <ArrowUpIcon aria-hidden />
                    )}
                    {sendLabel}
                  </Button>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    disabled={sending}
                    title="编辑"
                    aria-label={`编辑排队消息 ${index + 1}`}
                    onClick={() => onEditStart(message.id)}
                  >
                    <PencilIcon aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="hover:text-destructive"
                    disabled={sending}
                    title="删除"
                    aria-label={`删除排队消息 ${index + 1}`}
                    onClick={() => onRemove(message.id)}
                  >
                    <Trash2Icon aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
});

function QueuedMessageEditor({
  message,
  index,
  onSave,
  onCancel,
}: {
  message: QueuedMessage;
  index: number;
  onSave: (id: string, text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(message.text);
  const save = () => {
    const trimmed = text.trim();
    if (trimmed) onSave(message.id, trimmed);
  };
  return (
    <div className="min-w-0">
      <textarea
        autoFocus
        aria-label={`编辑排队消息 ${index + 1}`}
        className="field-sizing-content max-h-40 min-h-9 w-full resize-none rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm leading-5 outline-none focus-visible:border-ring"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // Enter confirms an IME candidate; it must not save a half-typed edit.
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            save();
          }
        }}
      />
      <div className="mt-1 flex items-center gap-1">
        <span className="mr-auto text-muted-foreground text-xs">
          Enter 保存 · Shift+Enter 换行 · Esc 取消
        </span>
        <Button type="button" size="xs" variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button type="button" size="xs" disabled={!text.trim()} onClick={save}>
          保存
        </Button>
      </div>
    </div>
  );
}
