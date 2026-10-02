import { beforeEach, describe, expect, it } from "vite-plus/test";

import { ProviderInstanceId } from "@t3tools/contracts";

import {
  hasPendingAttachmentPreparation,
  isQueuedDispatchAcknowledged,
  isQueuedMessageDue,
  QUEUED_DISPATCH_ACK_TIMEOUT_MS,
  type QueuedMessage,
  resolveQueuedSendNow,
  useSendQueueStore,
} from "./sendQueueStore";

const item = (id: string, update: Partial<QueuedMessage> = {}): QueuedMessage => ({
  id,
  text: id,
  createdAt: id,
  images: [],
  documents: [],
  terminalContexts: [],
  elementContexts: [],
  previewAnnotations: [],
  reviewComments: [],
  sendSettings: {
    modelSelection: { instanceId: ProviderInstanceId.make("fd-deepseek"), model: "fd-model" },
    runtimeMode: "full-access",
    interactionMode: "default",
    nativeSkillNames: [],
  },
  status: undefined,
  error: undefined,
  ...update,
});

const ids = (threadKey: string) =>
  useSendQueueStore.getState().byThreadKey[threadKey]?.map((entry) => entry.id);

describe("sendQueueStore", () => {
  beforeEach(() => useSendQueueStore.setState({ byThreadKey: {}, lastDispatchByThreadKey: {} }));

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

    expect(ids("env-a/thread-a")).toEqual(["two", "one"]);
    expect(useSendQueueStore.getState().byThreadKey["env-b/thread-a"]?.[0]?.id).toBe("other");
  });

  it("removes a message and returns it, but never one already on the wire", () => {
    const store = useSendQueueStore.getState();
    store.enqueue("thread", item("one"));
    store.enqueue("thread", item("two", { status: "sending" }));

    expect(store.remove("thread", "one")?.id).toBe("one");
    expect(store.remove("thread", "two")).toBeNull();
    expect(store.remove("thread", "missing")).toBeNull();
    expect(ids("thread")).toEqual(["two"]);

    store.clearAll();
    expect(useSendQueueStore.getState().byThreadKey).toEqual({});
  });

  it("takes every waiting message back and leaves the one being sent", () => {
    const store = useSendQueueStore.getState();
    store.enqueue("thread", item("one", { status: "sending" }));
    store.enqueue("thread", item("two"));
    store.enqueue("thread", item("three", { status: "failed", error: "发送失败：offline" }));

    expect(store.takeAll("thread").map((entry) => entry.id)).toEqual(["two", "three"]);
    expect(ids("thread")).toEqual(["one"]);
    expect(store.takeAll("thread")).toEqual([]);
  });

  it("drops the thread's entry once its queue is empty", () => {
    const store = useSendQueueStore.getState();
    store.enqueue("thread", item("one"));
    store.update("thread", "one", { status: "sending" });
    expect(useSendQueueStore.getState().byThreadKey.thread?.[0]?.status).toBe("sending");

    store.finish("thread", "one");
    expect("thread" in useSendQueueStore.getState().byThreadKey).toBe(false);
  });

  it("tracks the last dispatch per thread", () => {
    const store = useSendQueueStore.getState();
    const dispatch = { latestTurnId: "turn-1", latestTurnRequestedAt: null, dispatchedAt: 1 };
    store.setLastDispatch("thread", dispatch);
    expect(useSendQueueStore.getState().lastDispatchByThreadKey.thread).toEqual(dispatch);
    store.setLastDispatch("thread", null);
    expect(useSendQueueStore.getState().lastDispatchByThreadKey).toEqual({});
  });

  describe("isQueuedDispatchAcknowledged", () => {
    const dispatch = {
      latestTurnId: "turn-1",
      latestTurnRequestedAt: "2026-10-01T00:00:00.000Z",
      dispatchedAt: 1_000,
    };
    const unchanged = {
      latestTurnId: "turn-1",
      latestTurnRequestedAt: dispatch.latestTurnRequestedAt,
    };

    it("is acknowledged without a dispatch or once the latest turn moved", () => {
      expect(
        isQueuedDispatchAcknowledged({ ...unchanged, dispatch: undefined, nowMs: 1_000 }),
      ).toBe(true);
      expect(isQueuedDispatchAcknowledged({ ...unchanged, dispatch, nowMs: 1_001 })).toBe(false);
      expect(
        isQueuedDispatchAcknowledged({
          ...unchanged,
          latestTurnId: "turn-2",
          dispatch,
          nowMs: 1_001,
        }),
      ).toBe(true);
      expect(
        isQueuedDispatchAcknowledged({
          ...unchanged,
          latestTurnRequestedAt: "2026-10-01T00:00:05.000Z",
          dispatch,
          nowMs: 1_001,
        }),
      ).toBe(true);
    });

    it("stops waiting once the acknowledgement timeout passes", () => {
      expect(
        isQueuedDispatchAcknowledged({
          ...unchanged,
          dispatch,
          nowMs: dispatch.dispatchedAt + QUEUED_DISPATCH_ACK_TIMEOUT_MS - 1,
        }),
      ).toBe(false);
      expect(
        isQueuedDispatchAcknowledged({
          ...unchanged,
          dispatch,
          nowMs: dispatch.dispatchedAt + QUEUED_DISPATCH_ACK_TIMEOUT_MS,
        }),
      ).toBe(true);
    });
  });

  describe("isQueuedMessageDue", () => {
    const due = {
      message: item("one"),
      sessionStatus: "ready",
      hasPendingRequest: false,
      connected: true,
      dispatchAcknowledged: true,
    };

    it("sends once the task is idle and connected", () => {
      expect(isQueuedMessageDue(due)).toBe(true);
      expect(isQueuedMessageDue({ ...due, sessionStatus: null })).toBe(true);
      expect(isQueuedMessageDue({ ...due, sessionStatus: "interrupted" })).toBe(true);
    });

    it("waits while the task works, asks the employee something or is offline", () => {
      expect(isQueuedMessageDue({ ...due, sessionStatus: "running" })).toBe(false);
      expect(isQueuedMessageDue({ ...due, sessionStatus: "starting" })).toBe(false);
      expect(isQueuedMessageDue({ ...due, hasPendingRequest: true })).toBe(false);
      expect(isQueuedMessageDue({ ...due, connected: false })).toBe(false);
      expect(isQueuedMessageDue({ ...due, dispatchAcknowledged: false })).toBe(false);
    });

    it("leaves failed, held and in-flight messages for the employee", () => {
      expect(isQueuedMessageDue({ ...due, message: item("one", { status: "failed" }) })).toBe(
        false,
      );
      expect(isQueuedMessageDue({ ...due, message: item("one", { status: "sending" }) })).toBe(
        false,
      );
      expect(
        isQueuedMessageDue({ ...due, message: item("one", { holdUntilUserAction: true }) }),
      ).toBe(false);
    });
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
