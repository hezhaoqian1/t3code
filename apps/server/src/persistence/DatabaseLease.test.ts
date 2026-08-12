import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as DatabaseLease from "./DatabaseLease.ts";
import { makeSqlitePersistenceLive } from "./Layers/Sqlite.ts";

it.layer(NodeServices.layer)("DatabaseLease", (it) => {
  it.effect("blocks replacement while an idle long-lived persistence layer is open", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-database-lease-live-" });
      const databasePath = path.join(directory, "state.sqlite");

      yield* Layer.build(makeSqlitePersistenceLive(databasePath));
      const error = yield* DatabaseLease.ensureAvailable(databasePath).pipe(Effect.flip);

      assert.equal(error._tag, "DatabaseLeaseUnavailableError");
      assert.equal(error.databasePath, databasePath);
    }),
  );

  it.effect("reuses a stale lease database after its owner scope closes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-database-lease-stale-" });
      const databasePath = path.join(directory, "state.sqlite");
      const leasePath = DatabaseLease.leasePathForDatabase(databasePath);

      yield* Effect.scoped(DatabaseLease.acquire(databasePath).pipe(Effect.asVoid));
      assert.isTrue(yield* fs.exists(leasePath));

      yield* DatabaseLease.ensureAvailable(databasePath);
    }),
  );
});
