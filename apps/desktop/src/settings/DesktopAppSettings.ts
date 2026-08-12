import { DesktopUpdateChannelSchema, type DesktopUpdateChannel } from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SynchronizedRef from "effect/SynchronizedRef";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import {
  DEFAULT_LINUX_PASSWORD_STORE,
  normalizeLinuxPasswordStorePreference,
  type LinuxPasswordStorePreference,
} from "../linuxSecretStorage.ts";
import { resolveDefaultDesktopUpdateChannel } from "../updates/updateChannels.ts";

export interface DesktopSettings {
  readonly linuxPasswordStore: LinuxPasswordStorePreference;
  readonly mainWindowBounds: DesktopWindowBounds | null;
  readonly mainWindowMaximized: boolean;
  readonly updateChannel: DesktopUpdateChannel;
  readonly updateChannelConfiguredByUser: boolean;
}

export interface DesktopSettingsChange {
  readonly settings: DesktopSettings;
  readonly changed: boolean;
}

const MIN_MAIN_WINDOW_SIZE = { width: 840, height: 620 } as const;
export const DesktopWindowBoundsSchema = Schema.Struct({
  x: Schema.Int,
  y: Schema.Int,
  width: Schema.Int.check(Schema.isGreaterThanOrEqualTo(MIN_MAIN_WINDOW_SIZE.width)),
  height: Schema.Int.check(Schema.isGreaterThanOrEqualTo(MIN_MAIN_WINDOW_SIZE.height)),
});
export type DesktopWindowBounds = typeof DesktopWindowBoundsSchema.Type;
export const DEFAULT_MAIN_WINDOW_SIZE = { width: 1100, height: 780 } as const;

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  linuxPasswordStore: DEFAULT_LINUX_PASSWORD_STORE,
  mainWindowBounds: null,
  mainWindowMaximized: false,
  updateChannel: "latest",
  updateChannelConfiguredByUser: false,
};

const DesktopWindowBoundsDocument = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});

const DesktopSettingsDocument = Schema.Struct({
  linuxPasswordStore: Schema.optionalKey(Schema.Unknown),
  mainWindowBounds: Schema.optionalKey(Schema.NullOr(DesktopWindowBoundsDocument)),
  mainWindowMaximized: Schema.optionalKey(Schema.Boolean),
  updateChannel: Schema.optionalKey(DesktopUpdateChannelSchema),
  updateChannelConfiguredByUser: Schema.optionalKey(Schema.Boolean),
});
type DesktopSettingsDocument = typeof DesktopSettingsDocument.Type;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const DesktopSettingsJson = fromLenientJson(DesktopSettingsDocument);
const decodeDesktopSettingsJson = Schema.decodeEffect(DesktopSettingsJson);
const encodeDesktopSettingsJson = Schema.encodeEffect(DesktopSettingsJson);
const decodeDesktopWindowBounds = Schema.decodeUnknownOption(DesktopWindowBoundsSchema);
const desktopWindowBoundsEquivalence = Schema.toEquivalence(DesktopWindowBoundsSchema);

const DesktopSettingsWriteOperation = Schema.Literals([
  "create-temporary-file-name",
  "encode-document",
  "create-directory",
  "write-temporary-file",
  "replace-settings-file",
]);

export class DesktopSettingsWriteError extends Schema.TaggedErrorClass<DesktopSettingsWriteError>()(
  "DesktopSettingsWriteError",
  {
    operation: DesktopSettingsWriteOperation,
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop settings write failed during ${this.operation} at ${this.path}.`;
  }
}

export class DesktopAppSettings extends Context.Service<
  DesktopAppSettings,
  {
    readonly load: Effect.Effect<DesktopSettings>;
    readonly get: Effect.Effect<DesktopSettings>;
    readonly setMainWindowBounds: (
      bounds: DesktopWindowBounds,
      isMaximized: boolean,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    readonly setUpdateChannel: (
      channel: DesktopUpdateChannel,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
  }
>()("@t3tools/desktop/settings/DesktopAppSettings") {}

export function resolveDefaultDesktopSettings(appVersion: string): DesktopSettings {
  return {
    ...DEFAULT_DESKTOP_SETTINGS,
    updateChannel: resolveDefaultDesktopUpdateChannel(appVersion),
  };
}

export function normalizeMainWindowBounds(value: unknown): DesktopWindowBounds | null {
  return Option.getOrNull(decodeDesktopWindowBounds(value));
}

function normalizeDesktopSettingsDocument(
  parsed: DesktopSettingsDocument,
  appVersion: string,
): DesktopSettings {
  const defaults = resolveDefaultDesktopSettings(appVersion);
  const mainWindowBounds = normalizeMainWindowBounds(parsed.mainWindowBounds);
  const parsedUpdateChannel = Option.fromNullishOr(parsed.updateChannel);
  const legacyConfigured =
    parsed.updateChannelConfiguredByUser === undefined &&
    Option.contains(parsedUpdateChannel, "nightly");
  const updateChannelConfiguredByUser =
    parsed.updateChannelConfiguredByUser === true || legacyConfigured;

  return {
    linuxPasswordStore: normalizeLinuxPasswordStorePreference(parsed.linuxPasswordStore),
    mainWindowBounds,
    mainWindowMaximized: mainWindowBounds !== null && parsed.mainWindowMaximized === true,
    updateChannel: updateChannelConfiguredByUser
      ? Option.getOrElse(parsedUpdateChannel, () => defaults.updateChannel)
      : defaults.updateChannel,
    updateChannelConfiguredByUser,
  };
}

function toDesktopSettingsDocument(
  settings: DesktopSettings,
  defaults: DesktopSettings,
): DesktopSettingsDocument {
  const document: Mutable<DesktopSettingsDocument> = {};
  if (settings.linuxPasswordStore !== defaults.linuxPasswordStore) {
    document.linuxPasswordStore = settings.linuxPasswordStore;
  }
  if (settings.mainWindowBounds !== null) document.mainWindowBounds = settings.mainWindowBounds;
  if (settings.mainWindowMaximized) document.mainWindowMaximized = true;
  if (settings.updateChannel !== defaults.updateChannel)
    document.updateChannel = settings.updateChannel;
  if (settings.updateChannelConfiguredByUser !== defaults.updateChannelConfiguredByUser) {
    document.updateChannelConfiguredByUser = settings.updateChannelConfiguredByUser;
  }
  return document;
}

function setMainWindowBounds(
  settings: DesktopSettings,
  bounds: DesktopWindowBounds,
  isMaximized: boolean,
): DesktopSettings {
  return settings.mainWindowBounds !== null &&
    desktopWindowBoundsEquivalence(settings.mainWindowBounds, bounds) &&
    settings.mainWindowMaximized === isMaximized
    ? settings
    : { ...settings, mainWindowBounds: bounds, mainWindowMaximized: isMaximized };
}

function setUpdateChannel(
  settings: DesktopSettings,
  requestedChannel: DesktopUpdateChannel,
): DesktopSettings {
  return settings.updateChannel === requestedChannel && settings.updateChannelConfiguredByUser
    ? settings
    : {
        ...settings,
        updateChannel: requestedChannel,
        updateChannelConfiguredByUser: true,
      };
}

function readSettings(
  fileSystem: FileSystem.FileSystem,
  settingsPath: string,
  appVersion: string,
): Effect.Effect<DesktopSettings> {
  const defaults = resolveDefaultDesktopSettings(appVersion);
  return fileSystem.readFileString(settingsPath).pipe(
    Effect.option,
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(defaults),
        onSome: (raw) =>
          decodeDesktopSettingsJson(raw).pipe(
            Effect.map((parsed) => normalizeDesktopSettingsDocument(parsed, appVersion)),
            Effect.orElseSucceed(() => defaults),
          ),
      }),
    ),
  );
}

const writeSettings = Effect.fn("desktop.settings.writeSettings")(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly settingsPath: string;
  readonly settings: DesktopSettings;
  readonly defaults: DesktopSettings;
  readonly suffix: string;
}): Effect.fn.Return<void, DesktopSettingsWriteError> {
  const directory = input.path.dirname(input.settingsPath);
  const tempPath = `${input.settingsPath}.${process.pid}.${input.suffix}.tmp`;
  const encoded = yield* encodeDesktopSettingsJson(
    toDesktopSettingsDocument(input.settings, input.defaults),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopSettingsWriteError({
          operation: "encode-document",
          path: input.settingsPath,
          cause,
        }),
    ),
  );
  yield* input.fileSystem
    .makeDirectory(directory, { recursive: true })
    .pipe(
      Effect.mapError(
        (cause) =>
          new DesktopSettingsWriteError({ operation: "create-directory", path: directory, cause }),
      ),
    );
  yield* input.fileSystem.writeFileString(tempPath, `${encoded}\n`).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopSettingsWriteError({
          operation: "write-temporary-file",
          path: tempPath,
          cause,
        }),
    ),
  );
  yield* input.fileSystem.rename(tempPath, input.settingsPath).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopSettingsWriteError({
          operation: "replace-settings-file",
          path: input.settingsPath,
          cause,
        }),
    ),
  );
});

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const settingsRef = yield* SynchronizedRef.make(environment.defaultDesktopSettings);

  const persist = (
    update: (settings: DesktopSettings) => DesktopSettings,
  ): Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError> =>
    SynchronizedRef.modifyEffect(settingsRef, (settings) => {
      const next = update(settings);
      if (next === settings) {
        const unchanged: DesktopSettingsChange = { settings, changed: false };
        return Effect.succeed([unchanged, settings] as const);
      }
      return crypto.randomUUIDv4.pipe(
        Effect.map((uuid) => uuid.replaceAll("-", "")),
        Effect.mapError(
          (cause) =>
            new DesktopSettingsWriteError({
              operation: "create-temporary-file-name",
              path: environment.desktopSettingsPath,
              cause,
            }),
        ),
        Effect.flatMap((suffix) =>
          writeSettings({
            fileSystem,
            path,
            settingsPath: environment.desktopSettingsPath,
            settings: next,
            defaults: environment.defaultDesktopSettings,
            suffix,
          }),
        ),
        Effect.as([
          { settings: next, changed: true } satisfies DesktopSettingsChange,
          next,
        ] as const),
      );
    });

  return DesktopAppSettings.of({
    get: SynchronizedRef.get(settingsRef),
    load: readSettings(fileSystem, environment.desktopSettingsPath, environment.appVersion).pipe(
      Effect.flatMap((settings) => SynchronizedRef.setAndGet(settingsRef, settings)),
      Effect.withSpan("desktop.settings.load"),
    ),
    setMainWindowBounds: (bounds, isMaximized) =>
      persist((settings) => setMainWindowBounds(settings, bounds, isMaximized)),
    setUpdateChannel: (channel) => persist((settings) => setUpdateChannel(settings, channel)),
  });
});

export const layer = Layer.effect(DesktopAppSettings, make);

export const layerTest = (initialSettings: DesktopSettings = DEFAULT_DESKTOP_SETTINGS) =>
  Layer.effect(
    DesktopAppSettings,
    SynchronizedRef.make(initialSettings).pipe(
      Effect.map((settingsRef) => {
        const update = (f: (settings: DesktopSettings) => DesktopSettings) =>
          SynchronizedRef.modify(settingsRef, (settings) => {
            const next = f(settings);
            return [{ settings: next, changed: next !== settings }, next] as const;
          });
        return DesktopAppSettings.of({
          get: SynchronizedRef.get(settingsRef),
          load: SynchronizedRef.get(settingsRef),
          setMainWindowBounds: (bounds, isMaximized) =>
            update((settings) => setMainWindowBounds(settings, bounds, isMaximized)),
          setUpdateChannel: (channel) => update((settings) => setUpdateChannel(settings, channel)),
        });
      }),
    ),
  );
