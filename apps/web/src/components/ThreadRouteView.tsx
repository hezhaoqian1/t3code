import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import ChatView from "./ChatView";
import { threadHasStarted } from "./ChatView.logic";
import { waitForDraftHeroTransition } from "./chat/draftHeroTransition";
import { SidebarInset } from "./ui/sidebar";
import {
  finalizePromotedDraftThreadByRef,
  markPromotedDraftThreadByRef,
  useComposerDraftStore,
} from "../composerDraftStore";
import {
  usePrimaryThreadRefs,
  useThread,
  useThreadDetail,
  useThreadShell,
  useThreadStatus,
} from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { environmentShell } from "../state/shell";
import {
  buildThreadRouteParams,
  resolveThreadRouteRedirect,
  resolveThreadRouteRenderState,
  type ThreadRouteTarget,
} from "../threadRoutes";
import { resolveThreadSyncPhase } from "../threadSync";

/**
 * The single chat surface behind both `/draft/$draftId` and `/$threadId`
 * (ported from upstream t3code 0f5a1513e0 and d073c261b).
 *
 * Each draft gets its own ChatView instance, and that instance carries the
 * draft through its promotion to a server thread: the thread route keeps
 * keying by the draft id while the draft record exists, so the route swap only
 * changes props. The view is not torn down and rebuilt when a new task's first
 * message lands, so its timeline, composer focus and sending state stay put.
 * Plain server threads are unkeyed, so navigating between them reuses one
 * instance as ChatView expects.
 *
 * Rendered by the `_chat` layout rather than by the two leaf routes, since an
 * element only survives a route swap when the same parent renders it.
 */
export function ThreadRouteView({ target }: { target: ThreadRouteTarget }) {
  const navigate = useNavigate();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const draftId = target.kind === "draft" ? target.draftId : null;
  const storedDraftSession = useComposerDraftStore((store) =>
    draftId === null ? null : store.getDraftSession(draftId),
  );
  const draftSession =
    storedDraftSession?.environmentId === primaryEnvironmentId ? storedDraftSession : null;
  const threadRefs = usePrimaryThreadRefs();
  // The server thread this view is about: the route's own ref, or the draft's
  // reserved ref once the server knows it.
  const inferredThreadRef = draftSession
    ? (threadRefs.find(
        (ref) =>
          ref.environmentId === draftSession.environmentId &&
          ref.threadId === draftSession.threadId,
      ) ?? null)
    : null;
  const serverThreadRef: ScopedThreadRef | null =
    target.kind === "server" ? target.threadRef : (draftSession?.promotedTo ?? inferredThreadRef);
  const serverThread = useThread(target.kind === "draft" ? serverThreadRef : null);
  const canonicalThreadRef =
    target.kind === "draft" && threadHasStarted(serverThread) ? serverThreadRef : null;

  const shell = useEnvironmentQuery(
    serverThreadRef === null ? null : environmentShell.stateAtom(serverThreadRef.environmentId),
  );
  const serverThreadShell = useThreadShell(target.kind === "server" ? serverThreadRef : null);
  const serverThreadDetail = useThreadDetail(target.kind === "server" ? serverThreadRef : null);
  const serverThreadStatus = useThreadStatus(target.kind === "server" ? serverThreadRef : null);
  const bootstrapComplete = shell.data?.snapshot._tag === "Some";
  const draftThread = useComposerDraftStore((store) =>
    target.kind === "server" ? store.getDraftThreadByRef(target.threadRef) : null,
  );
  const promotedDraftId = useComposerDraftStore((store) =>
    target.kind === "server" ? store.getDraftIdByRef(target.threadRef) : null,
  );
  // The draft record is removed once the promoted thread has started, which
  // can be after the route swap. Latch the key so the element that carried the
  // draft keeps its identity for as long as this thread stays on screen.
  const [chatViewKey, setChatViewKey] = useState<{ threadKey: string; key: string } | null>(null);
  const serverThreadKey = target.kind === "server" ? scopedThreadKey(target.threadRef) : null;
  const nextChatViewKey =
    serverThreadKey === null
      ? null
      : chatViewKey?.threadKey === serverThreadKey
        ? chatViewKey
        : promotedDraftId
          ? { threadKey: serverThreadKey, key: promotedDraftId }
          : null;
  if (nextChatViewKey !== chatViewKey) {
    setChatViewKey(nextChatViewKey);
  }
  const renderState = resolveThreadRouteRenderState({
    bootstrapComplete,
    serverThreadShellExists: serverThreadShell !== null,
    serverThreadDetailExists: serverThreadDetail !== null,
    serverThreadDetailDeleted: serverThreadStatus === "deleted",
    draftThreadExists: draftThread !== null,
  });
  const threadSyncPhase = resolveThreadSyncPhase({
    detailExists: serverThreadDetail !== null,
    shellExists: serverThreadShell !== null,
    status: serverThreadStatus,
  });
  const serverThreadStarted = threadHasStarted(serverThreadDetail);

  // Draft route: record the promotion as soon as the server lists the thread.
  useEffect(() => {
    if (!inferredThreadRef || draftSession?.promotedTo) {
      return;
    }
    markPromotedDraftThreadByRef(inferredThreadRef);
  }, [draftSession?.promotedTo, inferredThreadRef]);

  // Draft route: move to the thread's own route once it has started. The
  // ChatView below keeps its key (the draft id) across the swap.
  useEffect(() => {
    if (!canonicalThreadRef) {
      return;
    }
    let cancelled = false;
    void waitForDraftHeroTransition().then(() => {
      if (cancelled) {
        return;
      }
      void navigate({
        to: "/$threadId",
        params: buildThreadRouteParams(canonicalThreadRef),
        replace: true,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [canonicalThreadRef, navigate]);

  // Draft route whose draft is gone (deleted elsewhere): back to the start page.
  useEffect(() => {
    if (target.kind !== "draft" || draftSession || canonicalThreadRef) {
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [canonicalThreadRef, draftSession, navigate, target.kind]);

  // Thread route: a thread that turned out to be missing goes back to start.
  useEffect(() => {
    if (target.kind !== "server") {
      return;
    }
    const redirect = resolveThreadRouteRedirect({ bootstrapComplete, renderState });
    if (redirect !== null) {
      void navigate({ to: redirect, replace: true });
    }
  }, [bootstrapComplete, navigate, renderState, target.kind]);

  // Thread route: drop the draft record once the promoted thread has started.
  useEffect(() => {
    if (target.kind !== "server" || !serverThreadStarted || !draftThread) {
      return;
    }
    finalizePromotedDraftThreadByRef(target.threadRef);
  }, [draftThread, serverThreadStarted, target]);

  let view: React.ReactNode = null;
  if (target.kind === "draft") {
    if (draftSession) {
      view = (
        <ChatView
          key={target.draftId}
          draftId={target.draftId}
          environmentId={draftSession.environmentId}
          threadId={draftSession.threadId}
          routeKind="draft"
          forceExpandedMobileComposer
        />
      );
    }
  } else if (renderState === "ready" || (renderState === "loading" && serverThreadShell !== null)) {
    view = (
      <ChatView
        key={nextChatViewKey?.key}
        environmentId={target.threadRef.environmentId}
        threadId={target.threadRef.threadId}
        routeKind="server"
        threadSyncPhase={threadSyncPhase}
      />
    );
  }

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      {view}
    </SidebarInset>
  );
}
