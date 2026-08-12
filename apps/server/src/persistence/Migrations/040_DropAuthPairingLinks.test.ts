import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const hasPairingLinksTable = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly name: string }>`
    SELECT name
    FROM sqlite_schema
    WHERE type = 'table' AND name = 'auth_pairing_links'
  `;
  return rows.length > 0;
});

it.effect("omits the retired table from a fresh final schema", () =>
  Effect.gen(function* () {
    yield* runMigrations();
    assert.isFalse(yield* hasPairingLinksTable);
  }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
);

it.effect("drops the retired table when upgrading an existing schema", () =>
  Effect.gen(function* () {
    yield* runMigrations({ toMigrationInclusive: 39 });
    assert.isTrue(yield* hasPairingLinksTable);

    yield* runMigrations({ toMigrationInclusive: 40 });
    assert.isFalse(yield* hasPairingLinksTable);
  }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
);
