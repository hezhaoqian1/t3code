import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { makeSqlitePersistenceLive } from "./Sqlite.ts";

it.layer(NodeServices.layer)("SqlitePersistence", (it) => {
  it.effect("only fsyncs the database file at WAL checkpoints", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-sqlite-sync-" });
      const context = yield* Layer.build(
        makeSqlitePersistenceLive(path.join(directory, "state.sqlite")),
      );
      const rows = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ readonly synchronous: number }>`PRAGMA synchronous`;
      }).pipe(Effect.provide(context));
      // 1 is NORMAL.
      assert.equal(rows[0]?.synchronous, 1);
    }),
  );
});
