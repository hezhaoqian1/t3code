import type { ScopedProjectRef } from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { ChevronDownIcon, FolderIcon, FolderPlusIcon } from "lucide-react";
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
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";

export function WorkspacePicker({
  activeProjectRef,
  activeProjectTitle,
}: {
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
}) {
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
  const label = activeProjectDisplayName ?? "选择工作空间";

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 max-w-56 shrink-0 gap-1.5 rounded-lg border-border/80 bg-background/65 px-2.5 text-xs font-medium shadow-xs hover:bg-accent"
            aria-label={activeProjectDisplayName ? "切换工作空间" : "选择工作空间"}
            title={activeProjectDisplayName ?? undefined}
          />
        }
      >
        <FolderIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-60" aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="start" className="max-h-80 min-w-52 w-max max-w-72 overflow-y-auto">
        {projectPickerEntries.length > 0 ? (
          <MenuRadioGroup
            value={activeProjectKey}
            onValueChange={(value) => {
              const entry = projectEntryByKey.get(value as string);
              if (!entry || value === activeProjectKey) return;
              void handleNewThread(
                scopeProjectRef(entry.targetProject.environmentId, entry.targetProject.id),
                {
                  replace: true,
                },
              );
            }}
          >
            {projectPickerEntries.map(({ group }) => (
              <MenuRadioItem key={group.projectKey} value={group.projectKey} closeOnClick>
                <FolderIcon />
                <span className="block min-w-0 truncate" title={group.displayName}>
                  {group.displayName}
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        ) : (
          <div className="px-2.5 py-2 text-xs text-muted-foreground">暂无可用工作空间</div>
        )}
        <MenuSeparator />
        <MenuItem onClick={openAddProject}>
          <FolderPlusIcon />
          导入工作空间
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
