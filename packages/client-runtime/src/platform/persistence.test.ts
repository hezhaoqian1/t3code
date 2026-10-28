import { OrchestrationShellSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { encodeShellSnapshotForCache } from "./persistence.ts";

const decodeSnapshot = Schema.decodeUnknownEffect(OrchestrationShellSnapshot);
const encodeSnapshot = Schema.encodeEffect(OrchestrationShellSnapshot);

const now = "2026-09-25T00:00:00.000Z";

function threadShell(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `thread-${index}`,
    projectId: index % 2 === 0 ? "project-a" : "project-b",
    title: `任务 ${index}`,
    modelSelection: {
      instanceId: "codex",
      model: "gpt-5-codex",
      ...(index % 3 === 0 ? { options: [{ id: "reasoningEffort", value: "high" }] } : {}),
    },
    runtimeMode: "full-access",
    interactionMode: index % 4 === 0 ? "plan" : "default",
    branch: index % 5 === 0 ? `feature/${index}` : null,
    worktreePath: null,
    latestTurn:
      index % 2 === 0
        ? {
            turnId: `turn-${index}`,
            state: "completed",
            requestedAt: now,
            startedAt: now,
            completedAt: now,
            assistantMessageId: `assistant:${index}`,
          }
        : null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: index % 7 === 0 ? "settled" : null,
    settledAt: null,
    snoozedUntil: index % 6 === 0 ? now : null,
    pinnedAt: index % 9 === 0 ? now : null,
    pinOrderKey: index % 9 === 0 ? "a0" : null,
    session:
      index % 3 === 0
        ? {
            threadId: `thread-${index}`,
            status: "ready",
            providerName: "codex",
            providerInstanceId: "codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: now,
          }
        : null,
    latestUserMessageAt: now,
    hasPendingApprovals: index % 8 === 0,
    hasPendingUserInput: false,
    hasActionableProposedPlan: index % 10 === 0,
    backgroundLiveness: index % 11 === 0 ? "working" : null,
    planProgress: index % 12 === 0 ? { step: "整理数据", completedSteps: 1, totalSteps: 3 } : null,
    ...overrides,
  };
}

describe("encodeShellSnapshotForCache", () => {
  it.effect("matches the Schema encoding of a decoded snapshot", () =>
    Effect.gen(function* () {
      const snapshot = yield* decodeSnapshot({
        snapshotSequence: 42,
        projects: [
          {
            id: "project-a",
            title: "Project A",
            workspaceRoot: "C:/Users/demo/FangdeAI/Tasks/a",
            defaultModelSelection: { instanceId: "codex", model: "gpt-5-codex" },
            defaultThreadEnvMode: "local",
            scripts: [
              {
                id: "dev",
                name: "Dev",
                command: "pnpm dev",
                icon: "play",
                runOnWorktreeCreate: false,
                previewUrl: "http://localhost:5173",
              },
            ],
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "project-b",
            title: "Project B",
            workspaceRoot: "/srv/project-b",
            defaultModelSelection: null,
            scripts: [],
            createdAt: now,
            updatedAt: now,
          },
        ],
        threads: Array.from({ length: 40 }, (_, index) => threadShell(index)),
        updatedAt: now,
      });

      expect(snapshot.threads).toHaveLength(40);
      expect(yield* encodeShellSnapshotForCache(snapshot)).toEqual(yield* encodeSnapshot(snapshot));
    }),
  );

  it.effect("passes thread shells through without copying them", () =>
    Effect.gen(function* () {
      const snapshot = yield* decodeSnapshot({
        snapshotSequence: 1,
        projects: [],
        threads: [threadShell(1)],
        updatedAt: now,
      });

      const encoded = yield* encodeShellSnapshotForCache(snapshot);
      expect(encoded.threads).toBe(snapshot.threads);
    }),
  );
});
