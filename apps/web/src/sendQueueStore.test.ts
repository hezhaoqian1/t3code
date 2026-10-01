import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  dispatchQueuedMessage,
  hasPendingAttachmentPreparation,
  resolveQueuedSendNow,
  useSendQueueStore,
} from "./sendQueueStore";

const item = (id: string) => ({
  id,
  text: id,
  createdAt: id,
  status: undefined as undefined,
  error: undefined as string | undefined,
});

describe("sendQueueStore", () => {
  beforeEach(() => useSendQueueStore.setState({ byThreadKey: {} }));

  it("treats attachment preparation as active until its task completes", () => {
    const base = {
      id: "activity-1",
      tone: "info",
      summary: "attachment",
      turnId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    } as const;
    expect(
      hasPendingAttachmentPreparation([
        { ...base, kind: "task.started", payload: { taskId: "attachments-1" } },
      ] as never),
    ).toBe(true);
    expect(
      hasPendingAttachmentPreparation([
        { ...base, kind: "task.started", payload: { taskId: "attachments-1" } },
        { ...base, id: "activity-2", kind: "task.completed", payload: { taskId: "attachments-1" } },
      ] as never),
    ).toBe(false);
  });

  it("keeps messages by scoped thread and promotes an item without losing FIFO order", () => {
    const store = useSendQueueStore.getState();
    store.enqueue("env-a/thread-a", item("one"));
    store.enqueue("env-a/thread-a", item("two"));
    store.enqueue("env-b/thread-a", item("other"));

    store.promote("env-a/thread-a", "two");

    expect(
      useSendQueueStore.getState().byThreadKey["env-a/thread-a"]?.map((item) => item.id),
    ).toEqual(["two", "one"]);
    expect(useSendQueueStore.getState().byThreadKey["env-b/thread-a"]?.[0]?.id).toBe("other");
  });

  it("removes only after a successful dispatch and can clear account state", () => {
    const store = useSendQueueStore.getState();
    store.enqueue("thread", item("one"));
    store.enqueue("thread", item("two"));
    store.remove("thread", "one");
    expect(useSendQueueStore.getState().byThreadKey.thread?.map((item) => item.id)).toEqual([
      "two",
    ]);

    store.clearAll();
    expect(useSendQueueStore.getState().byThreadKey).toEqual({});
  });

  it("retains a failed message and removes it only after dispatch succeeds", async () => {
    useSendQueueStore.getState().enqueue("thread", item("one"));
    await dispatchQueuedMessage("thread", "one", async () => {
      throw new Error("offline");
    });
    expect(useSendQueueStore.getState().byThreadKey.thread?.[0]?.status).toBe("failed");

    await dispatchQueuedMessage("thread", "one", async () => undefined);
    expect(useSendQueueStore.getState().byThreadKey.thread).toEqual([]);
  });

  describe("resolveQueuedSendNow", () => {
    const idle = {
      phase: "ready" as const,
      isPreparingAttachments: false,
      hasPendingRequest: false,
      isUnavailable: false,
      isStartingTurn: false,
      queueSending: false,
    };

    it("steers a running turn instead of only reordering the queue", () => {
      expect(resolveQueuedSendNow({ ...idle, phase: "running" })).toEqual({
        action: "steer",
        blockedReason: null,
      });
      // A running turn always looks busy locally; that must not block the steer.
      expect(resolveQueuedSendNow({ ...idle, phase: "running", isStartingTurn: true })).toEqual({
        action: "steer",
        blockedReason: null,
      });
    });

    it("sends as the next turn once the thread is idle", () => {
      expect(resolveQueuedSendNow(idle)).toEqual({ action: "send", blockedReason: null });
      expect(resolveQueuedSendNow({ ...idle, isStartingTurn: true }).blockedReason).toBe(
        "任务正在启动",
      );
    });

    it("explains every state that holds a steer", () => {
      const running = { ...idle, phase: "running" as const };
      expect(resolveQueuedSendNow({ ...running, isPreparingAttachments: true })).toEqual({
        action: "steer",
        blockedReason: "附件处理中，完成后可引导",
      });
      expect(resolveQueuedSendNow({ ...running, hasPendingRequest: true }).blockedReason).toBe(
        "请先处理当前的授权或问题",
      );
      expect(resolveQueuedSendNow({ ...running, isUnavailable: true }).blockedReason).toBe(
        "正在连接本地服务",
      );
      expect(resolveQueuedSendNow({ ...running, queueSending: true }).blockedReason).toBe(
        "正在发送上一条排队消息",
      );
    });
  });
});
