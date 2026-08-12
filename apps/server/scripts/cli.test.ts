import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import serverPackage from "../package.json" with { type: "json" };

it.layer(NodeServices.layer)("server CLI", (it) => {
  it.effect("does not expose a public package publish path", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cliPath = yield* path.fromFileUrl(new URL("./cli.ts", import.meta.url));
      const cliSource = yield* fs.readFileString(cliPath);

      assert.isFalse(/\bpublishCmd\b/u.test(cliSource));
      assert.isFalse(/Command\.make\(\s*["']publish["']/u.test(cliSource));
      assert.isFalse(/\b(?:vp|pnpm)\b[^\n]*\bpublish\b/u.test(cliSource));
      assert.isTrue(/Command\.withSubcommands\(\[buildCmd\]\)/u.test(cliSource));
      assert.equal(serverPackage.private, true);
    }),
  );
});
