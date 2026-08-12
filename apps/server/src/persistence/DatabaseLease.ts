import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { DatabaseSync } from "node:sqlite";

export class DatabaseLeaseUnavailableError extends Schema.TaggedErrorClass<DatabaseLeaseUnavailableError>()(
  "DatabaseLeaseUnavailableError",
  {
    databasePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Database '${this.databasePath}' is leased by another local process.`;
  }
}

export class DatabaseLease extends Context.Service<
  DatabaseLease,
  {
    readonly databasePath: string;
    readonly leasePath: string;
  }
>()("t3/persistence/DatabaseLease") {}

export const leasePathForDatabase = (databasePath: string): string => `${databasePath}.lease`;

export const acquire = (databasePath: string) => {
  const leasePath = leasePathForDatabase(databasePath);
  return Effect.acquireRelease(
    Effect.try({
      try: () => {
        const database = new DatabaseSync(leasePath);
        try {
          database.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;");
          return {
            database,
            service: DatabaseLease.of({ databasePath, leasePath }),
          };
        } catch (cause) {
          database.close();
          throw cause;
        }
      },
      catch: (cause) => new DatabaseLeaseUnavailableError({ databasePath, cause }),
    }),
    ({ database }) =>
      Effect.sync(() => {
        try {
          database.exec("ROLLBACK");
        } finally {
          database.close();
        }
      }).pipe(Effect.ignore),
  ).pipe(Effect.map(({ service }) => service));
};

export const layer = (databasePath: string) => Layer.effect(DatabaseLease, acquire(databasePath));

export const ensureAvailable = (databasePath: string) =>
  Effect.scoped(acquire(databasePath).pipe(Effect.asVoid));
