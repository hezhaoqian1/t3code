import { beforeEach, describe, expect, it } from "vite-plus/test";

import { dispatchQueuedMessage, useSendQueueStore } from "./sendQueueStore";

const item = (id: string) => ({
  id,
  text: id,
  createdAt: id,
  status: undefined as undefined,
  error: undefined as string | undefined,
});

describe("sendQueueStore", () => {
  beforeEach(() => useSendQueueStore.setState({ byThreadKey: {} }));

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
});
