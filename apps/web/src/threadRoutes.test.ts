import { describe, expect, it } from "vite-plus/test";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId } from "@t3tools/contracts";
import { DraftId } from "./composerDraftStore";

import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  resolveActiveThreadRouteRef,
  resolveThreadRouteRedirect,
  resolveThreadRouteRenderState,
  resolveThreadRouteRef,
  resolveThreadRouteTarget,
} from "./threadRoutes";

describe("threadRoutes", () => {
  it("builds canonical thread route params from a scoped ref", () => {
    const ref = scopeThreadRef("env-1" as never, ThreadId.make("thread-1"));

    expect(buildThreadRouteParams(ref)).toEqual({
      threadId: "thread-1",
    });
  });

  it("scopes a route thread id to the primary environment", () => {
    expect(resolveThreadRouteRef({ threadId: "thread-1" }, "env-1" as never)).toEqual({
      environmentId: "env-1",
      threadId: "thread-1",
    });

    expect(resolveThreadRouteRef({}, "env-1" as never)).toBeNull();
    expect(resolveThreadRouteRef({ threadId: "thread-1" }, null)).toBeNull();
  });

  it("builds canonical draft route params from a draft id", () => {
    expect(buildDraftThreadRouteParams(DraftId.make("draft-1"))).toEqual({
      draftId: "draft-1",
    });
  });

  it("resolves draft and server route targets", () => {
    expect(
      resolveThreadRouteTarget(
        {
          threadId: "thread-1",
        },
        "env-1" as never,
      ),
    ).toEqual({
      kind: "server",
      threadRef: {
        environmentId: "env-1",
        threadId: "thread-1",
      },
    });

    expect(resolveThreadRouteTarget({ draftId: "draft-1" }, "env-1" as never)).toEqual({
      kind: "draft",
      draftId: "draft-1",
    });
  });

  it("resolves the backing thread while a draft route is being promoted", () => {
    const target = resolveThreadRouteTarget({ draftId: "draft-1" }, "env-1" as never);

    expect(
      resolveActiveThreadRouteRef(target, {
        environmentId: "env-1" as never,
        threadId: ThreadId.make("draft-thread"),
        promotedTo: scopeThreadRef("env-2" as never, ThreadId.make("server-thread")),
      }),
    ).toEqual({
      environmentId: "env-2",
      threadId: "server-thread",
    });
  });

  it("does not treat a draft's reserved thread ref as an active sidebar thread", () => {
    const target = resolveThreadRouteTarget({ draftId: "draft-1" }, "env-1" as never);

    expect(
      resolveActiveThreadRouteRef(target, {
        environmentId: "env-1" as never,
        threadId: ThreadId.make("draft-thread"),
        promotedTo: null,
      }),
    ).toBeNull();
  });

  it("keeps shell-only server threads in the loading state", () => {
    expect(
      resolveThreadRouteRenderState({
        bootstrapComplete: true,
        serverThreadShellExists: true,
        serverThreadDetailExists: false,
        serverThreadDetailDeleted: false,
        draftThreadExists: false,
      }),
    ).toBe("loading");
  });

  it("renders server details and local drafts when they are ready", () => {
    expect(
      resolveThreadRouteRenderState({
        bootstrapComplete: true,
        serverThreadShellExists: true,
        serverThreadDetailExists: true,
        serverThreadDetailDeleted: false,
        draftThreadExists: false,
      }),
    ).toBe("ready");
    expect(
      resolveThreadRouteRenderState({
        bootstrapComplete: true,
        serverThreadShellExists: false,
        serverThreadDetailExists: false,
        serverThreadDetailDeleted: false,
        draftThreadExists: true,
      }),
    ).toBe("ready");
  });

  it("distinguishes bootstrap loading from a missing thread", () => {
    expect(
      resolveThreadRouteRenderState({
        bootstrapComplete: false,
        serverThreadShellExists: false,
        serverThreadDetailExists: false,
        serverThreadDetailDeleted: false,
        draftThreadExists: false,
      }),
    ).toBe("loading");
    expect(
      resolveThreadRouteRenderState({
        bootstrapComplete: true,
        serverThreadShellExists: false,
        serverThreadDetailExists: false,
        serverThreadDetailDeleted: false,
        draftThreadExists: false,
      }),
    ).toBe("missing");
  });

  it("redirects deleted shell-only threads", () => {
    expect(
      resolveThreadRouteRenderState({
        bootstrapComplete: true,
        serverThreadShellExists: true,
        serverThreadDetailExists: false,
        serverThreadDetailDeleted: true,
        draftThreadExists: false,
      }),
    ).toBe("missing");
  });

  it.each(["pair", "connect", "unknown-thread"])(
    "redirects /%s after an empty snapshot resolves it as missing",
    (threadId) => {
      expect(resolveThreadRouteRef({ threadId }, "env-1" as never)).not.toBeNull();
      const renderState = resolveThreadRouteRenderState({
        bootstrapComplete: true,
        serverThreadShellExists: false,
        serverThreadDetailExists: false,
        serverThreadDetailDeleted: false,
        draftThreadExists: false,
      });

      expect(resolveThreadRouteRedirect({ bootstrapComplete: true, renderState })).toBe("/");
    },
  );

  it("redirects a missing thread even when its server shell previously existed", () => {
    const renderState = resolveThreadRouteRenderState({
      bootstrapComplete: true,
      serverThreadShellExists: true,
      serverThreadDetailExists: false,
      serverThreadDetailDeleted: true,
      draftThreadExists: false,
    });

    expect(resolveThreadRouteRedirect({ bootstrapComplete: true, renderState })).toBe("/");
  });

  it("does not redirect while loading or when the thread is ready", () => {
    expect(
      resolveThreadRouteRedirect({ bootstrapComplete: false, renderState: "loading" }),
    ).toBeNull();
    expect(
      resolveThreadRouteRedirect({ bootstrapComplete: true, renderState: "loading" }),
    ).toBeNull();
    expect(
      resolveThreadRouteRedirect({ bootstrapComplete: true, renderState: "ready" }),
    ).toBeNull();
  });
});
