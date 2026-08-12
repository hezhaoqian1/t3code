import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

it.effect("upgrades legacy model selections after an existing schema reached migration 040", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 40 });

    yield* sql`
      INSERT INTO projection_projects (
        project_id, title, workspace_root, default_model_selection_json,
        scripts_json, created_at, updated_at, deleted_at
      )
      VALUES
        (
          'project-legacy', 'Legacy', '/tmp/legacy',
          '{"provider":"codex","model":"gpt-5.4","options":[{"id":"effort","value":"high"}],"future":"kept"}',
          '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL
        ),
        (
          'project-canonical', 'Canonical', '/tmp/canonical',
          '{"instanceId":"fd-deepseek","model":"deepseek-v4-flash"}',
          '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL
        ),
        (
          'project-null', 'Null', '/tmp/null', NULL,
          '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL
        )
    `;

    yield* sql`
      INSERT INTO projection_threads (
        thread_id, project_id, title, model_selection_json, branch, worktree_path,
        latest_turn_id, created_at, updated_at, archived_at, latest_user_message_at,
        pending_approval_count, pending_user_input_count, has_actionable_proposed_plan,
        deleted_at, runtime_mode, interaction_mode
      )
      VALUES (
        'thread-legacy', 'project-legacy', 'Legacy thread',
        '{"provider":"claudeAgent","model":"claude-opus-4-6","options":[{"id":"fastMode","value":true}]}',
        NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
        NULL, NULL, 0, 0, 0, NULL, 'full-access', 'default'
      )
    `;

    yield* sql`
      INSERT INTO orchestration_events (
        event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
        command_id, causation_event_id, correlation_id, actor_kind, payload_json, metadata_json
      )
      VALUES
        ('project-created', 'project', 'project-legacy', 1, 'project.created',
          '2026-01-01T00:00:00.000Z', NULL, NULL, NULL, 'user',
          '{"defaultModelSelection":{"provider":"codex","model":"gpt-5.4","options":[{"id":"effort","value":"high"}]},"other":"kept"}', '{}'),
        ('project-updated', 'project', 'project-legacy', 2, 'project.meta-updated',
          '2026-01-01T00:00:00.000Z', NULL, NULL, NULL, 'user',
          '{"defaultModelSelection":{"provider":"claudeAgent","model":"claude-opus-4-6"}}', '{}'),
        ('thread-created', 'thread', 'thread-legacy', 1, 'thread.created',
          '2026-01-01T00:00:00.000Z', NULL, NULL, NULL, 'user',
          '{"modelSelection":{"provider":"codex","model":"gpt-5.4"},"other":"kept"}', '{}'),
        ('thread-updated', 'thread', 'thread-legacy', 2, 'thread.meta-updated',
          '2026-01-01T00:00:00.000Z', NULL, NULL, NULL, 'user',
          '{"modelSelection":{"provider":"claudeAgent","model":"claude-opus-4-6"}}', '{}'),
        ('thread-turn-started', 'thread', 'thread-legacy', 3, 'thread.turn-start-requested',
          '2026-01-01T00:00:00.000Z', NULL, NULL, NULL, 'user',
          '{"modelSelection":{"provider":"codex","model":"gpt-5.4","options":[{"id":"fastMode","value":true}]}}', '{}'),
        ('unrelated-event', 'thread', 'thread-legacy', 4, 'thread.activity-appended',
          '2026-01-01T00:00:00.000Z', NULL, NULL, NULL, 'user',
          '{"modelSelection":{"provider":"codex","model":"unchanged"}}', '{}')
    `;

    yield* runMigrations({ toMigrationInclusive: 41 });

    const projects = yield* sql<{
      readonly projectId: string;
      readonly selection: string | null;
    }>`
      SELECT project_id AS "projectId", default_model_selection_json AS selection
      FROM projection_projects
      ORDER BY project_id
    `;
    assert.deepStrictEqual(
      projects.map(({ projectId, selection }) => ({
        projectId,
        selection: selection === null ? null : decodeJson(selection),
      })),
      [
        {
          projectId: "project-canonical",
          selection: { instanceId: "fd-deepseek", model: "deepseek-v4-flash" },
        },
        {
          projectId: "project-legacy",
          selection: {
            instanceId: "codex",
            model: "gpt-5.4",
            options: [{ id: "effort", value: "high" }],
            future: "kept",
          },
        },
        { projectId: "project-null", selection: null },
      ],
    );

    const threads = yield* sql<{ readonly selection: string }>`
      SELECT model_selection_json AS selection FROM projection_threads
    `;
    assert.deepStrictEqual(decodeJson(threads[0]!.selection), {
      instanceId: "claudeAgent",
      model: "claude-opus-4-6",
      options: [{ id: "fastMode", value: true }],
    });

    const events = yield* sql<{ readonly eventId: string; readonly payload: string }>`
      SELECT event_id AS "eventId", payload_json AS payload
      FROM orchestration_events
      ORDER BY sequence
    `;
    assert.deepStrictEqual(
      events.map(({ eventId, payload }) => ({ eventId, payload: decodeJson(payload) })),
      [
        {
          eventId: "project-created",
          payload: {
            defaultModelSelection: {
              instanceId: "codex",
              model: "gpt-5.4",
              options: [{ id: "effort", value: "high" }],
            },
            other: "kept",
          },
        },
        {
          eventId: "project-updated",
          payload: {
            defaultModelSelection: { instanceId: "claudeAgent", model: "claude-opus-4-6" },
          },
        },
        {
          eventId: "thread-created",
          payload: {
            modelSelection: { instanceId: "codex", model: "gpt-5.4" },
            other: "kept",
          },
        },
        {
          eventId: "thread-updated",
          payload: {
            modelSelection: { instanceId: "claudeAgent", model: "claude-opus-4-6" },
          },
        },
        {
          eventId: "thread-turn-started",
          payload: {
            modelSelection: {
              instanceId: "codex",
              model: "gpt-5.4",
              options: [{ id: "fastMode", value: true }],
            },
          },
        },
        {
          eventId: "unrelated-event",
          payload: {
            modelSelection: { provider: "codex", model: "unchanged" },
          },
        },
      ],
    );
  }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
);
