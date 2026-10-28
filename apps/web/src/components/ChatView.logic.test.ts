import {
  EnvironmentId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Atom, AsyncResult } from "effect/unstable/reactivity";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useComposerDraftStore } from "../composerDraftStore";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentThreadDetails } from "../state/threads";

import type { Thread, ThreadShell } from "../types";
import {
  MAX_HIDDEN_MOUNTED_PREVIEW_THREADS,
  MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  branchMismatchKey,
  buildExpiredTerminalContextToastCopy,
  buildRevertTurnCountByUserMessageId,
  buildRewindTurnCountByUserMessageId,
  buildLoadingThreadFromShell,
  buildThreadTurnInterruptInput,
  createLocalDispatchSnapshot,
  deriveComposerSendState,
  dismissBranchMismatchForSession,
  ENVIRONMENT_RECONNECT_WARNING_GRACE_MS,
  getStartedThreadModelChangeBlockReason,
  hasEnvironmentReconnectWarningGraceElapsed,
  hasServerAcknowledgedLocalDispatch,
  isBranchMismatchDismissedForSession,
  reconcileMountedTerminalThreadIds,
  reconcileRetainedMountedThreadIds,
  resolveThreadMetadataUpdateForNextTurn,
  resolveSendEnvMode,
  scheduleEnvironmentReconnectWarning,
  startNewThreadForProject,
  shouldShowBranchMismatchBanner,
  shouldWriteThreadErrorToCurrentServerThread,
  prepareRevertedMessageAttachments,
  restoreRewoundMessageToDraft,
  waitForRevertedMessage,
} from "./ChatView.logic";

const environmentId = EnvironmentId.make("environment-local");
const projectId = ProjectId.make("project-1");
const threadId = ThreadId.make("thread-1");
const now = "2026-03-29T00:00:00.000Z";

describe("environment reconnect warning grace", () => {
  afterEach(() => vi.useRealTimers());

  it("shows a persistent reconnect after the grace period", () => {
    vi.useFakeTimers();
    const showWarning = vi.fn();

    scheduleEnvironmentReconnectWarning(showWarning);
    vi.advanceTimersByTime(ENVIRONMENT_RECONNECT_WARNING_GRACE_MS - 1);
    expect(showWarning).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(showWarning).toHaveBeenCalledOnce();
  });

  it("cancels the warning when the connection recovers during the grace period", () => {
    vi.useFakeTimers();
    const showWarning = vi.fn();

    const cancel = scheduleEnvironmentReconnectWarning(showWarning);
    cancel();
    vi.advanceTimersByTime(ENVIRONMENT_RECONNECT_WARNING_GRACE_MS);

    expect(showWarning).not.toHaveBeenCalled();
  });

  it("does not reuse elapsed grace from another environment", () => {
    const anotherEnvironmentId = EnvironmentId.make("environment-remote");

    expect(hasEnvironmentReconnectWarningGraceElapsed(environmentId, environmentId)).toBe(true);
    expect(hasEnvironmentReconnectWarningGraceElapsed(anotherEnvironmentId, environmentId)).toBe(
      false,
    );
  });
});

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: threadId,
    environmentId,
    projectId,
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  };
}

const completedTurn = {
  turnId: TurnId.make("turn-1"),
  state: "completed" as const,
  requestedAt: now,
  startedAt: "2026-03-29T00:00:01.000Z",
  completedAt: "2026-03-29T00:00:10.000Z",
  assistantMessageId: null,
};

const readySession = {
  threadId,
  status: "ready" as const,
  providerName: "codex",
  providerInstanceId: ProviderInstanceId.make("codex"),
  runtimeMode: "full-access" as const,
  activeTurnId: null,
  lastError: null,
  updatedAt: "2026-03-29T00:00:10.000Z",
};

describe("buildLoadingThreadFromShell", () => {
  it("preserves shell metadata and supplies empty detail collections", () => {
    const shell = {
      environmentId,
      id: threadId,
      projectId,
      title: "Loading thread",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "main",
      worktreePath: null,
      latestTurn: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      session: null,
      latestUserMessageAt: now,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
    } satisfies ThreadShell;

    expect(buildLoadingThreadFromShell(shell)).toMatchObject({
      environmentId,
      id: threadId,
      projectId,
      title: "Loading thread",
      branch: "main",
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
    });
  });
});

describe("resolveThreadMetadataUpdateForNextTurn", () => {
  const modelSelection = {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.4",
  };

  it("updates a stale local thread branch to the active checkout", () => {
    expect(
      resolveThreadMetadataUpdateForNextTurn({
        currentModelSelection: modelSelection,
        currentBranch: "feature/thread",
        nextBranch: "feature/checkout",
      }),
    ).toEqual({ branch: "feature/checkout", worktreePath: null });
  });

  it("does not write metadata when the model and branch are unchanged", () => {
    expect(
      resolveThreadMetadataUpdateForNextTurn({
        currentModelSelection: modelSelection,
        nextModelSelection: modelSelection,
        currentBranch: "feature/current",
        nextBranch: "feature/current",
      }),
    ).toBeNull();
  });
});

describe("buildThreadTurnInterruptInput", () => {
  it("targets the session's active running turn", () => {
    const activeTurnId = TurnId.make("turn-running");

    expect(
      buildThreadTurnInterruptInput(
        makeThread({
          session: {
            ...readySession,
            status: "running",
            activeTurnId,
          },
        }),
      ),
    ).toEqual({ threadId, turnId: activeTurnId });
  });

  it("omits a turn id when the session is not running", () => {
    expect(buildThreadTurnInterruptInput(makeThread({ session: readySession }))).toEqual({
      threadId,
    });
  });
});

describe("deriveComposerSendState", () => {
  it("treats expired terminal pills as non-sendable content", () => {
    const state = deriveComposerSendState({
      prompt: "\uFFFC",
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId,
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: now,
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("");
    expect(state.sendableTerminalContexts).toEqual([]);
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(false);
  });

  it("keeps text sendable while excluding expired terminal pills", () => {
    const state = deriveComposerSendState({
      prompt: `yoo \uFFFC waddup`,
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId,
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: now,
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("yoo  waddup");
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(true);
  });

  it("treats element contexts as sendable content (no text, no images, no terminals)", () => {
    const state = deriveComposerSendState({
      prompt: "",
      imageCount: 0,
      terminalContexts: [],
      elementContextCount: 1,
    });

    expect(state.trimmedPrompt).toBe("");
    expect(state.expiredTerminalContextCount).toBe(0);
    expect(state.hasSendableContent).toBe(true);
  });

  it("does NOT treat zero element contexts as sendable", () => {
    expect(
      deriveComposerSendState({
        prompt: "",
        imageCount: 0,
        terminalContexts: [],
        elementContextCount: 0,
      }).hasSendableContent,
    ).toBe(false);
  });
});

describe("buildExpiredTerminalContextToastCopy", () => {
  it("formats empty and omission guidance", () => {
    expect(buildExpiredTerminalContextToastCopy(1, "empty")).toEqual({
      title: "Expired terminal context won't be sent",
      description: "Remove it or re-add it to include terminal output.",
    });
    expect(buildExpiredTerminalContextToastCopy(2, "omitted")).toEqual({
      title: "Expired terminal contexts omitted from message",
      description: "Re-add it if you want that terminal output included.",
    });
  });
});

describe("getStartedThreadModelChangeBlockReason", () => {
  const providers = [
    {
      instanceId: ProviderInstanceId.make("codex"),
    },
    {
      instanceId: ProviderInstanceId.make("grok"),
      requiresNewThreadForModelChange: true,
    },
  ];

  it("allows model changes before a provider session has started", () => {
    expect(
      getStartedThreadModelChangeBlockReason({
        providers,
        hasStartedSession: false,
        currentModelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-build",
        },
        nextModelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-other",
        },
      }),
    ).toBeNull();
  });

  it("allows unchanged model selections for restricted providers", () => {
    expect(
      getStartedThreadModelChangeBlockReason({
        providers,
        hasStartedSession: true,
        currentModelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-build",
        },
        nextModelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-build",
        },
      }),
    ).toBeNull();
  });

  it("blocks started-session model changes when either provider requires a new thread", () => {
    expect(
      getStartedThreadModelChangeBlockReason({
        providers,
        hasStartedSession: true,
        currentModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        nextModelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-build",
        },
      }),
    ).toEqual({
      title: "Start a new chat to change models",
      description:
        "This provider does not allow switching models after a conversation has started.",
    });
  });
});

describe("resolveSendEnvMode", () => {
  it("keeps worktree mode only for git repositories", () => {
    expect(resolveSendEnvMode({ requestedEnvMode: "worktree", isGitRepo: true })).toBe("worktree");
    expect(resolveSendEnvMode({ requestedEnvMode: "worktree", isGitRepo: false })).toBe("local");
  });
});

describe("branchMismatchKey", () => {
  it("builds a key from thread id and both branches", () => {
    expect(branchMismatchKey("thread-1", { threadBranch: "feat/a", currentBranch: "feat/b" })).toBe(
      "thread-1:feat/a:feat/b",
    );
  });

  it("returns null without a thread or mismatch", () => {
    expect(branchMismatchKey(null, { threadBranch: "a", currentBranch: "b" })).toBeNull();
    expect(branchMismatchKey("thread-1", null)).toBeNull();
  });
});

describe("shouldShowBranchMismatchBanner", () => {
  const base = {
    hasMismatch: true,
    isDismissed: false,
    composerHasContent: false,
    wasShownForCurrentMismatch: false,
  };

  it("stays hidden during passive browsing (even though the composer autofocuses)", () => {
    expect(shouldShowBranchMismatchBanner(base)).toBe(false);
  });

  it("shows once the composer has draft content", () => {
    expect(shouldShowBranchMismatchBanner({ ...base, composerHasContent: true })).toBe(true);
  });

  it("stays mounted after the draft clears once shown for the current mismatch", () => {
    expect(shouldShowBranchMismatchBanner({ ...base, wasShownForCurrentMismatch: true })).toBe(
      true,
    );
  });

  it("never shows when dismissed or without a mismatch", () => {
    expect(
      shouldShowBranchMismatchBanner({ ...base, composerHasContent: true, isDismissed: true }),
    ).toBe(false);
    expect(
      shouldShowBranchMismatchBanner({ ...base, composerHasContent: true, hasMismatch: false }),
    ).toBe(false);
  });
});

describe("session branch mismatch dismissal", () => {
  it("tracks dismissed keys and treats other keys as active", () => {
    expect(isBranchMismatchDismissedForSession("t1:a:b")).toBe(false);
    dismissBranchMismatchForSession("t1:a:b");
    expect(isBranchMismatchDismissedForSession("t1:a:b")).toBe(true);
    expect(isBranchMismatchDismissedForSession("t1:a:c")).toBe(false);
    expect(isBranchMismatchDismissedForSession(null)).toBe(false);
  });
});

describe("reconcileMountedTerminalThreadIds", () => {
  it("keeps open threads and makes the active thread most recent", () => {
    expect(
      reconcileMountedTerminalThreadIds({
        currentThreadIds: ["thread-a", "thread-b", "thread-c"],
        openThreadIds: ["thread-a", "thread-b", "thread-c"],
        activeThreadId: "thread-a",
        activeThreadTerminalOpen: true,
        maxHiddenThreadCount: 2,
      }),
    ).toEqual(["thread-b", "thread-c", "thread-a"]);
  });

  it("drops closed threads and enforces the hidden mounted cap", () => {
    const ids = Array.from(
      { length: MAX_HIDDEN_MOUNTED_TERMINAL_THREADS + 2 },
      (_, index) => `thread-${index}`,
    );
    expect(
      reconcileMountedTerminalThreadIds({
        currentThreadIds: ids,
        openThreadIds: ids.slice(1),
        activeThreadId: null,
        activeThreadTerminalOpen: false,
      }),
    ).toEqual(ids.slice(-MAX_HIDDEN_MOUNTED_TERMINAL_THREADS));
  });
});

describe("reconcileRetainedMountedThreadIds", () => {
  it("retains hidden open threads and adds the active open thread", () => {
    expect(
      reconcileRetainedMountedThreadIds({
        currentThreadIds: [ThreadId.make("thread-hidden")],
        openThreadIds: [ThreadId.make("thread-hidden")],
        activeThreadId: ThreadId.make("thread-active"),
        activeThreadOpen: true,
        maxHiddenThreadCount: MAX_HIDDEN_MOUNTED_PREVIEW_THREADS,
      }),
    ).toEqual([ThreadId.make("thread-hidden"), ThreadId.make("thread-active")]);
  });

  it("can retain the active thread as hidden when it is inactive", () => {
    expect(
      reconcileRetainedMountedThreadIds({
        currentThreadIds: [ThreadId.make("thread-active")],
        openThreadIds: [ThreadId.make("thread-active")],
        activeThreadId: ThreadId.make("thread-active"),
        activeThreadOpen: false,
        maxHiddenThreadCount: MAX_HIDDEN_MOUNTED_PREVIEW_THREADS,
        retainInactiveActiveThread: true,
      }),
    ).toEqual([ThreadId.make("thread-active")]);
  });

  it("evicts the oldest hidden threads beyond the configured cap", () => {
    const currentThreadIds = Array.from(
      { length: MAX_HIDDEN_MOUNTED_PREVIEW_THREADS + 2 },
      (_, index) => ThreadId.make(`thread-${index + 1}`),
    );

    expect(
      reconcileRetainedMountedThreadIds({
        currentThreadIds,
        openThreadIds: currentThreadIds,
        activeThreadId: null,
        activeThreadOpen: false,
        maxHiddenThreadCount: MAX_HIDDEN_MOUNTED_PREVIEW_THREADS,
      }),
    ).toEqual(currentThreadIds.slice(-MAX_HIDDEN_MOUNTED_PREVIEW_THREADS));
  });
});

describe("shouldWriteThreadErrorToCurrentServerThread", () => {
  it("writes errors for a shell-derived active server thread", () => {
    const routeThreadRef = { environmentId, threadId };

    expect(
      shouldWriteThreadErrorToCurrentServerThread({
        activeServerThread: { environmentId, id: threadId },
        routeThreadRef,
        targetThreadId: threadId,
      }),
    ).toBe(true);
  });

  it("requires an active server thread matching the environment, route, and target", () => {
    const routeThreadRef = { environmentId, threadId };

    expect(
      shouldWriteThreadErrorToCurrentServerThread({
        activeServerThread: null,
        routeThreadRef,
        targetThreadId: threadId,
      }),
    ).toBe(false);
  });
});

describe("startNewThreadForProject", () => {
  it("starts a thread through the supplied shared handler for the active project", () => {
    const calls: Array<{ environmentId: EnvironmentId; projectId: ProjectId }> = [];
    const projectRef = { environmentId, projectId };

    expect(
      startNewThreadForProject(projectRef, (nextProjectRef) => {
        calls.push(nextProjectRef);
        return Promise.resolve();
      }),
    ).toBe(true);
    expect(calls).toEqual([projectRef]);
  });

  it("does nothing when the active project is unavailable", () => {
    let called = false;

    expect(
      startNewThreadForProject(null, () => {
        called = true;
        return Promise.resolve();
      }),
    ).toBe(false);
    expect(called).toBe(false);
  });
});

describe("hasServerAcknowledgedLocalDispatch", () => {
  it("does not acknowledge unchanged server state", () => {
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({ latestTurn: completedTurn, session: readySession }),
    );

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: completedTurn,
        latestUserMessageId: localDispatch.latestUserMessageId,
        session: readySession,
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(false);
  });

  it("acknowledges a settled newer turn", () => {
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({ latestTurn: completedTurn, session: readySession }),
    );
    const newerTurn = {
      ...completedTurn,
      turnId: TurnId.make("turn-2"),
      requestedAt: "2026-03-29T00:01:00.000Z",
      startedAt: "2026-03-29T00:01:01.000Z",
      completedAt: "2026-03-29T00:01:30.000Z",
    };

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: newerTurn,
        latestUserMessageId: localDispatch.latestUserMessageId,
        session: { ...readySession, updatedAt: newerTurn.completedAt },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("waits for the matching running turn before acknowledging", () => {
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({ latestTurn: completedTurn, session: readySession }),
    );
    const runningTurn = {
      ...completedTurn,
      turnId: TurnId.make("turn-2"),
      state: "running" as const,
      requestedAt: "2026-03-29T00:01:00.000Z",
      startedAt: "2026-03-29T00:01:01.000Z",
      completedAt: null,
    };

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: runningTurn,
        latestUserMessageId: localDispatch.latestUserMessageId,
        session: {
          ...readySession,
          status: "running",
          activeTurnId: TurnId.make("turn-other"),
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(false);
    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: runningTurn,
        latestUserMessageId: localDispatch.latestUserMessageId,
        session: {
          ...readySession,
          status: "running",
          activeTurnId: runningTurn.turnId,
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("acknowledges a steering message projected onto the current running turn", () => {
    const runningTurn = {
      ...completedTurn,
      state: "running" as const,
      completedAt: null,
    };
    const runningSession = {
      ...readySession,
      status: "running" as const,
      activeTurnId: runningTurn.turnId,
    };
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({
        latestTurn: runningTurn,
        session: runningSession,
        messages: [
          {
            id: MessageId.make("message-before-steer"),
            role: "user",
            text: "Initial prompt",
            turnId: runningTurn.turnId,
            createdAt: runningTurn.requestedAt,
            updatedAt: runningTurn.requestedAt,
            streaming: false,
          },
        ],
      }),
    );

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: runningTurn,
        latestUserMessageId: MessageId.make("message-steer"),
        session: runningSession,
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("acknowledges pending user interaction and errors immediately", () => {
    const localDispatch = createLocalDispatchSnapshot(makeThread());
    const common = {
      localDispatch,
      phase: "ready" as const,
      latestTurn: null,
      latestUserMessageId: localDispatch.latestUserMessageId,
      session: null,
      hasPendingApproval: false,
      hasPendingUserInput: false,
      threadError: null,
    };

    expect(hasServerAcknowledgedLocalDispatch({ ...common, hasPendingApproval: true })).toBe(true);
    expect(hasServerAcknowledgedLocalDispatch({ ...common, hasPendingUserInput: true })).toBe(true);
    expect(hasServerAcknowledgedLocalDispatch({ ...common, threadError: "failed" })).toBe(true);
  });
});

describe("buildRevertTurnCountByUserMessageId", () => {
  const time = "2026-09-05T00:00:00.000Z";
  const user = {
    id: MessageId.make("user-1"),
    role: "user" as const,
    text: "改一下",
    turnId: null,
    createdAt: time,
    updatedAt: time,
    streaming: false,
  };
  const assistant = {
    id: MessageId.make("assistant-1"),
    role: "assistant" as const,
    text: "",
    turnId: TurnId.make("turn-1"),
    createdAt: time,
    updatedAt: time,
    streaming: true,
  };
  const summaries = new Map([
    [
      assistant.id,
      {
        turnId: TurnId.make("turn-1"),
        checkpointTurnCount: 3,
        checkpointRef: "refs/t3/checkpoints/1",
        status: "ready",
        files: [],
        assistantMessageId: assistant.id,
        completedAt: time,
      } as never,
    ],
  ]);
  const entries = (text: string) =>
    [user, { ...assistant, text }].map((message) => ({
      id: message.id,
      kind: "message" as const,
      createdAt: message.createdAt,
      message,
    }));

  it("keeps the previous map while streamed text leaves the result unchanged", () => {
    const first = buildRevertTurnCountByUserMessageId({
      timelineEntries: entries(""),
      turnDiffSummaryByAssistantMessageId: summaries,
      inferredCheckpointTurnCountByTurnId: {},
    });
    expect([...first]).toEqual([[user.id, 2]]);
    const next = buildRevertTurnCountByUserMessageId(
      {
        timelineEntries: entries("第一段"),
        turnDiffSummaryByAssistantMessageId: summaries,
        inferredCheckpointTurnCountByTurnId: {},
      },
      first,
    );
    expect(next).toBe(first);
  });

  it("returns a new map when a revert target changes", () => {
    const first = buildRevertTurnCountByUserMessageId({
      timelineEntries: entries(""),
      turnDiffSummaryByAssistantMessageId: new Map(),
      inferredCheckpointTurnCountByTurnId: {},
    });
    const next = buildRevertTurnCountByUserMessageId(
      {
        timelineEntries: entries(""),
        turnDiffSummaryByAssistantMessageId: summaries,
        inferredCheckpointTurnCountByTurnId: {},
      },
      first,
    );
    expect(next).not.toBe(first);
    expect([...next]).toEqual([[user.id, 2]]);
  });
});

describe("buildRewindTurnCountByUserMessageId", () => {
  const at = (minute: number) => `2026-10-01T00:0${minute}:00.000Z`;
  const entry = (id: string, role: "user" | "assistant", minute: number) => {
    const message = {
      id: MessageId.make(id),
      role,
      text: id,
      turnId: role === "assistant" ? TurnId.make(`turn-${id}`) : null,
      createdAt: at(minute),
      updatedAt: at(minute),
      streaming: false,
    };
    return { id: message.id, kind: "message" as const, createdAt: message.createdAt, message };
  };

  it("offers every sent message in a task folder without checkpoints", () => {
    const rewindable = buildRewindTurnCountByUserMessageId({
      timelineEntries: [
        entry("user-1", "user", 1),
        entry("assistant-1", "assistant", 2),
        entry("user-2", "user", 3),
      ],
      checkpointTurnCountByUserMessageId: new Map(),
    });
    expect([...rewindable]).toEqual([
      ["user-1", 0],
      ["user-2", 0],
    ]);
  });

  it("keeps the checkpoint for a files-too rewind and the previous map when unchanged", () => {
    const input = {
      timelineEntries: [entry("user-1", "user", 1), entry("assistant-1", "assistant", 2)],
      checkpointTurnCountByUserMessageId: new Map([[MessageId.make("user-1"), 0]]),
    };
    const first = buildRewindTurnCountByUserMessageId(input);
    expect([...first]).toEqual([["user-1", 0]]);
    expect(buildRewindTurnCountByUserMessageId(input, first)).toBe(first);
  });

  it("does not offer FD Skill history or anything before it", () => {
    const rewindable = buildRewindTurnCountByUserMessageId({
      timelineEntries: [
        entry("user-1", "user", 1),
        entry("fd-enterprise-history:7:1", "user", 2),
        entry("fd-enterprise-history:7:2", "assistant", 3),
        entry("user-2", "user", 4),
        entry("assistant-2", "assistant", 5),
      ],
      checkpointTurnCountByUserMessageId: new Map(),
    });
    expect([...rewindable.keys()]).toEqual(["user-2"]);
  });
});

describe("rewind draft recovery", () => {
  const message = {
    id: MessageId.make("rewound-message"),
    role: "user" as const,
    text: "edit this question",
    turnId: null,
    createdAt: now,
    updatedAt: now,
    streaming: false,
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("waits past command acceptance until the exact message disappears", async () => {
    const atom = Atom.make<Thread | null>(makeThread({ messages: [message] }));
    vi.spyOn(environmentThreadDetails, "detailAtom").mockReturnValue(atom);
    let accepted = false;
    const result = waitForRevertedMessage({ environmentId, threadId }, message.id, async () => {
      accepted = true;
    });
    let completed = false;
    void result.then(() => {
      completed = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(accepted).toBe(true);
    expect(completed).toBe(false);
    appAtomRegistry.set(atom, makeThread({ messages: [message], latestTurn: completedTurn }));
    await Promise.resolve();
    expect(completed).toBe(false);
    appAtomRegistry.set(atom, makeThread({ messages: [] }));
    await result;
  });

  it("rejects with the server's reason and leaves the draft alone", async () => {
    const atom = Atom.make<Thread | null>(makeThread({ messages: [message] }));
    vi.spyOn(environmentThreadDetails, "detailAtom").mockReturnValue(atom);
    const result = waitForRevertedMessage({ environmentId, threadId }, message.id, async () => {
      appAtomRegistry.set(
        atom,
        makeThread({
          messages: [message],
          activities: [
            {
              id: EventId.make("rewind-failed"),
              kind: "checkpoint.revert.failed",
              tone: "error",
              summary: "从这里重来失败",
              payload: { detail: "AI 的对话记录没能回退", turnCount: 0 },
              turnId: null,
              createdAt: now,
            },
          ],
        }),
      );
    });
    await expect(result).rejects.toThrow("AI 的对话记录没能回退");
  });

  it("refuses a message that is no longer in the thread", async () => {
    const atom = Atom.make<Thread | null>(makeThread({ messages: [] }));
    vi.spyOn(environmentThreadDetails, "detailAtom").mockReturnValue(atom);
    const revert = vi.fn(async () => {});
    await expect(
      waitForRevertedMessage({ environmentId, threadId }, message.id, revert),
    ).rejects.toThrow("找不到要重来的那条消息");
    expect(revert).not.toHaveBeenCalled();
  });

  it("bounds waits when a provider never finishes", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const atom = Atom.make<Thread | null>(makeThread({ messages: [message] }));
    vi.spyOn(environmentThreadDetails, "detailAtom").mockReturnValue(atom);
    const result = waitForRevertedMessage(
      { environmentId, threadId },
      message.id,
      async () => {},
      20,
    );
    const timeoutIndex = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 20);
    const rewindTimeout = setTimeoutSpy.mock.results[timeoutIndex]?.value;
    expect(rewindTimeout).toBeDefined();
    const rejection = expect(result).rejects.toThrow("等待太久");
    await vi.advanceTimersByTimeAsync(20);
    await rejection;
    expect(clearTimeoutSpy).toHaveBeenCalledWith(rewindTimeout);
  });

  it("copies image and document bytes before the rewind removes them", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("image bytes"))
      .mockResolvedValueOnce(new Response("report bytes"));
    vi.stubGlobal("fetch", fetchMock);
    const requested: string[] = [];
    const files = await prepareRevertedMessageAttachments({
      message: {
        ...message,
        attachments: [
          {
            type: "image",
            id: "thread-1-image",
            name: "chart.png",
            mimeType: "image/png",
            sizeBytes: 11,
          },
          {
            type: "document",
            id: "thread-1-report",
            name: "季度报告.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sizeBytes: 12,
          },
        ],
      },
      environmentId,
      httpBaseUrl: "https://server.test",
      createAssetUrl: async (target) => {
        const resource = target.input.resource;
        requested.push(resource._tag === "attachment" ? resource.attachmentId : resource._tag);
        return AsyncResult.success({ relativeUrl: `/asset/${requested.length}` });
      },
    });
    expect(requested).toEqual(["thread-1-image", "thread-1-report"]);
    expect(files.map(({ attachment, file }) => [attachment.type, file.name])).toEqual([
      ["image", "chart.png"],
      ["document", "季度报告.docx"],
    ]);
    expect(await files[1]?.file.text()).toBe("report bytes");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://server.test/asset/1");
  });

  it("fails before the rewind when an attachment cannot be copied", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("gone", { status: 404 })));
    await expect(
      prepareRevertedMessageAttachments({
        message: {
          ...message,
          attachments: [
            {
              type: "image",
              id: "thread-1-image",
              name: "chart.png",
              mimeType: "image/png",
              sizeBytes: 11,
            },
          ],
        },
        environmentId,
        httpBaseUrl: "https://server.test",
        createAssetUrl: async () => AsyncResult.success({ relativeUrl: "/asset/1" }),
      }),
    ).rejects.toThrow("没能取回附件“chart.png”");
  });
});

describe("restoreRewoundMessageToDraft", () => {
  const threadRef = scopeThreadRef(environmentId, ThreadId.make("thread-restore"));

  afterEach(() => {
    useComposerDraftStore.getState().clearComposerContent(threadRef);
  });

  it("puts the typed prompt below the unsent draft and brings attachments back", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(threadRef, "还没发出去的补充");
    const unsentImage = new File([new Uint8Array(4).fill(1)], "chart.png", {
      type: "image/png",
      lastModified: 1,
    });
    store.addImages(threadRef, [
      {
        type: "image",
        id: "unsent-image",
        name: "chart.png",
        mimeType: "image/png",
        sizeBytes: unsentImage.size,
        previewUrl: "blob:unsent",
        file: unsentImage,
      },
    ]);
    const restoredImage = new File([new Uint8Array(4).fill(1)], "chart.png", {
      type: "image/png",
      lastModified: 1,
    });
    const restoredReport = new File(["report"], "季度报告.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    let nextId = 0;

    const restored = restoreRewoundMessageToDraft({
      store: useComposerDraftStore.getState(),
      target: threadRef,
      message: {
        id: MessageId.make("rewound"),
        role: "user",
        text: '把报告改成三段式\n\n<review_comment file="报告.md">旧评论</review_comment>',
        turnId: null,
        createdAt: now,
        updatedAt: now,
        streaming: false,
        attachments: [],
      },
      files: [
        {
          attachment: {
            type: "image",
            id: "old-image",
            name: "chart.png",
            mimeType: "image/png",
            sizeBytes: 4,
          },
          file: restoredImage,
        },
        {
          attachment: {
            type: "document",
            id: "old-report",
            name: "季度报告.docx",
            mimeType: restoredReport.type,
            sizeBytes: restoredReport.size,
          },
          file: restoredReport,
        },
      ],
      createId: () => `restored-${++nextId}`,
      createPreviewUrl: (file) => `blob:${file.name}`,
    });

    expect(restored.prompt).toBe("还没发出去的补充\n\n把报告改成三段式");
    const draft = useComposerDraftStore.getState().getComposerDraft(threadRef);
    expect(draft?.prompt).toBe("还没发出去的补充\n\n把报告改成三段式");
    // The identical image already in the draft does not swallow the restored one.
    expect(draft?.images.map((image) => image.id)).toEqual(["unsent-image", "restored-1"]);
    expect(draft?.images[1]?.file).toBe(restoredImage);
    expect(restored.documents).toEqual([
      expect.objectContaining({
        type: "document",
        id: "restored-2",
        name: "季度报告.docx",
        file: restoredReport,
      }),
    ]);
  });

  it("never puts an answer or thinking text into the composer", () => {
    useComposerDraftStore.getState().setPrompt(threadRef, "草稿");
    const restored = restoreRewoundMessageToDraft({
      store: useComposerDraftStore.getState(),
      target: threadRef,
      message: {
        id: MessageId.make("thinking"),
        role: "reasoning",
        text: "先分析用户的需求……",
        turnId: TurnId.make("turn-1"),
        createdAt: now,
        updatedAt: now,
        streaming: false,
      },
      files: [],
      createId: () => "unused",
      createPreviewUrl: () => "blob:unused",
    });
    expect(restored.prompt).toBe("草稿");
    expect(useComposerDraftStore.getState().getComposerDraft(threadRef)?.prompt).toBe("草稿");
  });

  it("fills an empty composer with just the rewound prompt", () => {
    const restored = restoreRewoundMessageToDraft({
      store: useComposerDraftStore.getState(),
      target: threadRef,
      message: {
        id: MessageId.make("rewound"),
        role: "user",
        text: "  帮我整理会议纪要  ",
        turnId: null,
        createdAt: now,
        updatedAt: now,
        streaming: false,
      },
      files: [],
      createId: () => "unused",
      createPreviewUrl: () => "blob:unused",
    });
    expect(restored).toEqual({ prompt: "帮我整理会议纪要", documents: [] });
    expect(useComposerDraftStore.getState().getComposerDraft(threadRef)?.prompt).toBe(
      "帮我整理会议纪要",
    );
  });
});
