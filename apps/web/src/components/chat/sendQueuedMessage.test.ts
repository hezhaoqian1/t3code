import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  commands: {
    updateMetadata: Symbol("update-metadata"),
    setRuntimeMode: Symbol("set-runtime-mode"),
    setInteractionMode: Symbol("set-interaction-mode"),
    startTurn: Symbol("start-turn"),
  },
  runAtomCommand: vi.fn(),
  readThreadShell: vi.fn(),
  awaitAttachmentUploads: vi.fn(async () => {}),
  getUploadedAttachments: vi.fn(),
  releaseAttachmentUploads: vi.fn(),
  readFileAsDataUrl: vi.fn(async () => "data:text/plain;base64,aGk="),
  addToast: vi.fn(),
}));

vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  runAtomCommand: mocks.runAtomCommand,
  squashAtomCommandFailure: (result: { error: unknown }) => result.error,
}));
vi.mock("../../rpc/atomRegistry", () => ({ appAtomRegistry: {} }));
vi.mock("../../state/entities", () => ({ readThreadShell: mocks.readThreadShell }));
vi.mock("../../state/threads", () => ({ threadEnvironment: mocks.commands }));
vi.mock("../../lib/attachmentUploadQueue", () => ({
  awaitAttachmentUploads: mocks.awaitAttachmentUploads,
  getUploadedAttachments: mocks.getUploadedAttachments,
  releaseAttachmentUploads: mocks.releaseAttachmentUploads,
}));
vi.mock("../ChatView.logic", async (original) => ({
  ...(await original<typeof import("../ChatView.logic")>()),
  readFileAsDataUrl: mocks.readFileAsDataUrl,
  revokeBlobPreviewUrl: vi.fn(),
}));
vi.mock("../ui/toast", () => ({
  toastManager: { add: mocks.addToast },
  stackedThreadToast: (toast: unknown) => toast,
}));

import { buildFileReviewComment } from "../../reviewCommentContext";
import { type QueuedMessage, useSendQueueStore } from "../../sendQueueStore";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "./composerPromptHistory";
import {
  buildQueuedMessageText,
  QUEUED_BUSY_MAX_AUTO_RETRIES,
  QUEUED_BUSY_RETRY_DELAY_MS,
  sendQueuedMessage,
} from "./sendQueuedMessage";

const threadRef = {
  environmentId: EnvironmentId.make("env-queue"),
  threadId: ThreadId.make("thread-queue"),
};
const threadKey = scopedThreadKey(threadRef);
const modelSelection = {
  instanceId: ProviderInstanceId.make("fd-deepseek"),
  model: "fd-model",
};

const queued = (id: string, update: Partial<QueuedMessage> = {}): QueuedMessage => ({
  id,
  text: `message ${id}`,
  createdAt: "2026-10-01T00:00:00.000Z",
  images: [],
  documents: [],
  terminalContexts: [],
  elementContexts: [],
  previewAnnotations: [],
  reviewComments: [],
  sendSettings: {
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    nativeSkillNames: [],
  },
  status: undefined,
  error: undefined,
  ...update,
});

const shell = (sessionStatus: string | null, update: Record<string, unknown> = {}) => ({
  title: "季度报告",
  modelSelection,
  branch: null,
  runtimeMode: "full-access",
  interactionMode: "default",
  latestTurn: { turnId: "turn-1", requestedAt: "2026-10-01T00:00:00.000Z" },
  session: sessionStatus === null ? null : { status: sessionStatus },
  ...update,
});

const document = {
  type: "document" as const,
  id: "document-1",
  name: "notes.txt",
  mimeType: "text/plain",
  sizeBytes: 2,
  file: new File(["hi"], "notes.txt", { type: "text/plain" }),
};

function commandCalls(command: symbol) {
  return mocks.runAtomCommand.mock.calls
    .filter((call) => call[1] === command)
    .map((call) => call[2] as { input: Record<string, unknown> });
}

describe("sendQueuedMessage", () => {
  beforeEach(() => {
    useSendQueueStore.setState({ byThreadKey: {}, lastDispatchByThreadKey: {} });
    mocks.runAtomCommand.mockResolvedValue({ _tag: "Success", value: undefined });
    mocks.getUploadedAttachments.mockReturnValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("starts the next turn with the settings captured when it was queued", async () => {
    mocks.readThreadShell.mockReturnValue(shell("ready"));
    useSendQueueStore.getState().enqueue(
      threadKey,
      queued("a", {
        sendSettings: {
          modelSelection,
          runtimeMode: "approval-required",
          interactionMode: "plan",
          fdSkillVersionId: 7,
          nativeSkillNames: ["fd-presentation-studio"],
        },
      }),
    );

    await expect(sendQueuedMessage(threadRef, "a")).resolves.toBe("sent");

    expect(commandCalls(mocks.commands.setRuntimeMode)[0]?.input).toMatchObject({
      threadId: threadRef.threadId,
      runtimeMode: "approval-required",
    });
    expect(commandCalls(mocks.commands.setInteractionMode)[0]?.input).toMatchObject({
      interactionMode: "plan",
    });
    expect(commandCalls(mocks.commands.updateMetadata)).toEqual([]);
    const turn = commandCalls(mocks.commands.startTurn)[0]?.input;
    expect(turn).toMatchObject({
      threadId: threadRef.threadId,
      message: { role: "user", text: "message a", attachments: [] },
      fdSkillVersionId: 7,
      nativeSkillNames: ["fd-presentation-studio"],
      modelSelection,
      runtimeMode: "approval-required",
      interactionMode: "plan",
    });
    expect(useSendQueueStore.getState().byThreadKey[threadKey]).toBeUndefined();
    // The next queued message waits until the server moves past turn-1.
    expect(useSendQueueStore.getState().lastDispatchByThreadKey[threadKey]).toMatchObject({
      latestTurnId: "turn-1",
    });
  });

  it("steers a running turn without touching the task's settings", async () => {
    mocks.readThreadShell.mockReturnValue(shell("running", { runtimeMode: "auto" }));
    useSendQueueStore.getState().enqueue(threadKey, queued("a"));

    await expect(sendQueuedMessage(threadRef, "a")).resolves.toBe("sent");

    expect(commandCalls(mocks.commands.setRuntimeMode)).toEqual([]);
    const turn = commandCalls(mocks.commands.startTurn)[0]?.input;
    expect(turn).toBeDefined();
    expect(turn && "modelSelection" in turn).toBe(false);
    expect(useSendQueueStore.getState().lastDispatchByThreadKey[threadKey]).toBeUndefined();
  });

  it("sends uploaded attachments by reference and releases the pending copies", async () => {
    mocks.readThreadShell.mockReturnValue(shell("ready"));
    const uploaded = [{ type: "document", id: "pending-1", name: "notes.txt" }];
    mocks.getUploadedAttachments.mockReturnValue(uploaded);
    useSendQueueStore
      .getState()
      .enqueue(threadKey, queued("a", { text: "", documents: [document] }));

    await sendQueuedMessage(threadRef, "a");

    expect(mocks.awaitAttachmentUploads).toHaveBeenCalledWith(["document-1"]);
    expect(commandCalls(mocks.commands.startTurn)[0]?.input).toMatchObject({
      message: { text: ATTACHMENT_ONLY_BOOTSTRAP_PROMPT, attachments: uploaded },
    });
    expect(mocks.releaseAttachmentUploads).toHaveBeenCalledWith([document]);
  });

  it("sends attachments inline when their upload is not ready", async () => {
    mocks.readThreadShell.mockReturnValue(shell("ready"));
    mocks.getUploadedAttachments.mockReturnValue(null);
    useSendQueueStore.getState().enqueue(threadKey, queued("a", { documents: [document] }));

    await sendQueuedMessage(threadRef, "a");

    expect(commandCalls(mocks.commands.startTurn)[0]?.input).toMatchObject({
      message: {
        attachments: [
          {
            type: "document",
            name: "notes.txt",
            mimeType: "text/plain",
            sizeBytes: 2,
            dataUrl: "data:text/plain;base64,aGk=",
          },
        ],
      },
    });
  });

  it("holds a failed message for the employee and says which task it belongs to", async () => {
    mocks.readThreadShell.mockReturnValue(shell("running"));
    mocks.runAtomCommand.mockResolvedValue({ _tag: "Failure", error: new Error("连接已断开") });
    useSendQueueStore.getState().enqueue(threadKey, queued("a"));

    await expect(sendQueuedMessage(threadRef, "a")).resolves.toBe("failed");

    expect(useSendQueueStore.getState().byThreadKey[threadKey]?.[0]).toMatchObject({
      status: "failed",
      holdUntilUserAction: true,
      error: "引导失败：连接已断开",
    });
    expect(mocks.addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", title: "“季度报告”的排队消息未发出" }),
    );
    expect(mocks.releaseAttachmentUploads).not.toHaveBeenCalled();
  });

  it("forgets the dispatch when a new turn fails to start", async () => {
    mocks.readThreadShell.mockReturnValue(shell("ready"));
    mocks.runAtomCommand.mockImplementation(async (_registry, command) =>
      command === mocks.commands.startTurn
        ? { _tag: "Failure", error: new Error("offline") }
        : { _tag: "Success", value: undefined },
    );
    useSendQueueStore.getState().enqueue(threadKey, queued("a"));

    await sendQueuedMessage(threadRef, "a");

    expect(useSendQueueStore.getState().byThreadKey[threadKey]?.[0]?.error).toBe(
      "发送失败：offline",
    );
    expect(useSendQueueStore.getState().lastDispatchByThreadKey[threadKey]).toBeUndefined();
  });

  it("retries by itself while the provider finishes the previous turn", async () => {
    vi.useFakeTimers();
    try {
      mocks.readThreadShell.mockReturnValue(shell("ready"));
      mocks.runAtomCommand.mockImplementation(async (_registry, command) =>
        command === mocks.commands.startTurn
          ? { _tag: "Failure", error: new Error("当前任务仍在处理，请等待完成后重试。") }
          : { _tag: "Success", value: undefined },
      );
      useSendQueueStore.getState().enqueue(threadKey, queued("a"));

      await expect(sendQueuedMessage(threadRef, "a")).resolves.toBe("retrying");
      expect(useSendQueueStore.getState().byThreadKey[threadKey]?.[0]).toMatchObject({
        status: "failed",
        busyRetryCount: 1,
      });
      expect(mocks.addToast).not.toHaveBeenCalled();

      vi.advanceTimersByTime(QUEUED_BUSY_RETRY_DELAY_MS);
      // Due again: the root sender picks it up on its next check.
      expect(useSendQueueStore.getState().byThreadKey[threadKey]?.[0]).toMatchObject({
        status: undefined,
        error: undefined,
      });

      useSendQueueStore
        .getState()
        .update(threadKey, "a", { busyRetryCount: QUEUED_BUSY_MAX_AUTO_RETRIES });
      await expect(sendQueuedMessage(threadRef, "a")).resolves.toBe("failed");
      expect(useSendQueueStore.getState().byThreadKey[threadKey]?.[0]?.holdUntilUserAction).toBe(
        true,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends one message at a time", async () => {
    mocks.readThreadShell.mockReturnValue(shell("ready"));
    const store = useSendQueueStore.getState();
    store.enqueue(threadKey, queued("a", { status: "sending" }));
    store.enqueue(threadKey, queued("b"));

    await expect(sendQueuedMessage(threadRef, "b")).resolves.toBe("skipped");
    await expect(sendQueuedMessage(threadRef, "missing")).resolves.toBe("skipped");
    expect(mocks.runAtomCommand).not.toHaveBeenCalled();
  });
});

describe("buildQueuedMessageText", () => {
  it("appends review comments to the prompt", () => {
    const text = buildQueuedMessageText(
      queued("a", {
        reviewComments: [
          buildFileReviewComment({
            id: "comment-1",
            filePath: "src/report.ts",
            startLine: 1,
            endLine: 1,
            text: "改成季度合计",
            contents: "const total = 1;",
          }),
        ],
      }),
    );
    expect(text).toContain("message a");
    expect(text).toContain("改成季度合计");
  });

  it("is null when nothing sendable is left", () => {
    expect(buildQueuedMessageText(queued("a", { text: "   " }))).toBeNull();
  });
});
