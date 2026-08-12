import { AuthSessionId, ThreadId, type AuthEnvironmentScope } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as AuthSessions from "./AuthSessions.ts";
import * as PersistenceErrors from "./Errors.ts";
import { SqlitePersistenceMemory } from "./Layers/Sqlite.ts";
import * as ProviderSessionRuntime from "./ProviderSessionRuntime.ts";

const issuedAt = DateTime.makeUnsafe("2026-06-20T00:00:00.000Z");
const expiresAt = DateTime.makeUnsafe("2027-06-20T00:00:00.000Z");
const scopes: ReadonlyArray<AuthEnvironmentScope> = ["orchestration:read"];

const authSessionLayer = AuthSessions.layer.pipe(Layer.provideMerge(SqlitePersistenceMemory));
const providerSessionRuntimeLayer = ProviderSessionRuntime.layer.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

describe("persistence error correlation", () => {
  it.effect("correlates auth session SQL and row-decode failures without sensitive fields", () =>
    Effect.gen(function* () {
      const sessions = yield* AuthSessions.AuthSessionRepository;
      const sql = yield* SqlClient.SqlClient;
      const sessionId = AuthSessionId.make("session-correlation");
      const subject = "session-subject-secret-sentinel";

      yield* sessions.create({
        sessionId,
        subject,
        scopes,
        method: "browser-session-cookie",
        client: {
          label: null,
          ipAddress: null,
          userAgent: null,
          deviceType: "desktop",
          os: null,
          browser: null,
        },
        issuedAt,
        expiresAt,
      });
      yield* sql`
        UPDATE auth_sessions
        SET scopes = ${"session-scopes-secret-sentinel"}
        WHERE session_id = ${sessionId}
      `;

      const decodeError = yield* Effect.flip(sessions.getById({ sessionId }));
      assert.instanceOf(decodeError, PersistenceErrors.PersistenceDecodeError);
      assert.deepStrictEqual(decodeError.correlation, { sessionId });
      assert.equal(
        decodeError.message,
        `Decode error in AuthSessionRepository.getById:decodeRow: ${decodeError.issue}`,
      );
      assert.notInclude(decodeError.issue, subject);
      assert.notInclude(decodeError.issue, "session-scopes-secret-sentinel");
      assert.notInclude(decodeError.message, subject);

      yield* sql`DROP TABLE auth_sessions`;
      const createError = yield* Effect.flip(
        sessions.create({
          sessionId,
          subject,
          scopes,
          method: "browser-session-cookie",
          client: {
            label: null,
            ipAddress: null,
            userAgent: null,
            deviceType: "desktop",
            os: null,
            browser: null,
          },
          issuedAt,
          expiresAt,
        }),
      );
      assert.instanceOf(createError, PersistenceErrors.PersistenceSqlError);
      assert.deepStrictEqual(createError.correlation, { sessionId });
      assert.equal(createError.message, "SQL error in AuthSessionRepository.create:query");
      assert.notInclude(createError.message, subject);
      assert.notInclude(createError.message, DateTime.formatIso(issuedAt));
    }).pipe(Effect.provide(authSessionLayer)),
  );

  it.effect("skips undecodable provider runtime rows and correlates SQL failures by thread", () =>
    Effect.gen(function* () {
      const runtimes = yield* ProviderSessionRuntime.ProviderSessionRuntimeRepository;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.make("thread-correlation");
      const runtimePayload = "runtime-payload-secret-sentinel";
      const lastSeenAt = "2026-06-20T00:00:00.000Z";

      yield* sql`
        INSERT INTO provider_session_runtime (
          thread_id,
          provider_name,
          provider_instance_id,
          adapter_key,
          runtime_mode,
          status,
          last_seen_at,
          resume_cursor_json,
          runtime_payload_json
        )
        VALUES (
          ${threadId},
          ${"codex"},
          NULL,
          ${"codex"},
          ${"invalid-runtime-mode"},
          ${"running"},
          ${lastSeenAt},
          NULL,
          ${`{"secret":"${runtimePayload}"}`}
        )
      `;

      const validThreadId = ThreadId.make("thread-valid");
      yield* runtimes.upsert({
        threadId: validThreadId,
        providerName: "codex",
        providerInstanceId: null,
        adapterKey: "codex",
        runtimeMode: "full-access",
        status: "running",
        lastSeenAt,
        resumeCursor: null,
        runtimePayload: null,
      });

      const listed = yield* runtimes.list();
      assert.deepStrictEqual(
        listed.map((runtime) => runtime.threadId),
        [validThreadId],
      );

      yield* sql`DROP TABLE provider_session_runtime`;
      const sqlFailure = yield* Effect.flip(
        runtimes.upsert({
          threadId,
          providerName: "codex",
          providerInstanceId: null,
          adapterKey: "codex",
          runtimeMode: "full-access",
          status: "running",
          lastSeenAt,
          resumeCursor: null,
          runtimePayload: { secret: runtimePayload },
        }),
      );
      assert.instanceOf(sqlFailure, PersistenceErrors.PersistenceSqlError);
      assert.deepStrictEqual(sqlFailure.correlation, { threadId });
      assert.equal(
        sqlFailure.message,
        "SQL error in ProviderSessionRuntimeRepository.upsert:query",
      );
      assert.notInclude(sqlFailure.message, runtimePayload);
      assert.notInclude(sqlFailure.message, lastSeenAt);
    }).pipe(Effect.provide(providerSessionRuntimeLayer)),
  );
});
