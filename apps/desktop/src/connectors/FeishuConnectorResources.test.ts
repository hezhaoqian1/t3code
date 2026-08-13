import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { resolveFeishuConnectorResources } from "./FeishuConnectorResources.ts";

it.layer(NodeServices.layer)("FeishuConnectorResources", (it) => {
  it.effect("resolves packaged macOS resources outside app.asar", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const resources = resolveFeishuConnectorResources({
        path,
        platform: "darwin",
        isPackaged: true,
        appPath: "/Applications/Fangde AI.app/Contents/Resources/app.asar",
        resourcesPath: "/Applications/Fangde AI.app/Contents/Resources",
        rootDir: "/source",
      });

      assert.equal(
        resources.cliPath,
        "/Applications/Fangde AI.app/Contents/Resources/app.asar.unpacked/node_modules/@larksuite/cli/bin/lark-cli",
      );
      assert.equal(
        resources.skillsSourceRoot,
        "/Applications/Fangde AI.app/Contents/Resources/connectors/feishu/skills",
      );
    }),
  );

  it.effect("resolves the packaged Windows executable", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const resources = resolveFeishuConnectorResources({
        path,
        platform: "win32",
        isPackaged: true,
        appPath: "C:\\Program Files\\Fangde AI\\resources\\app.asar",
        resourcesPath: "C:\\Program Files\\Fangde AI\\resources",
        rootDir: "C:\\source",
      });

      assert.match(resources.cliPath, /lark-cli\.exe$/);
      assert.notInclude(resources.cliPath, ".workbuddy");
    }),
  );
});
