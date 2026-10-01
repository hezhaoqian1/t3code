import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { QueuedMessage } from "../../sendQueueStore";
import { QueuedMessagesTray } from "./QueuedMessagesTray";

const message = (id: string, update: Partial<QueuedMessage> = {}): QueuedMessage => ({
  id,
  text: `message ${id}`,
  createdAt: "2026-10-01T00:00:00.000Z",
  status: undefined,
  error: undefined,
  ...update,
});

const noop = () => {};

function render(input: {
  messages: QueuedMessage[];
  sendNowAction?: "steer" | "send";
  sendNowBlockedReason?: string | null;
  editingId?: string | null;
}) {
  return renderToStaticMarkup(
    <QueuedMessagesTray
      messages={input.messages}
      sendNowAction={input.sendNowAction ?? "steer"}
      sendNowBlockedReason={input.sendNowBlockedReason ?? null}
      editingId={input.editingId ?? null}
      onSendNow={noop}
      onEditStart={noop}
      onEditCancel={noop}
      onSave={noop}
      onRemove={noop}
    />,
  );
}

/** Whether the button with this aria-label renders the disabled attribute. */
function isDisabled(markup: string, label: string): boolean {
  const match = markup.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`));
  if (!match) throw new Error(`No button labelled ${label}`);
  return /\sdisabled=""/.test(match[0]);
}

describe("QueuedMessagesTray", () => {
  it("renders nothing without queued messages", () => {
    expect(render({ messages: [] })).toBe("");
  });

  it("offers an enabled steer for every queued message while a turn runs", () => {
    const markup = render({ messages: [message("a"), message("b")] });

    expect(markup).toContain("排队中 2");
    expect(markup).toContain("点「引导」可立即插入");
    expect(isDisabled(markup, "引导排队消息 1")).toBe(false);
    expect(isDisabled(markup, "引导排队消息 2")).toBe(false);
  });

  it("disables steering and shows why while it is held", () => {
    const markup = render({
      messages: [message("a")],
      sendNowBlockedReason: "附件处理中，完成后可引导",
    });

    expect(markup).toContain("附件处理中，完成后可引导");
    expect(isDisabled(markup, "引导排队消息 1")).toBe(true);
  });

  it("shows progress and failure states", () => {
    const markup = render({
      messages: [
        message("a", { status: "sending" }),
        message("b", { status: "failed", error: "引导失败，请重试。" }),
      ],
      sendNowAction: "send",
    });

    expect(markup).toContain("发送中");
    expect(isDisabled(markup, "删除排队消息 1")).toBe(true);
    expect(markup).toContain("引导失败，请重试。");
    expect(isDisabled(markup, "重试排队消息 2")).toBe(false);
  });

  it("edits a message in place", () => {
    const markup = render({ messages: [message("a"), message("b")], editingId: "b" });

    expect(markup).toMatch(/<textarea[^>]*aria-label="编辑排队消息 2"/);
    expect(markup).toContain("message b</textarea>");
    expect(markup).toContain("Esc 取消");
  });
});
