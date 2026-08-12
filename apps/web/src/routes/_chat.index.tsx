import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useAtomValue } from "@effect/atom-react";
import { createFileRoute } from "@tanstack/react-router";
import { RotateCcwIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { usePrimaryEnvironmentShellBootstrapped, usePrimaryProjects } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { primaryServerWelcomeAtom } from "../state/server";
import { isElectron } from "../env";
import { findOfficeWorkspaceProject } from "../officeMode";

function ChatIndexRouteView() {
  return <IndexDraftLanding />;
}

/**
 * The Desktop index route stages an unsent task against the trusted bootstrap
 * project. The server replaces that placeholder with a dedicated task project
 * and directory on first send.
 */
function IndexDraftLanding() {
  const projects = usePrimaryProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const serverWelcome = useAtomValue(primaryServerWelcomeAtom);
  const bootstrapped = usePrimaryEnvironmentShellBootstrapped();
  const handleNewThread = useNewThreadHandler();
  const startingRef = useRef(false);
  const [startState, setStartState] = useState({ failed: false, retryRequest: 0 });

  const defaultProject = useMemo(() => {
    if (!bootstrapped || primaryEnvironmentId === null) return null;
    const officeProject = findOfficeWorkspaceProject({
      isDesktop: isElectron,
      projects,
      bootstrapProjectId: serverWelcome?.bootstrapProjectId,
      bootstrapEnvironmentId: serverWelcome?.environment.environmentId,
    });
    return officeProject;
  }, [bootstrapped, primaryEnvironmentId, projects, serverWelcome]);

  useEffect(() => {
    if (defaultProject === null || startingRef.current) {
      return;
    }
    startingRef.current = true;
    void handleNewThread(scopeProjectRef(defaultProject.environmentId, defaultProject.id), {
      replace: true,
      taskArea: true,
    }).catch(() => {
      startingRef.current = false;
      setStartState((state) => ({ ...state, failed: true }));
    });
  }, [defaultProject, handleNewThread, startState.retryRequest]);

  if (!bootstrapped) {
    return null;
  }
  if (defaultProject !== null) {
    return startState.failed ? (
      <DraftStartError
        onRetry={() => {
          setStartState((state) => ({
            failed: false,
            retryRequest: state.retryRequest + 1,
          }));
        }}
      />
    ) : null;
  }
  return <TaskAreaBootstrapError />;
}

function DraftStartError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle className="text-foreground text-xl">无法开始新对话</EmptyTitle>
          <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
            工作区仍然可用，请重试。
          </EmptyDescription>
          <div className="mt-5 flex justify-center">
            <Button size="sm" onClick={onRetry}>
              <RotateCcwIcon className="size-4" />
              重试
            </Button>
          </div>
        </EmptyHeader>
      </Empty>
    </SidebarInset>
  );
}

function TaskAreaBootstrapError() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <Empty className="flex-1">
          <div className="w-full max-w-lg px-8 py-12">
            <EmptyHeader className="max-w-none">
              <EmptyTitle className="text-foreground text-2xl sm:text-3xl">
                任务区暂不可用
              </EmptyTitle>
              <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
                请等待桌面应用完成初始化，或重启应用后重试。
              </EmptyDescription>
              <div className="mt-5 flex justify-center">
                <Button size="sm" onClick={() => window.location.reload()}>
                  <RotateCcwIcon className="size-4" />
                  重试
                </Button>
              </div>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
