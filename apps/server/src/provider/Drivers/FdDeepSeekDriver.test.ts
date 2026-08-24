import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, vi } from "@effect/vitest";
import {
  MessageId,
  ThreadId,
  type ChatAttachment,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect } from "vite-plus/test";

import type { FdServerRuntimeCredentialProjection } from "@t3tools/contracts/fd/runtime-credentials";

import * as ServerConfig from "../../config.ts";
import { FdRuntimeCredentialStore, makeStore } from "../../fd/FdRuntimeCredentialStore.ts";
import {
  FdEnterpriseThreadRuntime,
  FdEnterpriseThreadRuntimeLive,
} from "../../fd-skills/FdEnterpriseThreadRuntime.ts";
import { FD_DEEPSEEK_DRIVER_KIND, FD_DEEPSEEK_INSTANCE_ID } from "../../fd-agent/FdModelPolicy.ts";
import { FdAgentKernel } from "../../fd-agent/FdAgentKernel.ts";
import {
  FdResponsesClient,
  type FdResponsesClientOptions,
} from "../../fd-agent/FdResponsesClient.ts";
import { FD_RESPONSES_MODEL } from "../../fd-agent/FdResponsesProtocol.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import * as WorkspaceEntries from "../../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";
import { BUILT_IN_DRIVERS } from "../builtInDrivers.ts";
import { makeFdDeepSeekAdapter } from "../Layers/FdDeepSeekAdapter.ts";
import { deriveProviderInstanceConfigMap } from "../Layers/ProviderInstanceRegistryHydration.ts";
import {
  FdDeepSeekDriver,
  resolveFdDeepSeekAttachments,
  resolveFdLocalToolContext,
  resolveFdOrdinarySessionInput,
} from "./FdDeepSeekDriver.ts";

const unused = () => Effect.die("unused test service");

const workspaceFileSystem = WorkspaceFileSystem.WorkspaceFileSystem.of({
  readFile: unused,
  writeFile: unused,
});
const workspaceEntries = WorkspaceEntries.WorkspaceEntries.of({
  browse: unused,
  list: unused,
  refresh: unused,
  search: unused,
  searchContents: unused,
});
const processRunner = ProcessRunner.ProcessRunner.of({ run: unused });
const vcsProcess = VcsProcess.VcsProcess.of({ run: unused });
const attachmentLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "fd-deepseek-driver-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

const credentials: FdServerRuntimeCredentialProjection = {
  userId: 1,
  runtimeTokenId: 1,
  newApiOrigin: "https://runtime.invalid",
  runtimeApiKey: "test",
  accessToken: "test",
  accessExpiresAt: 4_102_444_800,
  policy: {
    version: 1,
    capability: "general_assistant",
    model: FD_RESPONSES_MODEL,
    expiresAt: 4_102_444_800,
  },
  generation: 1,
};

const snapshotFor = (authenticated: boolean) =>
  Effect.scoped(
    Effect.gen(function* () {
      const store = yield* makeStore();
      if (authenticated) {
        yield* store.apply({ version: 1, type: "set", credentials });
      }
      const instance = yield* FdDeepSeekDriver.create({
        instanceId: FD_DEEPSEEK_INSTANCE_ID,
        displayName: undefined,
        environment: [],
        enabled: true,
        config: {},
      }).pipe(
        Effect.provideService(FdRuntimeCredentialStore, store.service),
        Effect.provideService(WorkspaceFileSystem.WorkspaceFileSystem, workspaceFileSystem),
        Effect.provideService(WorkspaceEntries.WorkspaceEntries, workspaceEntries),
        Effect.provideService(ProcessRunner.ProcessRunner, processRunner),
        Effect.provideService(VcsProcess.VcsProcess, vcsProcess),
        Effect.provide(attachmentLayer),
      );
      return yield* instance.snapshot.getSnapshot;
    }),
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FdDeepSeekDriver", () => {
  it.effect("uses canonical office identity and fails closed when it cannot be resolved", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "fd-deepseek-office-profile-",
      });
      const officeRoot = `${root}/office-workspace`;
      const projectRoot = `${root}/employee-project`;
      const officeAlias = `${root}/office-alias`;
      yield* fileSystem.makeDirectory(officeRoot);
      yield* fileSystem.makeDirectory(projectRoot);
      yield* fileSystem.symlink(officeRoot, officeAlias);
      const canonicalOfficeRoot = yield* fileSystem.realPath(officeRoot);

      const contextFor = (input: {
        readonly cwd: string;
        readonly projectWorkspaceRoot: string | undefined;
        readonly officeModeEnabled?: boolean;
      }) =>
        resolveFdLocalToolContext({
          ...input,
          officeWorkspaceRoot: officeRoot,
          officeModeEnabled: input.officeModeEnabled ?? true,
        });

      expect(yield* contextFor({ cwd: projectRoot, projectWorkspaceRoot: officeRoot })).toEqual({
        cwd: canonicalOfficeRoot,
        profile: "office-read-only",
      });
      expect(yield* contextFor({ cwd: projectRoot, projectWorkspaceRoot: officeAlias })).toEqual({
        cwd: canonicalOfficeRoot,
        profile: "office-read-only",
      });
      expect(yield* contextFor({ cwd: projectRoot, projectWorkspaceRoot: undefined })).toEqual({
        cwd: canonicalOfficeRoot,
        profile: "office-read-only",
      });
      expect(
        yield* contextFor({ cwd: projectRoot, projectWorkspaceRoot: `${root}/missing` }),
      ).toEqual({ cwd: canonicalOfficeRoot, profile: "office-read-only" });
      expect(yield* contextFor({ cwd: projectRoot, projectWorkspaceRoot: projectRoot })).toEqual({
        cwd: projectRoot,
        profile: "project",
      });
      expect(
        yield* contextFor({
          cwd: projectRoot,
          projectWorkspaceRoot: officeAlias,
          officeModeEnabled: false,
        }),
      ).toEqual({ cwd: projectRoot, profile: "project" });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("preserves the selected runtime mode for office sessions", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "fd-deepseek-office-runtime-mode-",
      });
      const officeRoot = `${root}/office-workspace`;
      const projectRoot = `${root}/employee-project`;
      yield* fileSystem.makeDirectory(officeRoot);
      yield* fileSystem.makeDirectory(projectRoot);
      const canonicalOfficeRoot = yield* fileSystem.realPath(officeRoot);

      for (const runtimeMode of ["auto-accept-edits", "auto", "full-access"] as const) {
        const session = yield* resolveFdOrdinarySessionInput({
          session: {
            provider: FD_DEEPSEEK_DRIVER_KIND,
            providerInstanceId: FD_DEEPSEEK_INSTANCE_ID,
            threadId: ThreadId.make(`fd-office-runtime-${runtimeMode}`),
            cwd: projectRoot,
            projectWorkspaceRoot: officeRoot,
            runtimeMode,
          },
          officeWorkspaceRoot: officeRoot,
          officeModeEnabled: true,
        });

        expect(session).toMatchObject({
          cwd: canonicalOfficeRoot,
          runtimeMode,
        });
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("resolves only bounded server-owned image attachments", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig.ServerConfig;
      const attachment: ChatAttachment = {
        type: "image",
        id: "fd-thread-12345678-1234-1234-1234-123456789abc",
        name: "private.png",
        mimeType: "image/png",
        sizeBytes: 8,
      };
      yield* fileSystem.writeFile(
        `${config.attachmentsDir}/${attachment.id}.png`,
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );

      expect(yield* resolveFdDeepSeekAttachments([attachment])).toEqual([
        { type: "input_image", image_url: "data:image/png;base64,iVBORw0KGgo=" },
      ]);

      const mismatched = yield* Effect.flip(
        resolveFdDeepSeekAttachments([{ ...attachment, sizeBytes: 2 }]),
      );
      expect(mismatched.detail).toBe("FD image attachment failed size validation.");
      expect(mismatched.cause).toBeUndefined();
    }).pipe(Effect.provide(attachmentLayer)),
  );

  it.effect("rejects unsupported, invalid, missing, and oversized image attachments", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig.ServerConfig;
      const base: ChatAttachment = {
        type: "image",
        id: "fd-thread-12345678-1234-1234-1234-123456789abc",
        name: "private.png",
        mimeType: "image/png",
        sizeBytes: 8,
      };

      const unsupported = yield* Effect.flip(
        resolveFdDeepSeekAttachments([
          { ...base, mimeType: "image/svg+xml" } as unknown as ChatAttachment,
        ]),
      );
      expect(unsupported.detail).toBe("FD image attachment type is unsupported.");

      const invalid = yield* Effect.flip(
        resolveFdDeepSeekAttachments([{ ...base, id: "../private" }]),
      );
      expect(invalid.detail).toBe("FD image attachment reference is invalid.");

      const missing = yield* Effect.flip(resolveFdDeepSeekAttachments([base]));
      expect(missing.detail).toBe("FD image attachment is unavailable.");

      const invalidMagic = new Uint8Array(8);
      yield* fileSystem.writeFile(`${config.attachmentsDir}/${base.id}.png`, invalidMagic);
      const invalidBinary = yield* Effect.flip(
        resolveFdDeepSeekAttachments([{ ...base, sizeBytes: invalidMagic.byteLength }]),
      );
      expect(invalidBinary.detail).toBe("FD image attachment failed binary validation.");

      const oversized = new Uint8Array(10 * 1_024 * 1_024 + 1);
      yield* fileSystem.writeFile(`${config.attachmentsDir}/${base.id}.png`, oversized);
      const tooLarge = yield* Effect.flip(
        resolveFdDeepSeekAttachments([{ ...base, sizeBytes: oversized.byteLength }]),
      );
      expect(tooLarge.detail).toBe("FD image attachment failed size validation.");
    }).pipe(Effect.provide(attachmentLayer)),
  );

  it.effect("sends original text and inline bytes without disclosing the attachment path", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig.ServerConfig;
      const attachment: ChatAttachment = {
        type: "image",
        id: "fd-thread-12345678-1234-1234-1234-123456789abc",
        name: "private-screenshot.png",
        mimeType: "image/png",
        sizeBytes: 8,
      };
      const attachmentPath = `${config.attachmentsDir}/${attachment.id}.png`;
      yield* fileSystem.writeFile(
        attachmentPath,
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );

      const store = yield* makeStore();
      yield* store.apply({ version: 1, type: "set", credentials });
      const requestBodyTexts: string[] = [];
      const fetch: NonNullable<FdResponsesClientOptions["fetch"]> = vi.fn(async (_input, init) => {
        requestBodyTexts.push(String(init?.body));
        return new Response(
          [
            'data: {"type":"response.created","response":{"id":"response-1","created_at":1800000000,"model":"deepseek-v4-flash"}}',
            "",
            'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"message-1"}}',
            "",
            'data: {"type":"response.output_text.delta","item_id":"message-1","output_index":0,"delta":"Done"}',
            "",
            'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"message-1","status":"completed","role":"assistant","content":[{"type":"output_text","text":"Done"}]}}',
            "",
            'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1,"output_tokens_details":{"reasoning_tokens":0}}}}',
            "",
            "data: [DONE]",
            "",
          ].join("\n"),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      });
      const client = new FdResponsesClient(store.service, { fetch });
      const adapter = yield* makeFdDeepSeekAdapter({
        kernel: new FdAgentKernel(client),
        resolveAttachments: (attachments) =>
          resolveFdDeepSeekAttachments(attachments).pipe(
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(ServerConfig.ServerConfig, config),
          ),
      });
      const events: ProviderRuntimeEvent[] = [];
      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkChild);
      const threadId = ThreadId.make("fd-attachment-privacy");
      yield* adapter.startSession({
        provider: FD_DEEPSEEK_DRIVER_KIND,
        providerInstanceId: FD_DEEPSEEK_INSTANCE_ID,
        threadId,
        runtimeMode: "full-access",
        modelSelection: {
          instanceId: FD_DEEPSEEK_INSTANCE_ID,
          model: FD_RESPONSES_MODEL,
        },
      });
      yield* Effect.promise(() =>
        vi.waitFor(() =>
          expect(events.some((event) => event.type === "session.started")).toBe(true),
        ),
      );
      const turn = yield* adapter.sendTurn({
        threadId,
        input: "Inspect this image exactly.",
        attachments: [attachment],
      });
      yield* Effect.promise(() =>
        vi.waitFor(() =>
          expect(
            events.some((event) => event.type === "turn.completed" && event.turnId === turn.turnId),
          ).toBe(true),
        ),
      );

      expect(requestBodyTexts).toHaveLength(1);
      const requestBody = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
      )(requestBodyTexts[0]);
      expect(requestBody.input).toEqual([
        {
          role: "user",
          content: [
            { type: "input_text", text: "Inspect this image exactly." },
            { type: "input_image", image_url: "data:image/png;base64,iVBORw0KGgo=" },
          ],
        },
      ]);
      const encoded = requestBodyTexts[0]!;
      expect(encoded).not.toContain(config.attachmentsDir);
      expect(encoded).not.toContain(attachmentPath);
      expect(encoded).not.toContain(attachment.id);
      expect(encoded).not.toContain(attachment.name);
      expect(encoded).not.toContain("saved at:");
      expect(encoded).not.toMatch(/\/Users\/|[A-Za-z]:\\\\/);
    }).pipe(Effect.provide(attachmentLayer)),
  );

  it("is the only built-in driver and accepts only an empty config", () => {
    expect(BUILT_IN_DRIVERS).toEqual([FdDeepSeekDriver]);
    expect(FdDeepSeekDriver.driverKind).toBe(FD_DEEPSEEK_DRIVER_KIND);
    expect(FdDeepSeekDriver.metadata.supportsMultipleInstances).toBe(false);
    expect(Schema.decodeUnknownSync(FdDeepSeekDriver.configSchema)({})).toEqual({});
    expect(() =>
      Schema.decodeUnknownSync(FdDeepSeekDriver.configSchema)({ endpoint: "forbidden" }),
    ).toThrow();
  });

  it("hydrates exactly one enabled fixed FD instance", () => {
    expect(deriveProviderInstanceConfigMap()).toEqual({
      [FD_DEEPSEEK_INSTANCE_ID]: {
        driver: FD_DEEPSEEK_DRIVER_KIND,
        enabled: true,
        config: {},
      },
    });
  });

  it.effect("reports unauthenticated warning state with exact model metadata", () =>
    Effect.gen(function* () {
      const snapshot = yield* snapshotFor(false);
      expect(snapshot).toMatchObject({
        instanceId: FD_DEEPSEEK_INSTANCE_ID,
        driver: FD_DEEPSEEK_DRIVER_KIND,
        status: "warning",
        auth: { status: "unauthenticated", type: "fd-account" },
      });
      expect(snapshot.models).toEqual([
        expect.objectContaining({
          slug: FD_RESPONSES_MODEL,
          name: "DeepSeek V4 Flash",
          shortName: "V4 Flash",
          isDefault: true,
          isCustom: false,
        }),
        expect.objectContaining({
          slug: "deepseek-v4-pro",
          name: "DeepSeek V4 Pro",
          shortName: "V4 Pro",
          isDefault: false,
          isCustom: false,
        }),
      ]);
      expect(snapshot).not.toHaveProperty("installed");
      expect(snapshot).not.toHaveProperty("version");
      expect(snapshot).not.toHaveProperty("updateState");
    }),
  );

  it.effect("reports ready authenticated state for a private runtime projection", () =>
    Effect.gen(function* () {
      const snapshot = yield* snapshotFor(true);
      expect(snapshot).toMatchObject({
        status: "ready",
        auth: { status: "authenticated", type: "fd-account", label: "FD Account" },
      });
      expect(snapshot).not.toHaveProperty("message");
      expect(snapshot).not.toHaveProperty("runtimeApiKey");
      expect(snapshot).not.toHaveProperty("accessToken");
      expect(snapshot).not.toHaveProperty("newApiOrigin");
    }),
  );

  it.effect("refreshes permission-filtered FD Skill summaries when credentials arrive", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* makeStore();
        const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
          async () =>
            new Response(
              JSON.stringify({
                data: {
                  skills: [
                    {
                      id: 4,
                      version_id: 10004,
                      name: "company-database-query",
                      display_name: "管理部数据查询",
                      description: "查询管理部授权数据",
                      kind: "database",
                      risk_tier: "high",
                    },
                  ],
                  model_capabilities: {
                    "deepseek-v4-flash": {
                      fd_skills: true,
                      fd_skill_protocol: "enterprise-agent-v1",
                    },
                  },
                },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
        );
        const instance = yield* FdDeepSeekDriver.create({
          instanceId: FD_DEEPSEEK_INSTANCE_ID,
          displayName: undefined,
          environment: [],
          enabled: true,
          config: {},
        }).pipe(
          Effect.provideService(FdRuntimeCredentialStore, store.service),
          Effect.provideService(WorkspaceFileSystem.WorkspaceFileSystem, workspaceFileSystem),
          Effect.provideService(WorkspaceEntries.WorkspaceEntries, workspaceEntries),
          Effect.provideService(ProcessRunner.ProcessRunner, processRunner),
          Effect.provideService(VcsProcess.VcsProcess, vcsProcess),
          Effect.provide(attachmentLayer),
        );
        const nextSnapshot = yield* Stream.runHead(instance.snapshot.streamChanges).pipe(
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        yield* store.apply({ version: 1, type: "set", credentials });
        const snapshot = yield* Fiber.join(nextSnapshot);
        expect(Option.isSome(snapshot)).toBe(true);
        if (Option.isSome(snapshot)) {
          expect(snapshot.value.skills).toContainEqual(
            expect.objectContaining({
              name: "company-database-query",
              path: "fd-managed://10004",
              scope: "fd-managed",
            }),
          );
        }
        expect(fetch).toHaveBeenCalledWith(
          expect.objectContaining({ pathname: "/api/fd-skills/self" }),
          expect.anything(),
        );
        fetch.mockRestore();
      }),
    ),
  );

  it.effect("preserves the last authoritative FD Skill snapshot when refresh fails", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* makeStore();
        yield* store.apply({ version: 1, type: "set", credentials });
        let catalogAvailable = true;
        const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
          if (!catalogAvailable) throw new Error("catalog temporarily unavailable");
          return new Response(
            JSON.stringify({
              data: {
                skills: [
                  {
                    id: 4,
                    version_id: 10004,
                    name: "company-database-query",
                    display_name: "管理部数据查询",
                    description: "查询管理部授权数据",
                  },
                ],
                model_capabilities: {
                  "deepseek-v4-flash": {
                    fd_skills: true,
                    fd_skill_protocol: "enterprise-agent-v1",
                  },
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        });
        const instance = yield* FdDeepSeekDriver.create({
          instanceId: FD_DEEPSEEK_INSTANCE_ID,
          displayName: undefined,
          environment: [],
          enabled: true,
          config: {},
        }).pipe(
          Effect.provideService(FdRuntimeCredentialStore, store.service),
          Effect.provideService(WorkspaceFileSystem.WorkspaceFileSystem, workspaceFileSystem),
          Effect.provideService(WorkspaceEntries.WorkspaceEntries, workspaceEntries),
          Effect.provideService(ProcessRunner.ProcessRunner, processRunner),
          Effect.provideService(VcsProcess.VcsProcess, vcsProcess),
          Effect.provide(attachmentLayer),
        );
        expect((yield* instance.snapshot.getSnapshot).skillCatalogState).toBe("ready");

        catalogAvailable = false;
        const nextSnapshot = yield* Stream.runHead(instance.snapshot.streamChanges).pipe(
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        yield* store.apply({
          version: 1,
          type: "set",
          credentials: { ...credentials, generation: 2, accessToken: "refreshed" },
        });
        const snapshot = yield* Fiber.join(nextSnapshot);

        expect(Option.isSome(snapshot)).toBe(true);
        if (Option.isSome(snapshot)) {
          expect(snapshot.value.skillCatalogState).toBe("error");
          expect(snapshot.value.skills).toContainEqual(
            expect.objectContaining({ path: "fd-managed://10004", scope: "fd-managed" }),
          );
        }

        const switchedSnapshot = yield* Stream.runHead(instance.snapshot.streamChanges).pipe(
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        yield* store.apply({
          version: 1,
          type: "set",
          credentials: {
            ...credentials,
            userId: 2,
            generation: 3,
            accessToken: "other-user",
          },
        });
        const switched = yield* Fiber.join(switchedSnapshot);
        expect(Option.isSome(switched)).toBe(true);
        if (Option.isSome(switched)) {
          expect(switched.value.skillCatalogState).toBe("error");
          expect(switched.value.skills).not.toContainEqual(
            expect.objectContaining({ scope: "fd-managed" }),
          );
        }
      }),
    ),
  );

  it.effect("keeps sessions and enterprise overlays during an equivalent credential refresh", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* makeStore();
        yield* store.apply({ version: 1, type: "set", credentials });
        const runtime = yield* FdEnterpriseThreadRuntime;
        const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
          async () =>
            new Response(
              JSON.stringify({
                data: {
                  skills: [],
                  model_capabilities: {
                    "deepseek-v4-flash": {
                      fd_skills: true,
                      fd_skill_protocol: "enterprise-agent-v1",
                    },
                  },
                },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
        );
        const instance = yield* FdDeepSeekDriver.create({
          instanceId: FD_DEEPSEEK_INSTANCE_ID,
          displayName: undefined,
          environment: [],
          enabled: true,
          config: {},
        }).pipe(
          Effect.provideService(FdRuntimeCredentialStore, store.service),
          Effect.provideService(WorkspaceFileSystem.WorkspaceFileSystem, workspaceFileSystem),
          Effect.provideService(WorkspaceEntries.WorkspaceEntries, workspaceEntries),
          Effect.provideService(ProcessRunner.ProcessRunner, processRunner),
          Effect.provideService(VcsProcess.VcsProcess, vcsProcess),
          Effect.provide(attachmentLayer),
        );
        const threadId = ThreadId.make("550e8400-e29b-41d4-a716-446655440099");
        yield* runtime.stageTurn({
          threadId,
          messageId: MessageId.make("message-account-a"),
          text: "账号 A 的企业查询",
          createdAt: "2026-08-10T00:00:00.000Z",
        });
        yield* instance.adapter.startSession({
          provider: FD_DEEPSEEK_DRIVER_KIND,
          providerInstanceId: FD_DEEPSEEK_INSTANCE_ID,
          threadId,
          runtimeMode: "full-access",
        });
        const nextSnapshot = yield* Stream.runHead(instance.snapshot.streamChanges).pipe(
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        yield* store.apply({
          version: 1,
          type: "set",
          credentials: {
            ...credentials,
            accessToken: "rotated-access-token",
            generation: 2,
          },
        });
        yield* Fiber.join(nextSnapshot);

        expect((yield* runtime.getSnapshot(threadId)).messages).toHaveLength(1);
        expect(yield* instance.adapter.hasSession(threadId)).toBe(true);

        const switchedSnapshot = yield* Stream.runHead(instance.snapshot.streamChanges).pipe(
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        yield* store.apply({
          version: 1,
          type: "set",
          credentials: {
            ...credentials,
            userId: 2,
            runtimeTokenId: 2,
            runtimeApiKey: "other-user-runtime-key",
            accessToken: "other-user-access-token",
            generation: 3,
          },
        });
        yield* Fiber.join(switchedSnapshot);

        expect((yield* runtime.getSnapshot(threadId)).messages).toEqual([]);
        expect(yield* instance.adapter.hasSession(threadId)).toBe(false);
        fetch.mockRestore();
      }),
    ).pipe(Effect.provide(FdEnterpriseThreadRuntimeLive)),
  );

  it.effect("includes managed FD Skills in the first authenticated snapshot", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* makeStore();
        yield* store.apply({ version: 1, type: "set", credentials });
        const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
          async () =>
            new Response(
              JSON.stringify({
                data: {
                  skills: [
                    {
                      id: 4,
                      version_id: 10004,
                      name: "company-database-query",
                      display_name: "管理部数据查询",
                      description: "查询管理部授权数据",
                    },
                  ],
                  model_capabilities: {
                    "deepseek-v4-flash": {
                      fd_skills: true,
                      fd_skill_protocol: "enterprise-agent-v1",
                    },
                  },
                },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
        );
        const instance = yield* FdDeepSeekDriver.create({
          instanceId: FD_DEEPSEEK_INSTANCE_ID,
          displayName: undefined,
          environment: [],
          enabled: true,
          config: {},
        }).pipe(
          Effect.provideService(FdRuntimeCredentialStore, store.service),
          Effect.provideService(WorkspaceFileSystem.WorkspaceFileSystem, workspaceFileSystem),
          Effect.provideService(WorkspaceEntries.WorkspaceEntries, workspaceEntries),
          Effect.provideService(ProcessRunner.ProcessRunner, processRunner),
          Effect.provideService(VcsProcess.VcsProcess, vcsProcess),
          Effect.provide(attachmentLayer),
        );

        const snapshot = yield* instance.snapshot.getSnapshot;
        expect(snapshot.skills).toContainEqual(
          expect.objectContaining({
            path: "fd-managed://10004",
            scope: "fd-managed",
          }),
        );
        fetch.mockRestore();
      }),
    ),
  );

  it.effect(
    "hides managed FD Skills when the exact model capability is disabled or incompatible",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          let capability: { fd_skills: boolean; fd_skill_protocol: string } = {
            fd_skills: false,
            fd_skill_protocol: "enterprise-agent-v1",
          };
          const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
            async () =>
              new Response(
                JSON.stringify({
                  data: {
                    skills: [
                      {
                        id: 4,
                        version_id: 10004,
                        name: "company-database-query",
                        display_name: "管理部数据查询",
                        description: "查询管理部授权数据",
                      },
                    ],
                    model_capabilities: { "deepseek-v4-flash": capability },
                  },
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
          );

          for (const deniedCapability of [
            { fd_skills: false, fd_skill_protocol: "enterprise-agent-v1" },
            { fd_skills: true, fd_skill_protocol: "enterprise-agent-v2" },
          ]) {
            capability = deniedCapability;
            const store = yield* makeStore();
            yield* store.apply({ version: 1, type: "set", credentials });
            const instance = yield* FdDeepSeekDriver.create({
              instanceId: FD_DEEPSEEK_INSTANCE_ID,
              displayName: undefined,
              environment: [],
              enabled: true,
              config: {},
            }).pipe(
              Effect.provideService(FdRuntimeCredentialStore, store.service),
              Effect.provideService(WorkspaceFileSystem.WorkspaceFileSystem, workspaceFileSystem),
              Effect.provideService(WorkspaceEntries.WorkspaceEntries, workspaceEntries),
              Effect.provideService(ProcessRunner.ProcessRunner, processRunner),
              Effect.provideService(VcsProcess.VcsProcess, vcsProcess),
              Effect.provide(attachmentLayer),
            );
            const snapshot = yield* instance.snapshot.getSnapshot;
            expect(snapshot.skills).not.toContainEqual(
              expect.objectContaining({ scope: "fd-managed" }),
            );
          }
          fetch.mockRestore();
        }),
      ),
  );
});
