import {
  OrchestrationProposedPlanId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionPendingApprovalRepositoryLive } from "./ProjectionPendingApprovals.ts";
import { ProjectionProjectRepositoryLive } from "./ProjectionProjects.ts";
import { ProjectionThreadProposedPlanRepositoryLive } from "./ProjectionThreadProposedPlans.ts";
import { ProjectionThreadRepositoryLive } from "./ProjectionThreads.ts";
import { ProjectionPendingApprovalRepository } from "../Services/ProjectionPendingApprovals.ts";
import { ProjectionProjectRepository } from "../Services/ProjectionProjects.ts";
import { ProjectionThreadProposedPlanRepository } from "../Services/ProjectionThreadProposedPlans.ts";
import { ProjectionThreadRepository } from "../Services/ProjectionThreads.ts";

const projectionRepositoriesLayer = it.layer(
  Layer.mergeAll(
    ProjectionProjectRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionThreadRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionThreadProposedPlanRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionPendingApprovalRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

projectionRepositoriesLayer("Projection repositories", (it) => {
  it.effect("reads only the requested plan in its thread", () =>
    Effect.gen(function* () {
      const plans = yield* ProjectionThreadProposedPlanRepository;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.make("plan-query-thread");
      const planId = OrchestrationProposedPlanId.make("plan-query-target");
      yield* plans.upsert({
        planId,
        threadId,
        turnId: null,
        planMarkdown: "Keep this plan",
        implementedAt: "2026-03-01T00:01:00.000Z",
        implementationThreadId: ThreadId.make("implementation-thread"),
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:01:00.000Z",
      });
      // An unrelated old row must not be loaded or decoded by the exact lookup.
      yield* sql`
        INSERT INTO projection_thread_proposed_plans (
          plan_id, thread_id, turn_id, plan_markdown, implemented_at,
          implementation_thread_id, created_at, updated_at
        ) VALUES (
          'unrelated-plan', ${threadId}, NULL, '', NULL, NULL,
          '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'
        )
      `;
      const plan = Option.getOrThrow(yield* plans.getByPlanId({ threadId, planId }));
      assert.equal(plan.planMarkdown, "Keep this plan");
      assert.equal(plan.implementedAt, "2026-03-01T00:01:00.000Z");
      assert.isTrue(
        Option.isNone(
          yield* plans.getByPlanId({
            threadId: ThreadId.make("another-thread"),
            planId,
          }),
        ),
      );
    }),
  );

  it.effect("counts only pending approvals of one thread", () =>
    Effect.gen(function* () {
      const approvals = yield* ProjectionPendingApprovalRepository;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.make("approval-count-thread");
      assert.strictEqual(yield* approvals.countPendingByThreadId({ threadId }), 0);

      yield* sql`
        INSERT INTO projection_pending_approvals (
          request_id, thread_id, turn_id, status, decision, created_at, resolved_at
        ) VALUES
          ('count-pending-1', ${threadId}, NULL, 'pending', NULL,
           '2026-03-01T00:00:00.000Z', NULL),
          ('count-pending-2', ${threadId}, NULL, 'pending', NULL,
           '2026-03-01T00:00:01.000Z', NULL),
          ('count-resolved', ${threadId}, NULL, 'resolved', 'accept',
           '2026-03-01T00:00:02.000Z', '2026-03-01T00:00:03.000Z'),
          ('count-other-thread', 'approval-count-other-thread', NULL, 'pending', NULL,
           '2026-03-01T00:00:04.000Z', NULL)
      `;

      assert.strictEqual(yield* approvals.countPendingByThreadId({ threadId }), 2);
    }),
  );

  it.effect("stores SQL NULL for missing project model options", () =>
    Effect.gen(function* () {
      const projects = yield* ProjectionProjectRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* projects.upsert({
        projectId: ProjectId.make("project-null-options"),
        title: "Null options project",
        workspaceRoot: "/tmp/project-null-options",
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        defaultThreadEnvMode: null,
        scripts: [],
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        deletedAt: null,
      });

      const rows = yield* sql<{
        readonly defaultModelSelection: string | null;
      }>`
        SELECT default_model_selection_json AS "defaultModelSelection"
        FROM projection_projects
        WHERE project_id = 'project-null-options'
      `;
      const row = rows[0];
      if (!row) {
        return yield* Effect.die("Expected projection_projects row to exist.");
      }

      assert.strictEqual(
        row.defaultModelSelection,
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        JSON.stringify({
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        }),
      );

      const persisted = yield* projects.getById({
        projectId: ProjectId.make("project-null-options"),
      });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.defaultModelSelection, {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
      });
    }),
  );

  it.effect("stores JSON for thread model options", () =>
    Effect.gen(function* () {
      const threads = yield* ProjectionThreadRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* threads.upsert({
        threadId: ThreadId.make("thread-null-options"),
        projectId: ProjectId.make("project-null-options"),
        title: "Null options thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-4-6",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurnId: null,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
        latestUserMessageAt: null,
        pendingApprovalCount: 0,
        pendingUserInputCount: 0,
        hasActionableProposedPlan: 0,
        deletedAt: null,
      });

      const rows = yield* sql<{
        readonly modelSelection: string | null;
      }>`
        SELECT model_selection_json AS "modelSelection"
        FROM projection_threads
        WHERE thread_id = 'thread-null-options'
      `;
      const row = rows[0];
      if (!row) {
        return yield* Effect.die("Expected projection_threads row to exist.");
      }

      assert.strictEqual(
        row.modelSelection,
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        JSON.stringify({
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-4-6",
        }),
      );

      const persisted = yield* threads.getById({
        threadId: ThreadId.make("thread-null-options"),
      });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.modelSelection, {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-opus-4-6",
      });
    }),
  );

  it.effect("round-trips non-null settlement values through the thread row", () =>
    Effect.gen(function* () {
      const threads = yield* ProjectionThreadRepository;

      yield* threads.upsert({
        threadId: ThreadId.make("thread-settled"),
        projectId: ProjectId.make("project-1"),
        title: "Settled thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurnId: null,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-25T00:00:00.000Z",
        archivedAt: null,
        settledOverride: "settled",
        settledAt: "2026-03-25T00:00:00.000Z",
        snoozedUntil: "2026-03-26T09:00:00.000Z",
        snoozedAt: "2026-03-25T00:00:00.000Z",
        pinnedAt: "2026-03-25T00:00:00.000Z",
        latestUserMessageAt: null,
        pendingApprovalCount: 0,
        pendingUserInputCount: 0,
        hasActionableProposedPlan: 0,
        deletedAt: null,
      });

      const persisted = yield* threads.getById({
        threadId: ThreadId.make("thread-settled"),
      });
      const row = Option.getOrNull(persisted);
      if (!row) {
        return yield* Effect.die("Expected settled projection_threads row to exist.");
      }
      assert.strictEqual(row.settledOverride, "settled");
      assert.strictEqual(row.settledAt, "2026-03-25T00:00:00.000Z");
      assert.strictEqual(row.snoozedUntil, "2026-03-26T09:00:00.000Z");
      assert.strictEqual(row.snoozedAt, "2026-03-25T00:00:00.000Z");
      assert.strictEqual(row.pinnedAt, "2026-03-25T00:00:00.000Z");

      // Un-settle to the keep-active pin and wake the snooze; confirm the
      // flips persist.
      yield* threads.upsert({
        ...row,
        settledOverride: "active",
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
      });
      const repersisted = yield* threads.getById({
        threadId: ThreadId.make("thread-settled"),
      });
      const updated = Option.getOrNull(repersisted);
      assert.strictEqual(updated?.settledOverride, "active");
      assert.strictEqual(updated?.settledAt, null);
      assert.strictEqual(updated?.snoozedUntil, null);
      assert.strictEqual(updated?.snoozedAt, null);
      assert.strictEqual(updated?.pinnedAt, null);
    }),
  );
});
