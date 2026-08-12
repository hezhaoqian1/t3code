import type { ScopedProjectRef } from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { FolderIcon, FolderPlusIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useAtomValue } from "@effect/atom-react";

import { openCommandPalette } from "~/commandPaletteBus";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useClientSettings } from "~/hooks/useSettings";
import { selectProjectGroupingSettings } from "~/logicalProject";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
} from "~/sidebarProjectGrouping";
import { usePrimaryProjects, usePrimaryThreadShells } from "~/state/entities";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { primaryServerWelcomeAtom } from "~/state/server";
import { isElectron } from "~/env";
import { excludeOfficeWorkspaceProjects } from "~/officeMode";
import { sortLogicalProjectsForSidebar } from "../Sidebar.logic";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";

interface DraftHeroHeadlineProps {
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
  readonly officeMode?: boolean;
}

export function DraftHeroHeadline({
  activeProjectRef,
  activeProjectTitle,
  officeMode = false,
}: DraftHeroHeadlineProps) {
  const projects = usePrimaryProjects();
  const primaryServerWelcome = useAtomValue(primaryServerWelcomeAtom);
  const threads = usePrimaryThreadShells();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projectSortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const handleNewThread = useNewThreadHandler();
  const openAddProject = useCallback(() => openCommandPalette({ open: "add-project" }), []);
  const visibleProjects = useMemo(
    () =>
      excludeOfficeWorkspaceProjects({
        isDesktop: isElectron,
        projects,
        bootstrapProjectId: primaryServerWelcome?.bootstrapProjectId,
        bootstrapEnvironmentId: primaryServerWelcome?.environment.environmentId,
      }),
    [primaryServerWelcome, projects],
  );

  const projectGroups = useMemo(
    () =>
      sortLogicalProjectsForSidebar(
        buildSidebarProjectSnapshots({
          projects: visibleProjects,
          settings: projectGroupingSettings,
          primaryEnvironmentId,
        }),
        threads,
        projectSortOrder,
      ),
    [primaryEnvironmentId, projectGroupingSettings, projectSortOrder, threads, visibleProjects],
  );
  const projectPickerEntries = useMemo(
    () =>
      buildSidebarProjectPickerEntries({
        groups: projectGroups,
        preferredProjectRef: activeProjectRef,
      }),
    [activeProjectRef, projectGroups],
  );
  const projectEntryByKey = useMemo(
    () => new Map(projectPickerEntries.map((entry) => [entry.group.projectKey, entry] as const)),
    [projectPickerEntries],
  );
  const activeProjectGroup =
    activeProjectRef === null
      ? null
      : (projectGroups.find((group) =>
          group.memberProjectRefs.some(
            (projectRef) => scopedProjectKey(projectRef) === scopedProjectKey(activeProjectRef),
          ),
        ) ?? null);
  const activeProjectKey = activeProjectGroup?.projectKey ?? "";
  const activeProjectDisplayName = activeProjectGroup?.displayName ?? activeProjectTitle;
  const hasResolvedProject = activeProjectTitle !== null;
  const canChooseProject = projectPickerEntries.length > 0;
  const shouldShowProjectMenu = canChooseProject;

  const projectSelector = shouldShowProjectMenu ? (
    <Menu>
      <MenuTrigger
        aria-label={hasResolvedProject ? "切换工作空间" : "选择工作空间"}
        className="pointer-events-auto inline-block max-w-64 truncate border-foreground/60 border-b border-dotted align-bottom text-foreground transition-colors hover:border-foreground/80 focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        title={activeProjectDisplayName ?? undefined}
      >
        {activeProjectDisplayName ?? "选择工作空间"}
      </MenuTrigger>
      <MenuPopup align="center" className="max-h-80 min-w-40! w-max max-w-64 overflow-y-auto">
        <MenuRadioGroup
          value={activeProjectKey}
          onValueChange={(value) => {
            const entry = projectEntryByKey.get(value as string);
            if (!entry || value === activeProjectKey) {
              return;
            }
            const project = entry.targetProject;
            void handleNewThread(scopeProjectRef(project.environmentId, project.id), {
              replace: true,
            });
          }}
        >
          {projectPickerEntries.map(({ group }) => {
            return (
              <MenuRadioItem key={group.projectKey} value={group.projectKey} closeOnClick>
                <span className="block min-w-0 truncate" title={group.displayName}>
                  {group.displayName}
                </span>
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem onClick={openAddProject}>
          <FolderPlusIcon />
          导入工作空间
        </MenuItem>
      </MenuPopup>
    </Menu>
  ) : (
    <button
      type="button"
      onClick={openAddProject}
      className="pointer-events-auto inline cursor-pointer border-muted-foreground/35 border-b border-dotted text-muted-foreground/60 transition-colors hover:border-muted-foreground/60 hover:text-muted-foreground/80 focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      {activeProjectTitle ?? "导入工作空间"}
    </button>
  );

  if (officeMode) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-4 text-center">
        <h1 className="font-normal text-2xl text-foreground sm:text-3xl">今天想处理什么？</h1>
        <Menu>
          <MenuTrigger className="pointer-events-auto inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
            <FolderIcon className="size-4" />
            选择工作空间
          </MenuTrigger>
          <MenuPopup align="center" className="max-h-80 min-w-48 overflow-y-auto">
            {projectPickerEntries.map(({ group, targetProject }) => (
              <MenuItem
                key={group.projectKey}
                onClick={() => {
                  void handleNewThread(
                    scopeProjectRef(targetProject.environmentId, targetProject.id),
                    { replace: true },
                  );
                }}
              >
                <FolderIcon />
                <span className="min-w-0 truncate" title={group.displayName}>
                  {group.displayName}
                </span>
              </MenuItem>
            ))}
            {projectPickerEntries.length > 0 ? <MenuSeparator /> : null}
            <MenuItem onClick={openAddProject}>
              <FolderPlusIcon />
              导入工作空间
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    );
  }

  return (
    <h1 className="mx-auto w-full max-w-5xl text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
      {hasResolvedProject ? (
        <>想在 {projectSelector} 中完成什么？</>
      ) : canChooseProject ? (
        <>选择 {projectSelector} 开始</>
      ) : (
        <>导入工作空间后开始</>
      )}
    </h1>
  );
}
