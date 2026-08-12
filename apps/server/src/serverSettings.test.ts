import * as NodeServices from "@effect/platform-node/NodeServices";
import { ServerSettings, ServerSettingsPatch } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerConfig from "./config.ts";
import * as ServerSettingsModule from "./serverSettings.ts";

const decodeSettingsPatch = Schema.decodeUnknownEffect(ServerSettingsPatch);
const decodeServerSettings = Schema.decodeUnknownEffect(ServerSettings);

const makeServerSettingsLayer = () =>
  ServerSettingsModule.layer.pipe(
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3code-server-settings-test-",
        }),
      ),
    ),
  );

it.layer(NodeServices.layer)("server settings", (it) => {
  it.effect("decodes retained nested settings patches", () =>
    Effect.gen(function* () {
      assert.deepEqual(
        yield* decodeSettingsPatch({
          sourceControlWritingStyle: {
            mode: "custom",
            customInstructions: "  Use concise subjects.  ",
          },
          observability: {
            otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
          },
        }),
        {
          sourceControlWritingStyle: {
            mode: "custom",
            customInstructions: "Use concise subjects.",
          },
          observability: {
            otlpTracesUrl: "http://localhost:4318/v1/traces",
          },
        },
      );
    }),
  );

  it.effect("drops retired provider and model settings while preserving retained values", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeServerSettings({
        providers: { codex: { enabled: true, binaryPath: "/tmp/codex" } },
        providerInstances: {
          codex: { driver: "codex", config: { apiKey: "not-a-runtime-credential" } },
        },
        textGenerationModelSelection: { instanceId: "codex", model: "gpt-5" },
        sourceControlWriterModelSelection: { instanceId: "codex", model: "gpt-5" },
        addProjectBaseDirectory: "  ~/Development  ",
      });

      assert.equal(decoded.addProjectBaseDirectory, "~/Development");
      assert.notProperty(decoded, "providers");
      assert.notProperty(decoded, "providerInstances");
      assert.notProperty(decoded, "textGenerationModelSelection");
      assert.notProperty(decoded, "sourceControlWriterModelSelection");
    }),
  );

  it.effect("deep merges retained nested updates without dropping siblings", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      yield* serverSettings.updateSettings({
        sourceControlWritingStyle: {
          mode: "custom",
          customInstructions: "Use direct language.",
          followChangeRequestTemplates: false,
        },
      });

      const next = yield* serverSettings.updateSettings({
        sourceControlWritingStyle: { customInstructions: "Use short subjects." },
      });

      assert.deepEqual(next.sourceControlWritingStyle, {
        mode: "custom",
        customInstructions: "Use short subjects.",
        followChangeRequestTemplates: false,
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("buffers changes after subscription acquisition", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
        const changes = yield* serverSettings.subscribeChanges;
        yield* serverSettings.updateSettings({ addProjectBaseDirectory: "~/Development" });

        const firstChange = yield* changes.pipe(Stream.runHead, Effect.timeout("1 second"));
        assert.equal(Option.getOrUndefined(firstChange)?.addProjectBaseDirectory, "~/Development");
      }),
    ).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("trims retained string settings", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const next = yield* serverSettings.updateSettings({
        addProjectBaseDirectory: "  ~/Development  ",
        observability: {
          otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
          otlpMetricsUrl: "  http://localhost:4318/v1/metrics  ",
        },
      });

      assert.equal(next.addProjectBaseDirectory, "~/Development");
      assert.deepEqual(next.observability, {
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsUrl: "http://localhost:4318/v1/metrics",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("persists only non-default retained settings", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      yield* serverSettings.updateSettings({
        addProjectBaseDirectory: "~/Development",
        automaticGitFetchInterval: Duration.seconds(10),
      });

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      assert.deepEqual(JSON.parse(raw), {
        addProjectBaseDirectory: "~/Development",
        backgroundActivity: {
          schemaVersion: 1,
          profile: "custom",
          baseProfile: "balanced",
          overrides: { automaticGitFetchInterval: 10_000 },
        },
        automaticGitFetchInterval: 10_000,
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
});
