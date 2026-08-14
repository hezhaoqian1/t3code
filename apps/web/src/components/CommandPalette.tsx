"use client";

import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { canCreateProjectInEnvironment } from "@t3tools/client-runtime/operations/projects";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import {
  canPreloadBrowsePath,
  createBrowseNavigationCoordinator,
  filterFilesystemBrowseEntries,
  getFilesystemBrowsePath,
} from "@t3tools/client-runtime/state/filesystem";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  type FilesystemBrowseResult,
  type ProjectId,
  type SourceControlDiscoveryResult,
  type SourceControlProviderKind,
  type SourceControlRepositoryInfo,
} from "@t3tools/contracts";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import * as Option from "effect/Option";
import {
  ArrowLeftIcon,
  CornerLeftUpIcon,
  FileSearchIcon,
  FolderIcon,
  FolderPlusIcon,
  LinkIcon,
  MessageSquareIcon,
  PaletteIcon,
  SettingsIcon,
  SquarePenIcon,
  TextSearchIcon,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useAtomValue } from "@effect/atom-react";

import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useClientSettings } from "../hooks/useSettings";
import { useTheme } from "../hooks/useTheme";
import { isElectron } from "../env";
import { readLocalApi } from "../localApi";
import { filesystemEnvironment } from "../state/filesystem";
import { projectEnvironment } from "../state/projects";
import { useEnvironmentQuery } from "../state/query";
import { sourceControlEnvironment } from "../state/sourceControl";
import { useAtomCommand } from "../state/use-atom-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { usePrimaryEnvironment, usePrimaryEnvironmentId } from "../state/environments";
import { usePrimaryProjects, usePrimaryThreadShells } from "../state/entities";
import { useThreadSearch } from "../state/queries";
import { resolveThreadActionProjectRef, startNewThreadFromContext } from "../lib/chatThreadActions";
import {
  appendBrowsePathSegment,
  ensureBrowseDirectoryPath,
  findProjectByPath,
  getBrowseDirectoryPath,
  hasTrailingPathSeparator,
  inferProjectTitleFromPath,
  isExplicitRelativeProjectPath,
  isUnsupportedWindowsProjectPath,
  resolveProjectPathForDispatch,
} from "../lib/projectPaths";
import { onOpenCommandPalette } from "../commandPaletteBus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { getLatestThreadForProject, sortThreads } from "../lib/threadSort";
import { cn, isMacPlatform, isWindowsPlatform, newProjectId } from "../lib/utils";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../threadRoutes";
import {
  ADDON_ICON_CLASS,
  buildBrowseGroups,
  buildProjectActionItems,
  buildRootGroups,
  buildThreadActionItems,
  enumerateCommandPaletteItems,
  type CommandPaletteActionItem,
  type CommandPaletteOpenIntent,
  type CommandPaletteSubmenuItem,
  type CommandPaletteView,
  filterCommandPaletteGroups,
  getCommandPaletteInputPlaceholder,
  getCommandPaletteMode,
  ITEM_ICON_CLASS,
  RECENT_THREAD_LIMIT,
  reduceCommandPaletteUiState,
  shouldUseNativeFolderPicker,
  type SearchOverlayMode,
} from "./CommandPalette.logic";
import { orderItemsByPreferredIds, sortLogicalProjectsForSidebar } from "./Sidebar.logic";
import { CommandPaletteContent } from "./CommandPaletteContent";
import { CommandPaletteResults } from "./CommandPaletteResults";
import { AzureDevOpsIcon, BitbucketIcon, GitHubIcon, GitLabIcon } from "./Icons";
import { ProjectFavicon } from "./ProjectFavicon";
import { ProjectFilePicker } from "./files/ProjectFilePicker";
import { ProjectContentSearchDialog } from "./search/ProjectContentSearchDialog";
import { toggleThemeEditorForTheme } from "./settings/themeEditorStore";
import { ThreadRowLeadingStatus, ThreadRowTrailingStatus } from "./ThreadStatusIndicators";
import { primaryServerKeybindingsAtom, primaryServerWelcomeAtom } from "../state/server";
import {
  excludeOfficeWorkspaceProjects,
  isOfficeWorkspaceShellContext,
  shouldBlockOfficeTechnicalWorkbenchCommand,
  shouldExposeTechnicalWorkbenchEntryPoints,
} from "../officeMode";
import { FD_MODEL_SELECTION } from "../providerInstances";
import { resolveShortcutCommand, threadJumpIndexFromCommand } from "../keybindings";
import { CommandDialog, CommandDialogPopup } from "./ui/command";
import { Button } from "./ui/button";
import { Kbd, KbdGroup } from "./ui/kbd";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { ComposerHandleContext, useComposerHandleContext } from "../composerHandleContext";
import type { ChatComposerHandle } from "./chat/ChatComposer";
import { getProjectOrderKey, selectProjectGroupingSettings } from "../logicalProject";
import { legacyProjectCwdPreferenceKey, useUiStateStore } from "../uiStateStore";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
} from "../sidebarProjectGrouping";
import type { Project } from "../types";

const EMPTY_BROWSE_ENTRIES: FilesystemBrowseResult["entries"] = [];

function projectFavicon(project: Project) {
  return (
    <ProjectFavicon
      environmentId={project.environmentId}
      cwd={project.workspaceRoot}
      className={ITEM_ICON_CLASS}
    />
  );
}

function getLocalFileManagerName(platform: string): string {
  if (isMacPlatform(platform)) {
    return "Finder";
  }
  if (isWindowsPlatform(platform)) {
    return "Explorer";
  }
  return "文件管理器";
}

function getEnvironmentBrowsePlatform(os: string | null | undefined): string {
  if (os === "windows") {
    return "Win32";
  }
  if (os === "darwin") {
    return "MacIntel";
  }
  if (os === "linux") {
    return "Linux";
  }
  return typeof navigator === "undefined" ? "" : navigator.platform;
}

type AddProjectRemoteProviderKind = Extract<
  SourceControlProviderKind,
  "github" | "gitlab" | "bitbucket" | "azure-devops"
>;
type AddProjectRemoteSource = AddProjectRemoteProviderKind | "url";

type AddProjectCloneFlow =
  | {
      readonly step: "repository";
      readonly environmentId: EnvironmentId;
      readonly source: AddProjectRemoteSource;
    }
  | {
      readonly step: "confirm";
      readonly environmentId: EnvironmentId;
      readonly source: AddProjectRemoteSource;
      readonly repositoryInput: string;
      readonly repository: SourceControlRepositoryInfo | null;
      readonly remoteUrl: string;
    };

const REMOTE_PROJECT_SOURCES: ReadonlyArray<AddProjectRemoteSource> = [
  "url",
  "github",
  "gitlab",
  "bitbucket",
  "azure-devops",
];
const REMOTE_PROJECT_PROVIDER_SOURCES: ReadonlyArray<AddProjectRemoteProviderKind> = [
  "github",
  "gitlab",
  "bitbucket",
  "azure-devops",
];

function remoteProjectSourceLabel(source: AddProjectRemoteSource): string {
  switch (source) {
    case "github":
      return "GitHub";
    case "gitlab":
      return "GitLab";
    case "bitbucket":
      return "Bitbucket";
    case "azure-devops":
      return "Azure DevOps";
    case "url":
      return "Git 地址";
  }
}

function remoteProjectSourcePathHint(source: AddProjectRemoteSource): string {
  switch (source) {
    case "github":
      return "owner/repo";
    case "gitlab":
      return "group/project";
    case "bitbucket":
      return "workspace/repository";
    case "azure-devops":
      return "project/repository";
    case "url":
      return "地址";
  }
}

function remoteProjectSourceProvider(
  source: AddProjectRemoteSource,
): AddProjectRemoteProviderKind | null {
  return source === "url" ? null : source;
}

function remoteProjectSourceIcon(source: AddProjectRemoteSource, className: string): ReactNode {
  switch (source) {
    case "github":
      return <GitHubIcon className={className} />;
    case "gitlab":
      return <GitLabIcon className={className} />;
    case "bitbucket":
      return <BitbucketIcon className={className} />;
    case "azure-devops":
      return <AzureDevOpsIcon className={className} />;
    case "url":
      return <LinkIcon className={className} />;
  }
}

function remoteProjectInputPlaceholder(flow: AddProjectCloneFlow | null): string | null {
  if (!flow) return null;
  if (flow.step === "confirm") return null;
  if (flow.source === "url") {
    return "输入 Git 克隆地址";
  }
  return `输入 ${remoteProjectSourceLabel(flow.source)} 仓库（${remoteProjectSourcePathHint(flow.source)}）`;
}

function sourceProviderKind(source: AddProjectRemoteSource): AddProjectRemoteProviderKind | null {
  return source === "url" ? null : source;
}

function sortAddProjectProviderSources(
  readinessBySource: AddProjectRemoteSourceReadiness,
): ReadonlyArray<AddProjectRemoteProviderKind> {
  return REMOTE_PROJECT_PROVIDER_SOURCES.toSorted((left, right) => {
    const leftReady = readinessBySource[left].ready;
    const rightReady = readinessBySource[right].ready;
    if (leftReady !== rightReady) {
      return leftReady ? -1 : 1;
    }
    return remoteProjectSourceLabel(left).localeCompare(remoteProjectSourceLabel(right));
  });
}

type AddProjectRemoteSourceReadiness = Record<
  AddProjectRemoteSource,
  { readonly ready: boolean; readonly hint: string | null }
>;

function buildAddProjectRemoteSourceReadiness(
  discovery: SourceControlDiscoveryResult | null,
): AddProjectRemoteSourceReadiness {
  const unavailable = {
    ready: false,
    hint: "代码托管平台状态不可用，请前往“设置 > 版本控制”重新扫描。",
  } as const;
  const defaultReadiness: AddProjectRemoteSourceReadiness = {
    url: { ready: true, hint: null },
    github: unavailable,
    gitlab: unavailable,
    bitbucket: unavailable,
    "azure-devops": unavailable,
  };

  if (!discovery) {
    return defaultReadiness;
  }

  const providerByKind = new Map(
    discovery.sourceControlProviders.map((provider) => [provider.kind, provider]),
  );
  const readiness = { ...defaultReadiness };

  for (const source of REMOTE_PROJECT_SOURCES) {
    const kind = sourceProviderKind(source);
    if (!kind) continue;
    const provider = providerByKind.get(kind);
    if (!provider) {
      readiness[source] = unavailable;
      continue;
    }
    if (provider.status !== "available") {
      readiness[source] = { ready: false, hint: provider.installHint };
      continue;
    }
    if (provider.auth.status === "unauthenticated") {
      readiness[source] = {
        ready: false,
        hint:
          Option.getOrNull(provider.auth.detail) ??
          `${provider.label} 尚未登录，请前往“设置 > 版本控制”完成配置。`,
      };
      continue;
    }
    readiness[source] = { ready: true, hint: null };
  }

  return readiness;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "操作时发生错误。";
}

const OVERLAY_MODE_BY_COMMAND = {
  "commandPalette.toggle": "command",
  "filePicker.toggle": "files",
  "projectSearch.toggle": "content",
} as const satisfies Partial<Record<string, SearchOverlayMode>>;

function overlayModeForCommand(command: string | null): SearchOverlayMode | null {
  if (command === null) return null;
  return command in OVERLAY_MODE_BY_COMMAND
    ? OVERLAY_MODE_BY_COMMAND[command as keyof typeof OVERLAY_MODE_BY_COMMAND]
    : null;
}

export function CommandPalette({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduceCommandPaletteUiState, {
    open: false,
    mode: "command",
    openIntent: null,
  });
  const setOpen = useCallback((open: boolean) => dispatch({ _tag: "SetOpen", open }), []);
  const openAddProject = useCallback(() => dispatch({ _tag: "OpenAddProject" }), []);
  const openNewThreadIn = useCallback(() => dispatch({ _tag: "OpenNewThreadIn" }), []);
  const clearOpenIntent = useCallback(() => dispatch({ _tag: "ClearOpenIntent" }), []);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { theme, themeHalves, resolvedTheme } = useTheme();
  const composerHandleRef = useRef<ChatComposerHandle | null>(null);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const primaryServerWelcome = useAtomValue(primaryServerWelcomeAtom);
  const { activeDraftThread, activeThread } = useHandleNewThread();
  const pathname = useLocation({ select: (location) => location.pathname });
  const officeMode = isOfficeWorkspaceShellContext({
    isDesktop: isElectron,
    pathname,
    projectId: activeThread?.projectId ?? activeDraftThread?.projectId,
    projectEnvironmentId: activeThread?.environmentId ?? activeDraftThread?.environmentId,
    bootstrapProjectId: primaryServerWelcome?.bootstrapProjectId,
    bootstrapEnvironmentId: primaryServerWelcome?.environment.environmentId,
  });
  const toggleMode = useCallback(
    (mode: SearchOverlayMode) => {
      const command =
        mode === "files"
          ? "filePicker.toggle"
          : mode === "content"
            ? "projectSearch.toggle"
            : "commandPalette.toggle";
      if (shouldBlockOfficeTechnicalWorkbenchCommand({ officeMode, command })) return;
      dispatch({ _tag: "ToggleMode", mode });
    },
    [officeMode],
  );
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params, primaryEnvironmentId),
  });
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const terminalOpen = useTerminalUiStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  const previewOpen = useRightPanelStore((state) =>
    routeThreadRef
      ? selectActiveRightPanel(state.byThreadKey, routeThreadRef) === "preview"
      : false,
  );

  useEffect(() => {
    if (!state.open || state.mode === "command") return;
    const onEscapeKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.isComposing || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      toggleMode("command");
    };
    window.addEventListener("keydown", onEscapeKeyDown, true);
    return () => window.removeEventListener("keydown", onEscapeKeyDown, true);
  }, [state.mode, state.open, toggleMode]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // Resolve with the complete shortcut context so customized bindings
      // using any documented `when` condition (e.g. previewFocus) work.
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
          previewFocus: isPreviewFocused(),
          previewOpen,
        },
      });
      if (command === "themeEditor.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleThemeEditorForTheme({
          theme,
          themeHalves,
          initialAppearance: resolvedTheme,
        });
        return;
      }
      const mode = overlayModeForCommand(command);
      if (mode === null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (shouldBlockOfficeTechnicalWorkbenchCommand({ officeMode, command })) return;
      toggleMode(mode);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    keybindings,
    officeMode,
    previewOpen,
    resolvedTheme,
    terminalOpen,
    theme,
    themeHalves,
    toggleMode,
  ]);

  useEffect(
    () =>
      onOpenCommandPalette((detail) => {
        if (detail.open === "new-thread-in") {
          openNewThreadIn();
        } else if (detail.open === "add-project") {
          openAddProject();
        } else {
          setOpen(true);
        }
      }),
    [openAddProject, openNewThreadIn, setOpen],
  );

  return (
    <ComposerHandleContext value={composerHandleRef}>
      <CommandDialog
        open={state.open}
        onOpenChange={(open, eventDetails) => {
          if (!open && eventDetails.reason === "escape-key" && state.mode !== "command") {
            eventDetails.cancel();
            toggleMode("command");
            return;
          }
          setOpen(open);
        }}
      >
        {children}
        <CommandPaletteDialog
          open={state.open}
          mode={state.mode}
          openIntent={state.openIntent}
          setOpen={setOpen}
          openOverlayMode={toggleMode}
          clearOpenIntent={clearOpenIntent}
        />
      </CommandDialog>
    </ComposerHandleContext>
  );
}

function CommandPaletteDialog(props: {
  readonly open: boolean;
  readonly mode: SearchOverlayMode;
  readonly openIntent: CommandPaletteOpenIntent | null;
  readonly setOpen: (open: boolean) => void;
  readonly openOverlayMode: (mode: SearchOverlayMode) => void;
  readonly clearOpenIntent: () => void;
}) {
  const composerHandleRef = useComposerHandleContext();

  if (!props.open) {
    return null;
  }

  return (
    <CommandDialogPopup
      aria-label={
        props.mode === "files"
          ? "文件选择器"
          : props.mode === "content"
            ? "搜索工作空间内容"
            : "命令面板"
      }
      className={cn("overflow-hidden p-0", props.mode === "content" && "h-105")}
      data-command-palette="true"
      data-palette-mode={props.mode}
      data-testid="command-palette"
      finalFocus={() => {
        composerHandleRef?.current?.focusAtEnd();
        return false;
      }}
      onBackdropPointerDown={() => {
        props.setOpen(false);
      }}
    >
      {props.mode === "files" ? (
        <ProjectFilePicker setOpen={props.setOpen} />
      ) : props.mode === "content" ? (
        <ProjectContentSearchDialog onOpenChange={props.setOpen} />
      ) : (
        <OpenCommandPaletteDialog
          openIntent={props.openIntent}
          setOpen={props.setOpen}
          openOverlayMode={props.openOverlayMode}
          clearOpenIntent={props.clearOpenIntent}
        />
      )}
    </CommandDialogPopup>
  );
}

function OpenCommandPaletteDialog(props: {
  readonly openIntent: CommandPaletteOpenIntent | null;
  readonly setOpen: (open: boolean) => void;
  readonly openOverlayMode: (mode: SearchOverlayMode) => void;
  readonly clearOpenIntent: () => void;
}) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { clearOpenIntent, openIntent, openOverlayMode, setOpen } = props;
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const isActionsOnly = deferredQuery.startsWith(">");
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const clientSettings = useClientSettings();
  const createProject = useAtomCommand(projectEnvironment.create, {
    reportFailure: false,
  });
  const lookupRepository = useAtomQueryRunner(sourceControlEnvironment.repository, {
    reportFailure: false,
  });
  const loadBrowsePath = useAtomQueryRunner(filesystemEnvironment.browse, {
    reportFailure: false,
    reportDefect: false,
  });
  const cloneRepository = useAtomCommand(sourceControlEnvironment.cloneRepository, {
    reportFailure: false,
  });
  const primaryEnvironment = usePrimaryEnvironment();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewTask, handleNewThread } =
    useHandleNewThread();
  const projects = usePrimaryProjects();
  const primaryServerWelcome = useAtomValue(primaryServerWelcomeAtom);
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const threads = usePrimaryThreadShells();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { theme, themeHalves, resolvedTheme } = useTheme();
  const [viewStack, setViewStack] = useState<CommandPaletteView[]>([]);
  const currentView = viewStack.at(-1) ?? null;
  const environmentIds = useMemo(
    () => (primaryEnvironmentId === null ? [] : [primaryEnvironmentId]),
    [primaryEnvironmentId],
  );
  const threadSearchQuery = currentView === null && !isActionsOnly ? deferredQuery : "";
  const threadSearch = useThreadSearch(environmentIds, threadSearchQuery);
  const threadContentMatchByKey = useMemo(
    () =>
      new Map(
        threadSearch.matches.flatMap((match) =>
          match.source === "user" || match.source === "assistant"
            ? [[threadSearchMatchKey(match), match] as const]
            : [],
        ),
      ),
    [threadSearch.matches],
  );
  const [browseGeneration, setBrowseGeneration] = useState(0);
  const browseNavigationRef = useRef<ReturnType<typeof createBrowseNavigationCoordinator> | null>(
    null,
  );
  if (browseNavigationRef.current === null) {
    browseNavigationRef.current = createBrowseNavigationCoordinator();
  }
  const browseNavigation = browseNavigationRef.current;
  const [addProjectEnvironmentId, setAddProjectEnvironmentId] = useState<EnvironmentId | null>(
    null,
  );
  const [isPickingProjectFolder, setIsPickingProjectFolder] = useState(false);
  const pickLocalProjectFolderRef = useRef<(environmentId: EnvironmentId) => Promise<void>>(
    async () => {},
  );
  const [addProjectCloneFlow, setAddProjectCloneFlow] = useState<AddProjectCloneFlow | null>(null);
  const [isRemoteProjectLookingUp, setIsRemoteProjectLookingUp] = useState(false);
  const [isRemoteProjectCloning, setIsRemoteProjectCloning] = useState(false);
  const projectGroupingSettings = useMemo(
    () => selectProjectGroupingSettings(clientSettings),
    [clientSettings],
  );

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
  const orderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: visibleProjects,
        preferredIds: projectOrder,
        getId: getProjectOrderKey,
        getPreferenceIds: (project) => [
          getProjectOrderKey(project),
          legacyProjectCwdPreferenceKey(project.workspaceRoot),
        ],
      }),
    [projectOrder, visibleProjects],
  );
  const unsortedProjectGroups = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects:
          clientSettings.sidebarProjectSortOrder === "manual" ? orderedProjects : visibleProjects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
      }),
    [
      clientSettings.sidebarProjectSortOrder,
      orderedProjects,
      primaryEnvironmentId,
      projectGroupingSettings,
      visibleProjects,
    ],
  );
  const projectGroups = useMemo(
    () =>
      sortLogicalProjectsForSidebar(
        unsortedProjectGroups,
        threads,
        clientSettings.sidebarProjectSortOrder,
      ),
    [clientSettings.sidebarProjectSortOrder, threads, unsortedProjectGroups],
  );
  const contextualProjectRef = useMemo(
    () =>
      resolveThreadActionProjectRef({
        activeDraftThread,
        activeThread: activeThread ?? undefined,
        defaultProjectRef,
        handleNewThread,
      }),
    [activeDraftThread, activeThread, defaultProjectRef, handleNewThread],
  );
  const projectPickerEntries = useMemo(
    () =>
      buildSidebarProjectPickerEntries({
        groups: projectGroups,
        preferredProjectRef: contextualProjectRef,
      }),
    [contextualProjectRef, projectGroups],
  );
  const pickerProjects = useMemo(
    () =>
      projectPickerEntries.map(({ group, targetProject }) => ({
        ...targetProject,
        title: group.displayName,
      })),
    [projectPickerEntries],
  );
  const projectGroupByTargetKey = useMemo(
    () =>
      new Map(
        projectPickerEntries.map(({ group, targetProject }) => [
          `${targetProject.environmentId}:${targetProject.id}`,
          group,
        ]),
      ),
    [projectPickerEntries],
  );

  const defaultAddProjectEnvironmentId = canCreateProjectInEnvironment(
    primaryEnvironment?.connection.phase,
  )
    ? primaryEnvironmentId
    : null;
  const browseEnvironmentId = addProjectEnvironmentId ?? defaultAddProjectEnvironmentId;
  const browseEnvironment =
    browseEnvironmentId === primaryEnvironmentId ? primaryEnvironment : null;
  const sourceControlDiscovery = useEnvironmentQuery(
    browseEnvironmentId === null
      ? null
      : sourceControlEnvironment.discovery({
          environmentId: browseEnvironmentId,
          input: {},
        }),
  );
  const browseEnvironmentPlatform = getEnvironmentBrowsePlatform(
    browseEnvironment?.serverConfig?.environment.platform.os,
  );
  const isRemoteProjectCloneFlow = addProjectCloneFlow !== null;
  const isRemoteProjectRepositoryStep = addProjectCloneFlow?.step === "repository";
  const browsePath = useMemo(
    () => getFilesystemBrowsePath(query, browseEnvironmentPlatform, !isRemoteProjectRepositoryStep),
    [browseEnvironmentPlatform, isRemoteProjectRepositoryStep, query],
  );
  const isBrowsing = browsePath.isBrowsing;
  const browseDirectoryPath = browsePath.directoryPath;
  const paletteMode = getCommandPaletteMode({ currentView, isBrowsing });
  const getAddProjectInitialQueryForEnvironment = useCallback(
    (environmentId: EnvironmentId | null): string => {
      const environmentSettings =
        environmentId === primaryEnvironmentId ? primaryEnvironment?.serverConfig?.settings : null;
      const baseDirectory = environmentSettings?.addProjectBaseDirectory?.trim() ?? "";
      if (baseDirectory.length === 0) {
        return "~/";
      }
      return ensureBrowseDirectoryPath(baseDirectory);
    },
    [primaryEnvironment, primaryEnvironmentId],
  );

  const projectCwdById = useMemo(
    () =>
      new Map<ProjectId, string>(projects.map((project) => [project.id, project.workspaceRoot])),
    [projects],
  );
  const projectTitleById = useMemo(
    () => new Map<ProjectId, string>(projects.map((project) => [project.id, project.title])),
    [projects],
  );

  const activeThreadId = activeThread?.id;
  const currentProjectEnvironmentId =
    activeThread?.environmentId ?? activeDraftThread?.environmentId ?? null;
  const currentProjectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? null;
  const isOfficeActive = isOfficeWorkspaceShellContext({
    isDesktop: isElectron,
    pathname,
    projectId: currentProjectId,
    projectEnvironmentId: currentProjectEnvironmentId,
    bootstrapProjectId: primaryServerWelcome?.bootstrapProjectId,
    bootstrapEnvironmentId: primaryServerWelcome?.environment.environmentId,
  });
  const currentProjectCwd = currentProjectId
    ? (projectCwdById.get(currentProjectId) ?? null)
    : null;
  const currentProjectCwdForBrowse =
    browseEnvironmentId && currentProjectEnvironmentId === browseEnvironmentId
      ? currentProjectCwd
      : null;
  const getBrowseCwdForEnvironment = useCallback(
    (environmentId: EnvironmentId | null): string | null =>
      environmentId && currentProjectEnvironmentId === environmentId ? currentProjectCwd : null,
    [currentProjectCwd, currentProjectEnvironmentId],
  );
  const relativePathNeedsActiveProject =
    isExplicitRelativeProjectPath(query.trim()) && currentProjectCwdForBrowse === null;
  const browseQuery = useEnvironmentQuery(
    isBrowsing &&
      browsePath.directoryPath.length > 0 &&
      browseEnvironmentId !== null &&
      !relativePathNeedsActiveProject
      ? filesystemEnvironment.browse({
          environmentId: browseEnvironmentId,
          input: {
            partialPath: browsePath.directoryPath,
            ...(currentProjectCwdForBrowse ? { cwd: currentProjectCwdForBrowse } : {}),
          },
        })
      : null,
  );
  const browseResult = browseQuery.data;
  const isBrowsePending = browseQuery.isPending;
  const browseEntries = browseResult?.entries ?? EMPTY_BROWSE_ENTRIES;
  const { visibleEntries: visibleBrowseEntries, exactEntry: exactBrowseEntry } = useMemo(
    () => filterFilesystemBrowseEntries(browseEntries, browsePath.filterQuery),
    [browseEntries, browsePath.filterQuery],
  );

  const prefetchBrowsePath = useCallback(
    async (
      partialPath: string,
      environmentId: EnvironmentId | null = browseEnvironmentId,
      cwd: string | null = currentProjectCwdForBrowse,
    ): Promise<void> => {
      if (!environmentId) {
        return;
      }
      if (
        environmentId !== primaryEnvironmentId ||
        !canPreloadBrowsePath(primaryEnvironment?.connection.phase)
      ) {
        return;
      }

      await loadBrowsePath({
        environmentId,
        input: {
          partialPath,
          ...(cwd ? { cwd } : {}),
        },
      });
    },
    [
      browseEnvironmentId,
      currentProjectCwdForBrowse,
      loadBrowsePath,
      primaryEnvironment,
      primaryEnvironmentId,
    ],
  );

  useEffect(
    () => () => {
      browseNavigation.invalidate();
    },
    [browseNavigation],
  );

  const openProjectFromSearch = useMemo(
    () => async (project: (typeof projects)[number]) => {
      const group = projectGroupByTargetKey.get(`${project.environmentId}:${project.id}`);
      const groupedProjectKeys = group
        ? new Set(
            group.memberProjectRefs.map(
              (projectRef) => `${projectRef.environmentId}:${projectRef.projectId}`,
            ),
          )
        : null;
      const latestThread = groupedProjectKeys
        ? (sortThreads(
            threads.filter(
              (thread) =>
                thread.archivedAt === null &&
                groupedProjectKeys.has(`${thread.environmentId}:${thread.projectId}`),
            ),
            clientSettings.sidebarThreadSortOrder,
          )[0] ?? null)
        : getLatestThreadForProject(
            threads.filter((thread) => thread.environmentId === project.environmentId),
            project.id,
            clientSettings.sidebarThreadSortOrder,
          );
      if (latestThread) {
        await navigate({
          to: "/$threadId",
          params: buildThreadRouteParams(
            scopeThreadRef(latestThread.environmentId, latestThread.id),
          ),
        });
        return;
      }

      await handleNewThread(scopeProjectRef(project.environmentId, project.id));
    },
    [
      clientSettings.sidebarThreadSortOrder,
      handleNewThread,
      navigate,
      projectGroupByTargetKey,
      threads,
    ],
  );

  const projectSearchItems = useMemo(
    () =>
      buildProjectActionItems({
        projects: pickerProjects,
        valuePrefix: "project",
        searchTerms: (project) => {
          const group = projectGroupByTargetKey.get(`${project.environmentId}:${project.id}`);
          return (
            group?.memberProjects.flatMap((member) => [member.title, member.workspaceRoot]) ?? []
          );
        },
        icon: projectFavicon,
        runProject: openProjectFromSearch,
      }),
    [openProjectFromSearch, pickerProjects, projectGroupByTargetKey],
  );

  const projectThreadItems = useMemo(
    () =>
      enumerateCommandPaletteItems(
        buildProjectActionItems({
          projects: pickerProjects,
          valuePrefix: "new-thread-in",
          searchTerms: (project) => {
            const group = projectGroupByTargetKey.get(`${project.environmentId}:${project.id}`);
            return (
              group?.memberProjects.flatMap((member) => [member.title, member.workspaceRoot]) ?? []
            );
          },
          icon: projectFavicon,
          runProject: async (project) => {
            const group = projectGroupByTargetKey.get(`${project.environmentId}:${project.id}`);
            const contextualRefBelongsToGroup =
              contextualProjectRef !== null &&
              group?.memberProjectRefs.some(
                (projectRef) =>
                  projectRef.environmentId === contextualProjectRef.environmentId &&
                  projectRef.projectId === contextualProjectRef.projectId,
              );
            await handleNewThread(
              contextualRefBelongsToGroup
                ? contextualProjectRef
                : scopeProjectRef(project.environmentId, project.id),
            );
          },
        }),
      ),
    [contextualProjectRef, handleNewThread, pickerProjects, projectGroupByTargetKey],
  );

  const allThreadItems = useMemo(
    () =>
      buildThreadActionItems({
        threads,
        ...(activeThreadId ? { activeThreadId } : {}),
        projectTitleById,
        sortOrder: clientSettings.sidebarThreadSortOrder,
        icon: <MessageSquareIcon className={ITEM_ICON_CLASS} />,
        renderLeadingContent: (thread) => <ThreadRowLeadingStatus thread={thread} />,
        renderTrailingContent: (thread) => <ThreadRowTrailingStatus thread={thread} />,
        getContentMatch: (thread) => {
          const match = threadContentMatchByKey.get(
            threadSearchMatchKey({
              environmentId: thread.environmentId,
              threadId: thread.id,
            }),
          );
          return match && (match.source === "user" || match.source === "assistant")
            ? {
                source: match.source,
                snippet: match.snippet,
                query: threadSearchQuery,
              }
            : undefined;
        },
        runThread: async (thread) => {
          await navigate({
            to: "/$threadId",
            params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
          });
        },
      }),
    [
      activeThreadId,
      clientSettings.sidebarThreadSortOrder,
      navigate,
      projectTitleById,
      threadContentMatchByKey,
      threadSearchQuery,
      threads,
    ],
  );
  const recentThreadItems = allThreadItems.slice(0, RECENT_THREAD_LIMIT);

  const pushPaletteView = useCallback(
    (view: CommandPaletteView): void => {
      browseNavigation.invalidate();
      setViewStack((previousViews) => [
        ...previousViews,
        {
          addonIcon: view.addonIcon,
          groups: view.groups,
          ...(view.initialQuery ? { initialQuery: view.initialQuery } : {}),
        },
      ]);
      setHighlightedItemValue(null);
      setQuery(view.initialQuery ?? "");
    },
    [browseNavigation],
  );

  function pushView(item: CommandPaletteSubmenuItem): void {
    pushPaletteView({
      addonIcon: item.addonIcon,
      groups: item.groups,
      ...(item.initialQuery ? { initialQuery: item.initialQuery } : {}),
    });
  }

  function popView(): void {
    browseNavigation.invalidate();
    setAddProjectCloneFlow(null);
    if (viewStack.length <= 1) {
      setAddProjectEnvironmentId(null);
    }
    setViewStack((previousViews) => previousViews.slice(0, -1));
    setHighlightedItemValue(null);
    setQuery("");
  }

  function handleQueryChange(nextQuery: string): void {
    browseNavigation.invalidate();
    setHighlightedItemValue(null);
    setQuery(nextQuery);
    if (nextQuery === "" && currentView?.initialQuery) {
      popView();
    }
  }

  const startAddProjectBrowse = useCallback(
    async (environmentId: EnvironmentId): Promise<void> => {
      const initialQuery = getAddProjectInitialQueryForEnvironment(environmentId);
      const initialBrowsePath = getBrowseDirectoryPath(initialQuery);
      const browseCwd = getBrowseCwdForEnvironment(environmentId);
      const view: CommandPaletteView = {
        addonIcon: <FolderPlusIcon className={ADDON_ICON_CLASS} />,
        groups: [],
        initialQuery,
      };

      await browseNavigation.run(
        () =>
          initialBrowsePath.length > 0
            ? prefetchBrowsePath(initialBrowsePath, environmentId, browseCwd)
            : Promise.resolve(),
        () => {
          setAddProjectEnvironmentId(environmentId);
          setAddProjectCloneFlow(null);
          pushPaletteView(view);
        },
      );
    },
    [
      browseNavigation,
      getAddProjectInitialQueryForEnvironment,
      getBrowseCwdForEnvironment,
      prefetchBrowsePath,
      pushPaletteView,
    ],
  );

  const startAddProjectClone = useCallback(
    (environmentId: EnvironmentId, source: AddProjectRemoteSource): void => {
      setAddProjectEnvironmentId(environmentId);
      setAddProjectCloneFlow({ step: "repository", environmentId, source });
      pushPaletteView({
        addonIcon: remoteProjectSourceIcon(source, ADDON_ICON_CLASS),
        groups: [],
        initialQuery: "",
      });
    },
    [pushPaletteView],
  );

  const openSourceControlSettings = useCallback(() => {
    setOpen(false);
    void navigate({ to: "/settings/source-control" });
  }, [navigate, setOpen]);

  const buildAddProjectSourceGroups = useCallback(
    (
      environmentId: EnvironmentId,
      readinessBySource: AddProjectRemoteSourceReadiness,
    ): CommandPaletteView["groups"] => {
      const sourceItems: Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> = [
        {
          kind: "action",
          value: `action:add-project:${environmentId}:local`,
          searchTerms: ["local", "folder", "directory", "browse"],
          title: "打开本地文件夹",
          description: "使用系统窗口选择文件夹",
          icon: <FolderPlusIcon className={ITEM_ICON_CLASS} />,
          keepOpen: true,
          run: async () => {
            if (
              shouldUseNativeFolderPicker({
                isDesktop: typeof window !== "undefined" && window.desktopBridge !== undefined,
                isPrimaryEnvironment: environmentId === primaryEnvironmentId,
              })
            ) {
              await pickLocalProjectFolderRef.current(environmentId);
              return;
            }
            await startAddProjectBrowse(environmentId);
          },
        },
      ];

      const orderedSources: ReadonlyArray<AddProjectRemoteSource> = [
        "url",
        ...sortAddProjectProviderSources(readinessBySource),
      ];

      for (const source of orderedSources) {
        const label = remoteProjectSourceLabel(source);
        const title = source === "url" ? "Git 地址" : `${label} 仓库`;
        const description =
          source === "url"
            ? "从远程 URL 克隆"
            : `克隆 ${label} ${remoteProjectSourcePathHint(source)}`;
        const readiness = readinessBySource[source];
        const disabledHint = readiness.hint;

        const titleTrailingContent = readiness.ready ? undefined : (
          <span className="ml-auto">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="xs"
                    className="h-5 rounded-[.25rem] px-1.5 text-[10px] text-warning-foreground"
                    onClick={() => {
                      openSourceControlSettings();
                    }}
                  >
                    需要配置
                  </Button>
                }
              />
              <TooltipPopup align="end" side="left">
                {disabledHint ?? "请前往“设置 > 版本控制”配置此平台。"}
              </TooltipPopup>
            </Tooltip>
          </span>
        );

        if (!readiness.ready) {
          sourceItems.push({
            kind: "action",
            value: `action:add-project:${environmentId}:${source}:not-ready`,
            searchTerms: ["clone", "remote", "repository", "repo", "git", label, "setup required"],
            title,
            description,
            disabled: true,
            icon: remoteProjectSourceIcon(source, ITEM_ICON_CLASS),
            ...(titleTrailingContent ? { titleTrailingContent } : {}),
            run: async () => {},
          });
          continue;
        }

        sourceItems.push({
          kind: "action",
          value: `action:add-project:${environmentId}:${source}`,
          searchTerms: ["clone", "remote", "repository", "repo", "git", label],
          title,
          description,
          icon: remoteProjectSourceIcon(source, ITEM_ICON_CLASS),
          ...(titleTrailingContent ? { titleTrailingContent } : {}),
          keepOpen: true,
          run: async () => {
            startAddProjectClone(environmentId, source);
          },
        });
      }

      return [{ value: `sources:${environmentId}`, label: "来源", items: sourceItems }];
    },
    [openSourceControlSettings, primaryEnvironmentId, startAddProjectBrowse, startAddProjectClone],
  );

  const startAddProjectSourceSelection = useCallback(
    (environmentId: EnvironmentId): void => {
      if (
        environmentId !== primaryEnvironmentId ||
        !canCreateProjectInEnvironment(primaryEnvironment?.connection.phase)
      ) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "本地服务不可用",
            description: "请重新连接本地服务后再导入工作空间。",
          }),
        );
        return;
      }
      setAddProjectEnvironmentId(environmentId);
      setAddProjectCloneFlow(null);
      pushPaletteView({
        addonIcon: <FolderPlusIcon className={ADDON_ICON_CLASS} />,
        groups: buildAddProjectSourceGroups(
          environmentId,
          buildAddProjectRemoteSourceReadiness(
            browseEnvironmentId === environmentId ? sourceControlDiscovery.data : null,
          ),
        ),
      });
    },
    [
      browseEnvironmentId,
      buildAddProjectSourceGroups,
      primaryEnvironment,
      primaryEnvironmentId,
      pushPaletteView,
      sourceControlDiscovery.data,
    ],
  );

  const openAddProjectFlow = useCallback(() => {
    const environmentId = defaultAddProjectEnvironmentId;
    if (!environmentId) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "无法浏览工作空间",
          description: "本地服务当前不可用。",
        }),
      );
      return;
    }

    void startAddProjectSourceSelection(environmentId);
  }, [defaultAddProjectEnvironmentId, startAddProjectSourceSelection]);

  useLayoutEffect(() => {
    if (openIntent?.kind !== "add-project") {
      return;
    }
    clearOpenIntent();
    openAddProjectFlow();
  }, [clearOpenIntent, openAddProjectFlow, openIntent]);

  useLayoutEffect(() => {
    if (openIntent?.kind !== "new-thread-in" || projectThreadItems.length === 0) {
      return;
    }
    clearOpenIntent();
    browseNavigation.invalidate();
    setAddProjectCloneFlow(null);
    setViewStack([]);
    setQuery("");
    const currentPrefix =
      currentProjectEnvironmentId && currentProjectId
        ? `new-thread-in:${currentProjectEnvironmentId}:${currentProjectId}`
        : null;
    const prioritized = currentPrefix
      ? [
          ...projectThreadItems.filter((item) => item.value === currentPrefix),
          ...projectThreadItems.filter((item) => item.value !== currentPrefix),
        ]
      : projectThreadItems;
    pushPaletteView({
      addonIcon: <SquarePenIcon className={ADDON_ICON_CLASS} />,
      groups: [
        {
          value: "projects",
          label: "工作空间",
          items: enumerateCommandPaletteItems(prioritized),
        },
      ],
    });
  }, [
    clearOpenIntent,
    browseNavigation,
    currentProjectEnvironmentId,
    currentProjectId,
    openIntent,
    projectThreadItems,
    pushPaletteView,
  ]);

  const actionItems: Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> = [];

  if (isElectron) {
    actionItems.push({
      kind: "action",
      value: "action:new-task",
      searchTerms: ["new task", "new thread", "chat", "create", "draft", "新建任务"],
      title: "新建任务",
      icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
      shortcutCommand: "chat.new",
      run: async () => {
        await handleNewTask();
      },
    });
  }

  if (pickerProjects.length > 0) {
    const activeProjectTitle = !isOfficeActive
      ? (projectPickerEntries.find((entry) => entry.isPreferred)?.group.displayName ??
        (currentProjectId ? (projectTitleById.get(currentProjectId) ?? null) : null))
      : null;

    if (!isElectron && activeProjectTitle) {
      actionItems.push({
        kind: "action",
        value: "action:new-thread",
        searchTerms: ["new thread", "chat", "create", "draft"],
        title: (
          <>
            在 <span className="font-semibold">{activeProjectTitle}</span> 中新建任务
          </>
        ),
        icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
        shortcutCommand: "chat.new",
        run: async () => {
          await startNewThreadFromContext({
            activeDraftThread,
            activeThread: activeThread ?? undefined,
            defaultProjectRef,
            handleNewThread,
          });
        },
      });
    }

    actionItems.push({
      kind: "submenu",
      value: "action:new-thread-in",
      searchTerms: ["new thread", "project", "pick", "choose", "select"],
      title: "在工作空间中新建任务...",
      icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
      addonIcon: <SquarePenIcon className={ADDON_ICON_CLASS} />,
      groups: [{ value: "projects", label: "工作空间", items: projectThreadItems }],
    });
  }

  if (shouldExposeTechnicalWorkbenchEntryPoints(isOfficeActive)) {
    actionItems.push({
      kind: "action",
      value: "action:open-file-picker",
      searchTerms: ["go to file", "open file", "file picker", "find file", "quick open"],
      title: "转到文件",
      icon: <FileSearchIcon className={ITEM_ICON_CLASS} />,
      keepOpen: true,
      shortcutCommand: "filePicker.toggle",
      run: async () => {
        openOverlayMode("files");
      },
    });

    actionItems.push({
      kind: "action",
      value: "action:search-project-contents",
      searchTerms: ["search project", "find in files", "grep", "content search", "text search"],
      title: "搜索工作空间内容",
      icon: <TextSearchIcon className={ITEM_ICON_CLASS} />,
      keepOpen: true,
      shortcutCommand: "projectSearch.toggle",
      run: async () => {
        openOverlayMode("content");
      },
    });
  }

  actionItems.push({
    kind: "action",
    value: "action:add-project",
    searchTerms: [
      "add project",
      "folder",
      "directory",
      "browse",
      "clone",
      "remote",
      "repository",
      "repo",
      "git",
      "github",
      "gitlab",
      "bitbucket",
      "azure",
      "devops",
      "url",
    ],
    title: "导入工作空间",
    disabled: defaultAddProjectEnvironmentId === null,
    icon: <FolderPlusIcon className={ITEM_ICON_CLASS} />,
    keepOpen: true,
    run: async () => {
      openAddProjectFlow();
    },
  });

  actionItems.push({
    kind: "action",
    value: "action:theme-editor",
    searchTerms: ["theme", "appearance", "colors", "palette", "customize"],
    title: "切换主题编辑器",
    icon: <PaletteIcon className={ITEM_ICON_CLASS} />,
    shortcutCommand: "themeEditor.toggle",
    run: async () => {
      toggleThemeEditorForTheme({
        theme,
        themeHalves,
        initialAppearance: resolvedTheme,
      });
    },
  });

  actionItems.push({
    kind: "action",
    value: "action:settings",
    searchTerms: ["settings", "preferences", "configuration", "keybindings"],
    title: "打开设置",
    icon: <SettingsIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await navigate({ to: "/settings" });
    },
  });

  if (!isOfficeActive) {
    actionItems.push({
      kind: "action",
      value: "action:project-settings",
      searchTerms: ["project", "settings", "scripts", "model", "grouping", "checkout"],
      title: "工作空间设置",
      icon: <FolderIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({ to: "/settings/projects" });
      },
    });
  }

  const rootGroups = buildRootGroups({ actionItems, recentThreadItems });
  const sourceSelectionViewValue =
    addProjectEnvironmentId === null ? null : `sources:${addProjectEnvironmentId}`;
  const activeGroups =
    addProjectEnvironmentId !== null &&
    currentView !== null &&
    currentView.groups[0]?.value === sourceSelectionViewValue
      ? buildAddProjectSourceGroups(
          addProjectEnvironmentId,
          buildAddProjectRemoteSourceReadiness(sourceControlDiscovery.data),
        )
      : (currentView?.groups ?? rootGroups);

  const filteredGroups = filterCommandPaletteGroups({
    activeGroups,
    query: deferredQuery,
    isInSubmenu: currentView !== null,
    projectSearchItems: projectSearchItems,
    threadSearchItems: allThreadItems,
  });

  const handleAddProjectForEnvironment = useCallback(
    async (input: {
      readonly environmentId: EnvironmentId;
      readonly rawCwd: string;
      readonly platform: string;
      readonly currentProjectCwd: string | null;
    }) => {
      if (
        input.environmentId !== primaryEnvironmentId ||
        !canCreateProjectInEnvironment(primaryEnvironment?.connection.phase)
      ) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "本地服务不可用",
            description: "请重新连接本地服务后再导入工作空间。",
          }),
        );
        return;
      }
      const rawCwd = input.rawCwd;

      if (isUnsupportedWindowsProjectPath(rawCwd.trim(), input.platform)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "导入工作空间失败",
            description: "Windows 格式的路径只能在 Windows 上使用。",
          }),
        );
        return;
      }

      if (isExplicitRelativeProjectPath(rawCwd.trim()) && !input.currentProjectCwd) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "导入工作空间失败",
            description: "使用相对路径前，需要先打开一个工作空间。",
          }),
        );
        return;
      }

      const cwd = resolveProjectPathForDispatch(rawCwd, input.currentProjectCwd);
      if (cwd.length === 0) return;

      const existing = findProjectByPath(
        projects.filter((project) => project.environmentId === input.environmentId),
        cwd,
      );
      if (existing) {
        const latestThread = getLatestThreadForProject(
          threads.filter((thread) => thread.environmentId === existing.environmentId),
          existing.id,
          clientSettings.sidebarThreadSortOrder,
        );
        if (latestThread) {
          await navigate({
            to: "/$threadId",
            params: buildThreadRouteParams(
              scopeThreadRef(latestThread.environmentId, latestThread.id),
            ),
          });
        } else {
          const navigationResult = await settlePromise(() =>
            handleNewThread(scopeProjectRef(existing.environmentId, existing.id)),
          );
          if (navigationResult._tag === "Failure") {
            const error = squashAtomCommandFailure(navigationResult);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "打开工作空间失败",
                description: error instanceof Error ? error.message : "打开工作空间时发生错误。",
              }),
            );
            return;
          }
        }
        setOpen(false);
        return;
      }

      const projectId = newProjectId();
      const createResult = await createProject({
        environmentId: input.environmentId,
        input: {
          projectId,
          title: inferProjectTitleFromPath(cwd),
          workspaceRoot: cwd,
          createWorkspaceRootIfMissing: true,
          defaultModelSelection: FD_MODEL_SELECTION,
        },
      });
      if (createResult._tag === "Failure") {
        if (!isAtomCommandInterrupted(createResult)) {
          const error = squashAtomCommandFailure(createResult);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "导入工作空间失败",
              description: error instanceof Error ? error.message : "导入工作空间时发生错误。",
            }),
          );
        }
        return;
      }

      const navigationResult = await settlePromise(() =>
        handleNewThread(scopeProjectRef(input.environmentId, projectId)),
      );
      if (navigationResult._tag === "Failure") {
        const error = squashAtomCommandFailure(navigationResult);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "导入工作空间失败",
            description: error instanceof Error ? error.message : "导入工作空间时发生错误。",
          }),
        );
        return;
      }
      setOpen(false);
    },
    [
      handleNewThread,
      createProject,
      navigate,
      primaryEnvironment,
      primaryEnvironmentId,
      projects,
      setOpen,
      clientSettings.sidebarThreadSortOrder,
      threads,
    ],
  );

  const handleAddProject = useCallback(
    async (rawCwd: string) => {
      if (!browseEnvironmentId) return;
      await handleAddProjectForEnvironment({
        environmentId: browseEnvironmentId,
        rawCwd,
        platform: browseEnvironmentPlatform,
        currentProjectCwd: currentProjectCwdForBrowse,
      });
    },
    [
      browseEnvironmentId,
      browseEnvironmentPlatform,
      currentProjectCwdForBrowse,
      handleAddProjectForEnvironment,
    ],
  );

  function getDefaultCloneParentPath(environmentId: EnvironmentId): string {
    return getAddProjectInitialQueryForEnvironment(environmentId);
  }

  async function submitAddProjectCloneFlow(destinationPathInput?: string): Promise<void> {
    if (!addProjectCloneFlow) {
      return;
    }
    if (
      addProjectCloneFlow.environmentId !== primaryEnvironmentId ||
      !canCreateProjectInEnvironment(browseEnvironment?.connection.phase)
    ) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "本地服务不可用",
          description: "请重新连接本地服务后再克隆仓库。",
        }),
      );
      return;
    }

    if (addProjectCloneFlow.step === "repository") {
      const rawRepository = query.trim();
      if (rawRepository.length === 0 || isRemoteProjectLookingUp) {
        return;
      }

      const provider = remoteProjectSourceProvider(addProjectCloneFlow.source);
      if (!provider) {
        const destinationPath = getDefaultCloneParentPath(addProjectCloneFlow.environmentId);
        setAddProjectCloneFlow({
          step: "confirm",
          environmentId: addProjectCloneFlow.environmentId,
          source: addProjectCloneFlow.source,
          repositoryInput: rawRepository,
          repository: null,
          remoteUrl: rawRepository,
        });
        setHighlightedItemValue(null);
        setQuery(destinationPath);
        setBrowseGeneration((generation) => generation + 1);
        return;
      }

      setIsRemoteProjectLookingUp(true);
      const lookupResult = await lookupRepository({
        environmentId: addProjectCloneFlow.environmentId,
        input: {
          provider,
          repository: rawRepository,
        },
      });
      setIsRemoteProjectLookingUp(false);
      if (lookupResult._tag === "Failure") {
        if (!isAtomCommandInterrupted(lookupResult)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "查询仓库失败",
              description: errorMessage(squashAtomCommandFailure(lookupResult)),
            }),
          );
        }
        return;
      }
      const repository = lookupResult.value;
      const destinationPath = getDefaultCloneParentPath(addProjectCloneFlow.environmentId);
      setAddProjectCloneFlow({
        step: "confirm",
        environmentId: addProjectCloneFlow.environmentId,
        source: addProjectCloneFlow.source,
        repositoryInput: rawRepository,
        repository,
        remoteUrl: repository.sshUrl,
      });
      setHighlightedItemValue(null);
      setQuery(destinationPath);
      setBrowseGeneration((generation) => generation + 1);
      return;
    }

    const rawDestination = (destinationPathInput ?? query).trim();
    if (rawDestination.length === 0 || isRemoteProjectCloning) {
      return;
    }

    if (isUnsupportedWindowsProjectPath(rawDestination, browseEnvironmentPlatform)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "克隆失败",
          description: "Windows 格式的路径只能在 Windows 上使用。",
        }),
      );
      return;
    }

    if (isExplicitRelativeProjectPath(rawDestination) && !currentProjectCwdForBrowse) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "克隆失败",
          description: "使用相对路径前，需要先打开一个工作空间。",
        }),
      );
      return;
    }

    const destinationPath = resolveProjectPathForDispatch(
      rawDestination,
      currentProjectCwdForBrowse,
    );
    if (destinationPath.length === 0) {
      return;
    }

    setIsRemoteProjectCloning(true);
    const cloneResult = await cloneRepository({
      environmentId: addProjectCloneFlow.environmentId,
      input: {
        remoteUrl: addProjectCloneFlow.remoteUrl,
        destinationPath,
      },
    });
    setIsRemoteProjectCloning(false);
    if (cloneResult._tag === "Failure") {
      if (!isAtomCommandInterrupted(cloneResult)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "克隆失败",
            description: errorMessage(squashAtomCommandFailure(cloneResult)),
          }),
        );
      }
      return;
    }
    await handleAddProject(cloneResult.value.cwd);
  }

  const browseTo = useCallback(
    async (name: string): Promise<void> => {
      const nextQuery = appendBrowsePathSegment(query, name);
      await browseNavigation.run(
        () => prefetchBrowsePath(getBrowseDirectoryPath(nextQuery)),
        () => {
          setHighlightedItemValue(null);
          setQuery(nextQuery);
          setBrowseGeneration((generation) => generation + 1);
        },
      );
    },
    [browseNavigation, prefetchBrowsePath, query],
  );

  const browseUp = useCallback(async (): Promise<void> => {
    const parentPath = browsePath.parentPath;
    if (parentPath === null) {
      return;
    }

    await browseNavigation.run(
      () => prefetchBrowsePath(parentPath),
      () => {
        setHighlightedItemValue(null);
        setQuery(parentPath);
        setBrowseGeneration((generation) => generation + 1);
      },
    );
  }, [browseNavigation, browsePath.parentPath, prefetchBrowsePath]);

  // Resolve the add-project path from browse data when available. When the
  // query has a trailing separator (e.g. "~/projects/foo/"), parentPath is the
  // directory itself. Otherwise the user typed a partial leaf name, so we need
  // the exact browse entry's fullPath or fall back to the raw query.
  const resolvedAddProjectPath = hasTrailingPathSeparator(query)
    ? (browseResult?.parentPath ?? query.trim())
    : (exactBrowseEntry?.fullPath ?? query.trim());

  const canBrowseUp = !relativePathNeedsActiveProject && browsePath.canBrowseUp;

  const browseGroups = buildBrowseGroups({
    browseEntries: visibleBrowseEntries,
    browseQuery: query,
    canBrowseUp,
    upIcon: <CornerLeftUpIcon className={ITEM_ICON_CLASS} />,
    directoryIcon: <FolderIcon className={ITEM_ICON_CLASS} />,
    browseUp,
    browseTo,
  });
  const cloneDestinationBrowseGroups = useMemo(
    () =>
      browseGroups.map((group) =>
        group.value === "directories" ? { ...group, label: "选择克隆位置" } : group,
      ),
    [browseGroups],
  );

  const remoteProjectContext = useMemo(() => {
    if (addProjectCloneFlow?.step !== "confirm") {
      return null;
    }

    return {
      title: addProjectCloneFlow.repository?.nameWithOwner ?? addProjectCloneFlow.repositoryInput,
      description: addProjectCloneFlow.repository?.url ?? addProjectCloneFlow.remoteUrl,
      icon: remoteProjectSourceIcon(addProjectCloneFlow.source, ITEM_ICON_CLASS),
    };
  }, [addProjectCloneFlow]);

  let displayedGroups: CommandPaletteView["groups"] = filteredGroups;
  if (addProjectCloneFlow?.step === "repository") {
    displayedGroups = [];
  } else if (addProjectCloneFlow?.step === "confirm") {
    displayedGroups = relativePathNeedsActiveProject ? [] : cloneDestinationBrowseGroups;
  } else if (isBrowsing) {
    displayedGroups = relativePathNeedsActiveProject ? [] : browseGroups;
  }

  const inputPlaceholder =
    remoteProjectInputPlaceholder(addProjectCloneFlow) ??
    getCommandPaletteInputPlaceholder(paletteMode);
  const isSubmenu = paletteMode === "submenu" || paletteMode === "submenu-browse";
  const hasHighlightedBrowseItem = highlightedItemValue?.startsWith("browse:") ?? false;
  const canSubmitBrowsePath =
    isBrowsing &&
    !relativePathNeedsActiveProject &&
    canCreateProjectInEnvironment(browseEnvironment?.connection.phase);
  const willCreateProjectPath =
    canSubmitBrowsePath &&
    !isBrowsePending &&
    query.trim().length > 0 &&
    !hasHighlightedBrowseItem &&
    (hasTrailingPathSeparator(query) ? !browseResult : exactBrowseEntry === null);
  const useMetaForMod = isMacPlatform(navigator.platform);
  const submitModifierLabel = useMetaForMod ? "\u2318" : "Ctrl";
  const isCloneDestinationStep = addProjectCloneFlow?.step === "confirm";
  const submitActionLabel = isCloneDestinationStep
    ? willCreateProjectPath
      ? "创建目录并克隆"
      : "克隆"
    : willCreateProjectPath
      ? "创建目录并导入"
      : "导入";
  const addShortcutLabel = hasHighlightedBrowseItem ? `${submitModifierLabel} Enter` : "Enter";
  const remoteProjectButtonLabel = addProjectCloneFlow
    ? addProjectCloneFlow.source === "url"
      ? "继续"
      : "查询"
    : null;
  const isRemoteProjectPending = isRemoteProjectLookingUp || isRemoteProjectCloning;
  const canSubmitRemoteProjectFlow =
    addProjectCloneFlow?.step === "repository" &&
    query.trim().length > 0 &&
    canCreateProjectInEnvironment(browseEnvironment?.connection.phase) &&
    !isRemoteProjectPending;
  const fileManagerName = getLocalFileManagerName(navigator.platform);
  const canOpenProjectFromFileManager =
    isBrowsing &&
    browseEnvironmentId === primaryEnvironmentId &&
    typeof window !== "undefined" &&
    window.desktopBridge !== undefined;
  const fileManagerInitialPath = useMemo(() => {
    if (!canOpenProjectFromFileManager) {
      return undefined;
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      return undefined;
    }

    const initialPath = hasTrailingPathSeparator(query)
      ? (browseResult?.parentPath ?? trimmedQuery)
      : browseDirectoryPath || trimmedQuery;

    const resolvedPath = resolveProjectPathForDispatch(initialPath, currentProjectCwdForBrowse);
    return resolvedPath.length > 0 ? resolvedPath : undefined;
  }, [
    browseDirectoryPath,
    browseResult?.parentPath,
    canOpenProjectFromFileManager,
    currentProjectCwdForBrowse,
    query,
  ]);

  function isPrimaryModifierPressed(event: KeyboardEvent<HTMLInputElement>): boolean {
    return useMetaForMod ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const command = resolveShortcutCommand(event, keybindings, {
      platform: navigator.platform,
    });
    if (threadJumpIndexFromCommand(command ?? "") !== null) {
      const matchingItem = displayedGroups
        .flatMap((group) => group.items)
        .find((item) => item.shortcutCommand === command);
      if (matchingItem) {
        event.preventDefault();
        event.stopPropagation();
        executeItem(matchingItem);
        return;
      }
    }

    if (addProjectCloneFlow?.step === "repository" && event.key === "Enter") {
      event.preventDefault();
      void submitAddProjectCloneFlow();
      return;
    }

    const shouldSubmitBrowsePath =
      canSubmitBrowsePath &&
      event.key === "Enter" &&
      (!hasHighlightedBrowseItem || isPrimaryModifierPressed(event));

    if (shouldSubmitBrowsePath) {
      event.preventDefault();
      if (isCloneDestinationStep) {
        void submitAddProjectCloneFlow(resolvedAddProjectPath);
      } else {
        void handleAddProject(resolvedAddProjectPath);
      }
      return;
    }

    if (event.key === "Backspace" && query === "" && isSubmenu) {
      event.preventDefault();
      popView();
    }
  }

  function executeItem(item: CommandPaletteActionItem | CommandPaletteSubmenuItem): void {
    if (item.disabled) {
      return;
    }

    if (item.kind === "submenu") {
      pushView(item);
      return;
    }

    if (!item.keepOpen) {
      setOpen(false);
    }

    void item.run().catch((error: unknown) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "无法执行命令",
          description: error instanceof Error ? error.message : "执行命令时发生错误。",
        }),
      );
    });
  }

  const handleOpenProjectFromFileManager = useCallback(
    async (environmentId: EnvironmentId | null = browseEnvironmentId) => {
      if (
        environmentId === null ||
        environmentId !== primaryEnvironmentId ||
        typeof window === "undefined" ||
        window.desktopBridge === undefined ||
        isPickingProjectFolder
      ) {
        return;
      }
      const api = readLocalApi();
      if (!api) {
        return;
      }

      setIsPickingProjectFolder(true);
      let pickedPath: string | null = null;
      try {
        const pickerOptions = {
          ...(fileManagerInitialPath ? { initialPath: fileManagerInitialPath } : {}),
        };
        pickedPath = await api.dialogs.pickFolder(
          Object.keys(pickerOptions).length > 0 ? pickerOptions : undefined,
        );
      } catch {
        // Leave the source picker open so the employee can retry or choose another source.
        setIsPickingProjectFolder(false);
        return;
      }
      setIsPickingProjectFolder(false);
      if (!pickedPath) {
        return;
      }
      await handleAddProjectForEnvironment({
        environmentId,
        rawCwd: pickedPath,
        platform: browseEnvironmentPlatform,
        currentProjectCwd: getBrowseCwdForEnvironment(environmentId),
      });
    },
    [
      browseEnvironmentId,
      browseEnvironmentPlatform,
      fileManagerInitialPath,
      getBrowseCwdForEnvironment,
      handleAddProjectForEnvironment,
      isPickingProjectFolder,
      primaryEnvironmentId,
    ],
  );

  useLayoutEffect(() => {
    pickLocalProjectFolderRef.current = async (environmentId) => {
      await handleOpenProjectFromFileManager(environmentId);
    };
  }, [handleOpenProjectFromFileManager]);

  const inputAccessory =
    addProjectCloneFlow?.step === "repository" ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="xs"
              tabIndex={-1}
              className="absolute inset-e-2.5 top-1/2 gap-1.5 pe-1 ps-2 -translate-y-1/2"
              aria-label={`${remoteProjectButtonLabel ?? "继续"}（回车）`}
              disabled={!canSubmitRemoteProjectFlow}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                void submitAddProjectCloneFlow();
              }}
            />
          }
        >
          <span>{isRemoteProjectPending ? "处理中" : remoteProjectButtonLabel}</span>
          <KbdGroup className="pointer-events-none -me-0.5 items-center gap-1">
            <Kbd>Enter</Kbd>
          </KbdGroup>
        </TooltipTrigger>
        <TooltipPopup side="top">{remoteProjectButtonLabel ?? "继续"}（回车）</TooltipPopup>
      </Tooltip>
    ) : isBrowsing ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="xs"
              tabIndex={-1}
              className={cn(
                "absolute inset-e-2.5 top-1/2 pe-1 ps-2 -translate-y-1/2",
                hasHighlightedBrowseItem ? "gap-1" : "gap-1.5",
              )}
              aria-label={`${submitActionLabel} (${addShortcutLabel})`}
              disabled={
                !canCreateProjectInEnvironment(browseEnvironment?.connection.phase) ||
                relativePathNeedsActiveProject ||
                (isCloneDestinationStep && isRemoteProjectPending)
              }
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                if (relativePathNeedsActiveProject) {
                  return;
                }
                if (isCloneDestinationStep) {
                  void submitAddProjectCloneFlow(resolvedAddProjectPath);
                } else {
                  void handleAddProject(resolvedAddProjectPath);
                }
              }}
            />
          }
        >
          <span>
            {isCloneDestinationStep && isRemoteProjectPending ? "正在克隆" : submitActionLabel}
          </span>
          <KbdGroup className="pointer-events-none -me-0.5 items-center gap-1">
            <Kbd>{hasHighlightedBrowseItem ? `${submitModifierLabel} Enter` : "Enter"}</Kbd>
          </KbdGroup>
        </TooltipTrigger>
        <TooltipPopup side="top">
          {submitActionLabel} ({addShortcutLabel})
        </TooltipPopup>
      </Tooltip>
    ) : null;

  const footerActionLabel =
    addProjectCloneFlow?.step === "repository"
      ? (remoteProjectButtonLabel ?? "继续")
      : !canSubmitBrowsePath || hasHighlightedBrowseItem
        ? "选择"
        : undefined;

  const footerTrailing = canOpenProjectFromFileManager ? (
    <Button
      variant="ghost"
      size="xs"
      className="h-auto px-2 text-muted-foreground text-xs hover:bg-transparent hover:text-foreground"
      disabled={isPickingProjectFolder}
      onClick={() => {
        void handleOpenProjectFromFileManager(browseEnvironmentId);
      }}
    >
      {`在 ${fileManagerName} 中打开`}
    </Button>
  ) : null;

  return (
    <CommandPaletteContent
      key={`${viewStack.length}-${browseGeneration}-${isBrowsing}-${addProjectCloneFlow?.step ?? "none"}`}
      aria-label="命令面板"
      autoHighlight={isBrowsing || isRemoteProjectCloneFlow ? false : "always"}
      footerActionLabel={footerActionLabel}
      footerTrailing={footerTrailing}
      inputAccessory={inputAccessory}
      inputProps={{
        className:
          addProjectCloneFlow?.step === "repository"
            ? "pe-32"
            : isBrowsing
              ? willCreateProjectPath
                ? "pe-36"
                : "pe-16"
              : undefined,
        placeholder: inputPlaceholder,
        wrapperClassName: isSubmenu
          ? "[&_[data-slot=autocomplete-start-addon]]:pointer-events-auto"
          : undefined,
        ...(isSubmenu
          ? {
              startAddon: (
                <button
                  type="button"
                  className="flex cursor-pointer items-center"
                  aria-label="返回"
                  onClick={popView}
                >
                  <ArrowLeftIcon />
                </button>
              ),
            }
          : isBrowsing
            ? { startAddon: <FolderPlusIcon /> }
            : {}),
        onKeyDown: handleKeyDown,
      }}
      mode="none"
      onItemHighlighted={(value) => {
        setHighlightedItemValue(typeof value === "string" ? value : null);
      }}
      onValueChange={handleQueryChange}
      panelClassName="max-h-[min(28rem,70vh)]"
      showBackHint={isSubmenu}
      value={query}
    >
      {remoteProjectContext ? (
        <div className="p-2 pb-0">
          <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">仓库</div>
          <div className="flex min-h-8 items-center gap-2 rounded-sm px-2 py-1.5">
            {remoteProjectContext.icon}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-foreground text-sm">{remoteProjectContext.title}</span>
              <span className="truncate text-muted-foreground/85 text-xs">
                {remoteProjectContext.description}
              </span>
            </span>
          </div>
        </div>
      ) : null}
      <CommandPaletteResults
        groups={displayedGroups}
        highlightedItemValue={highlightedItemValue}
        isActionsOnly={isActionsOnly}
        keybindings={keybindings}
        onExecuteItem={executeItem}
        {...(addProjectCloneFlow?.step === "repository"
          ? {
              emptyStateMessage:
                addProjectCloneFlow.source === "url"
                  ? "输入 Git 克隆地址，然后按 Enter 继续。"
                  : "输入仓库路径，然后按 Enter 查找。",
            }
          : addProjectCloneFlow?.step === "confirm"
            ? { emptyStateMessage: "选择目标目录，然后按 Enter 开始克隆。" }
            : relativePathNeedsActiveProject
              ? { emptyStateMessage: "相对路径需要先选择工作空间。" }
              : willCreateProjectPath
                ? {
                    emptyStateMessage: "按 Enter 创建此文件夹并添加为工作空间。",
                  }
                : threadSearch.isPending
                  ? { emptyStateMessage: "正在搜索任务消息…" }
                  : {})}
      />
    </CommandPaletteContent>
  );
}
