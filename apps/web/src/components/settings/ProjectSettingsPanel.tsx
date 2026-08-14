import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  deriveProjectGroupingOverrideKey,
  selectProjectGroupingSettings,
} from "../../logicalProject";
import type {
  SidebarProjectGroupingMode,
  T3ProjectFileScript,
  ThreadEnvMode,
} from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import { CopyIcon, FolderIcon, PlusIcon, SettingsIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { isElectron } from "../../env";
import { excludeOfficeWorkspaceProjects } from "../../officeMode";
import {
  useClientSettings,
  useUpdateClientSettings,
  usePrimarySettings,
} from "../../hooks/useSettings";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useT3ProjectFileState } from "../../hooks/useT3ProjectFileScripts";
import { shortcutLabelForCommand } from "../../keybindings";
import { keybindingValueForCommand } from "../../lib/projectScriptKeybindings";
import { readLocalApi } from "../../localApi";
import {
  buildProjectScript,
  commandForProjectScript,
  nextProjectScriptId,
} from "../../projectScripts";
import { decodeProjectScriptKeybindingRule } from "../../lib/projectScriptKeybindings";
import {
  buildSidebarProjectSnapshots,
  type SidebarProjectGroupMember,
  type SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { usePrimaryProjects, usePrimaryThreadShells } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import {
  primaryServerKeybindingsAtom,
  primaryServerWelcomeAtom,
  serverEnvironment,
} from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  EMPTY_PROJECT_SCRIPT_INPUT,
  editorRequestForScript,
  ProjectScriptEditorDialog,
  ScriptIcon,
  type NewProjectScriptInput,
  type ProjectScriptEditorRequest,
} from "../projectScriptEditor";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

export const PROJECT_GROUPING_MODE_LABELS: Record<SidebarProjectGroupingMode, string> = {
  repository: "按代码仓库分组",
  repository_path: "按仓库路径分组",
  separate: "保持独立",
};

function localizedEnvModeLabel(mode: ThreadEnvMode): string {
  return mode === "worktree" ? "新建工作树" : "当前检出目录";
}

/** Logical project groups for the settings page, sorted by display name. */
export function useSettingsProjectGroups(): SidebarProjectSnapshot[] {
  const projects = usePrimaryProjects();
  const primaryServerWelcome = useAtomValue(primaryServerWelcomeAtom);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  return useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects: excludeOfficeWorkspaceProjects({
          isDesktop: isElectron,
          projects,
          bootstrapProjectId: primaryServerWelcome?.bootstrapProjectId,
          bootstrapEnvironmentId: primaryServerWelcome?.environment.environmentId,
        }),
        settings: projectGroupingSettings,
        primaryEnvironmentId,
      }).sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [primaryEnvironmentId, primaryServerWelcome, projectGroupingSettings, projects],
  );
}

function memberKey(member: { environmentId: string; id: string }): string {
  return `${member.environmentId}:${member.id}`;
}

export function ProjectSettingsPanel({
  selectedProjectKey,
}: {
  selectedProjectKey: string | null;
}) {
  const groups = useSettingsProjectGroups();
  const navigate = useNavigate();
  const currentHash = useLocation({ select: (location) => location.hash });

  // The index route auto-selects the first project so /settings/projects is
  // never a dead end. Hash is preserved for settings-search jumps.
  useEffect(() => {
    if (selectedProjectKey !== null) return;
    const first = groups[0];
    if (!first) return;
    void navigate({
      to: "/settings/projects/$projectKey",
      params: { projectKey: first.projectKey },
      ...(currentHash ? { hash: currentHash } : {}),
      replace: true,
      hashScrollIntoView: false,
    });
  }, [currentHash, groups, navigate, selectedProjectKey]);

  const selected =
    selectedProjectKey === null
      ? null
      : (groups.find((group) => group.projectKey === selectedProjectKey) ?? null);

  // Remember the members of the last rendered group so a grouping-rule change
  // (which changes the group key) can follow the project to its new group.
  const lastSelectionRef = useRef<{ key: string; memberKeys: string[] } | null>(null);
  useEffect(() => {
    if (!selected) return;
    lastSelectionRef.current = {
      key: selected.projectKey,
      memberKeys: selected.memberProjects.map((member) => member.physicalProjectKey),
    };
  }, [selected]);

  // Recover when the selected key stops matching (regroup, removal, or a
  // stale deep link) instead of parking on a dead-end message.
  useEffect(() => {
    if (selectedProjectKey === null || selected !== null || groups.length === 0) return;
    const last = lastSelectionRef.current;
    const successor =
      last?.key === selectedProjectKey
        ? (groups.find((group) =>
            group.memberProjects.some((member) =>
              last.memberKeys.includes(member.physicalProjectKey),
            ),
          ) ?? null)
        : null;
    if (successor) {
      void navigate({
        to: "/settings/projects/$projectKey",
        params: { projectKey: successor.projectKey },
        replace: true,
        hashScrollIntoView: false,
      });
    } else {
      void navigate({ to: "/settings/projects", replace: true, hashScrollIntoView: false });
    }
  }, [groups, navigate, selected, selectedProjectKey]);

  const selectProject = useCallback(
    (projectKey: string) => {
      void navigate({
        to: "/settings/projects/$projectKey",
        params: { projectKey },
        replace: true,
        hashScrollIntoView: false,
      });
    },
    [navigate],
  );

  return (
    <div className="flex min-h-0 flex-1">
      <nav
        aria-label="工作空间"
        className="w-60 shrink-0 space-y-0.5 overflow-y-auto border-e border-border/40 p-3 pt-10 max-sm:hidden sm:pt-12"
      >
        {groups.map((group) => {
          const isActive = group.projectKey === selected?.projectKey;
          return (
            <button
              key={group.projectKey}
              type="button"
              onClick={() => selectProject(group.projectKey)}
              className={`flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isActive
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              }`}
            >
              <ProjectFavicon
                environmentId={group.environmentId}
                cwd={group.workspaceRoot}
                className="size-4 shrink-0"
              />
              <span className="min-w-0 flex-1 truncate">{group.displayName}</span>
              {group.groupedProjectCount > 1 ? (
                <span className="shrink-0 text-xs text-muted-foreground/70">
                  {group.groupedProjectCount}
                </span>
              ) : null}
            </button>
          );
        })}
        {groups.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">暂时没有工作空间。</p>
        ) : null}
      </nav>
      {selected ? (
        <ProjectDetail
          key={selected.projectKey}
          group={selected}
          groups={groups}
          onSelectProject={selectProject}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
          {groups.length === 0 ? "请先从侧栏导入工作空间，再在这里进行配置。" : null}
        </div>
      )}
    </div>
  );
}

function ProjectDetail({
  group,
  groups,
  onSelectProject,
}: {
  group: SidebarProjectSnapshot;
  groups: ReadonlyArray<SidebarProjectSnapshot>;
  onSelectProject: (projectKey: string) => void;
}) {
  const navigate = useNavigate();
  const settings = usePrimarySettings();
  const updateClientSettings = useUpdateClientSettings();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const threads = usePrimaryThreadShells();
  const updateProject = useAtomCommand(projectEnvironment.update, { reportFailure: false });
  const deleteProject = useAtomCommand(projectEnvironment.delete, { reportFailure: false });
  const upsertKeybinding = useAtomCommand(serverEnvironment.upsertKeybinding, {
    reportFailure: false,
  });
  const removeKeybinding = useAtomCommand(serverEnvironment.removeKeybinding, {
    reportFailure: false,
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>({
    onCopy: ({ path }) => {
      toastManager.add({ type: "success", title: "路径已复制", description: path });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "复制路径失败",
          description: error instanceof Error ? error.message : "复制路径时发生错误。",
        }),
      );
    },
  });

  const representative =
    group.memberProjects.find(
      (member) => member.environmentId === group.environmentId && member.id === group.id,
    ) ?? group.memberProjects[0]!;

  const threadCountByMember = useMemo(() => {
    const counts = new Map<string, number>();
    for (const thread of threads) {
      const key = `${thread.environmentId}:${thread.projectId}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [threads]);
  const groupThreadCount = group.memberProjects.reduce(
    (total, member) => total + (threadCountByMember.get(memberKey(member)) ?? 0),
    0,
  );

  const reportFailure = useCallback((title: string, result: AtomCommandResult<void, unknown>) => {
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: error instanceof Error ? error.message : "操作时发生错误。",
      }),
    );
  }, []);

  // Group-shared script fields live on each physical project record, so a
  // group-level edit fans out to every member.
  const updateAllMembers = useCallback(
    async (
      input: Partial<{
        defaultThreadEnvMode: ThreadEnvMode | null;
        scripts: ReadonlyArray<ReturnType<typeof buildProjectScript>>;
      }>,
      failureTitle: string,
    ): Promise<AtomCommandResult<void, unknown>> => {
      for (const member of group.memberProjects) {
        const result = mapAtomCommandResult(
          await updateProject({
            environmentId: member.environmentId,
            input: { projectId: member.id, ...input },
          }),
          () => undefined,
        );
        if (result._tag === "Failure") {
          reportFailure(failureTitle, result);
          return result;
        }
      }
      return AsyncResult.success(undefined);
    },
    [group.memberProjects, reportFailure, updateProject],
  );

  // ----- new-thread workspace mode -----
  const storedEnvMode = representative.defaultThreadEnvMode ?? null;
  const setDefaultThreadEnvMode = useCallback(
    (mode: ThreadEnvMode | null) =>
      void updateAllMembers({ defaultThreadEnvMode: mode }, "更新新任务工作空间失败"),
    [updateAllMembers],
  );

  // ----- scripts -----
  const scripts = representative.scripts;
  const [editorRequest, setEditorRequest] = useState<ProjectScriptEditorRequest | null>(null);
  // Script writes replace the whole array, so two overlapping writes computed
  // from the same snapshot would drop each other's changes. One at a time.
  const [isSavingScripts, setIsSavingScripts] = useState(false);
  const savingScriptsRef = useRef(false);
  const t3File = useT3ProjectFileState(representative.environmentId, representative.workspaceRoot);
  // What the "Default" option resolves to while no override is set: the
  // repo's t3.json value when present, otherwise the global setting.
  const inheritedEnvMode = t3File.file?.defaultThreadEnvMode ?? settings.defaultThreadEnvMode;
  const inheritedEnvModeSource = t3File.file?.defaultThreadEnvMode != null ? "t3.json" : "global";
  const importableScripts = useMemo(
    () =>
      t3File.scripts.filter(
        (fileScript) =>
          !scripts.some(
            (script) =>
              script.command === fileScript.command ||
              script.name.toLowerCase() === fileScript.name.toLowerCase(),
          ),
      ),
    [scripts, t3File.scripts],
  );

  const persistScripts = useCallback(
    async (
      nextScripts: ReadonlyArray<ReturnType<typeof buildProjectScript>>,
      keybinding: string | null | undefined,
      keybindingCommand: ReturnType<typeof commandForProjectScript>,
    ): Promise<AtomCommandResult<void, unknown>> => {
      if (savingScriptsRef.current) {
        return AsyncResult.failure(Cause.fail(new Error("另一个脚本改动仍在保存，请稍后重试。")));
      }
      savingScriptsRef.current = true;
      setIsSavingScripts(true);
      try {
        // Captured before the write so a cleared or deleted binding can be
        // removed from the keybindings config afterwards.
        const previousKeybinding = keybindingValueForCommand(keybindings, keybindingCommand);
        const updateResult = await updateAllMembers({ scripts: nextScripts }, "保存脚本失败");
        if (updateResult._tag === "Failure") return updateResult;

        const keybindingRule = decodeProjectScriptKeybindingRule({
          keybinding,
          command: keybindingCommand,
        });
        if (!isElectron) return updateResult;
        const previousTarget = previousKeybinding
          ? decodeProjectScriptKeybindingRule({
              keybinding: previousKeybinding,
              command: keybindingCommand,
            })
          : null;
        if (keybindingRule) {
          // `replace` swaps the command's previous rule instead of appending a
          // second one that would keep the old shortcut alive.
          const input =
            previousTarget && previousTarget.key !== keybindingRule.key
              ? { ...keybindingRule, replace: previousTarget }
              : keybindingRule;
          const result = mapAtomCommandResult(
            await upsertKeybinding({ environmentId: representative.environmentId, input }),
            () => undefined,
          );
          if (result._tag === "Failure") {
            reportFailure("保存快捷键失败", result);
            return result;
          }
        } else if (previousTarget) {
          const result = mapAtomCommandResult(
            await removeKeybinding({
              environmentId: representative.environmentId,
              input: previousTarget,
            }),
            () => undefined,
          );
          if (result._tag === "Failure") {
            reportFailure("移除快捷键失败", result);
            return result;
          }
        }
        return updateResult;
      } finally {
        savingScriptsRef.current = false;
        setIsSavingScripts(false);
      }
    },
    [
      keybindings,
      representative.environmentId,
      removeKeybinding,
      reportFailure,
      updateAllMembers,
      upsertKeybinding,
    ],
  );

  const submitScript = useCallback(
    async (
      scriptId: string | null,
      input: NewProjectScriptInput,
    ): Promise<AtomCommandResult<void, unknown>> => {
      if (scriptId === null) {
        const nextId = nextProjectScriptId(
          input.name,
          scripts.map((script) => script.id),
        );
        const nextScript = buildProjectScript(nextId, input);
        const nextScripts = input.runOnWorktreeCreate
          ? [
              ...scripts.map((script) =>
                script.runOnWorktreeCreate ? { ...script, runOnWorktreeCreate: false } : script,
              ),
              nextScript,
            ]
          : [...scripts, nextScript];
        return persistScripts(nextScripts, input.keybinding, commandForProjectScript(nextId));
      }

      const updatedScript = buildProjectScript(scriptId, input);
      const nextScripts = scripts.map((script) =>
        script.id === scriptId
          ? updatedScript
          : input.runOnWorktreeCreate
            ? { ...script, runOnWorktreeCreate: false }
            : script,
      );
      return persistScripts(nextScripts, input.keybinding, commandForProjectScript(scriptId));
    },
    [persistScripts, scripts],
  );

  const deleteScript = useCallback(
    (scriptId: string) => {
      const nextScripts = scripts.filter((script) => script.id !== scriptId);
      void persistScripts(nextScripts, null, commandForProjectScript(scriptId));
    },
    [persistScripts, scripts],
  );

  const importFileScript = useCallback(
    async (fileScript: T3ProjectFileScript) => {
      const payload: NewProjectScriptInput = {
        name: fileScript.name,
        command: fileScript.command,
        icon: fileScript.icon ?? "play",
        runOnWorktreeCreate: fileScript.runOnWorktreeCreate ?? false,
        keybinding: null,
        previewUrl: fileScript.previewUrl ?? null,
        autoOpenPreview: fileScript.previewUrl ? (fileScript.autoOpenPreview ?? false) : false,
      };
      const result = await submitScript(null, payload);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setEditorRequest({
          scriptId: null,
          initial: payload,
          error: error instanceof Error ? error.message : "导入操作失败。",
        });
      }
    },
    [submitScript],
  );

  // ----- checkouts -----
  const renameMember = useCallback(
    async (member: SidebarProjectGroupMember, nextTitle: string) => {
      const title = nextTitle.trim();
      if (!title) {
        toastManager.add({ type: "warning", title: "工作空间名称不能为空" });
        return;
      }
      if (title === member.title) return;
      const result = mapAtomCommandResult(
        await updateProject({
          environmentId: member.environmentId,
          input: { projectId: member.id, title },
        }),
        () => undefined,
      );
      reportFailure("重命名工作空间失败", result);
    },
    [reportFailure, updateProject],
  );

  const updateGroupingPreference = useCallback(
    (member: SidebarProjectGroupMember, selection: SidebarProjectGroupingMode | "inherit") => {
      const overrideKey = deriveProjectGroupingOverrideKey(member);
      const nextOverrides = { ...projectGroupingSettings.sidebarProjectGroupingOverrides };
      if (selection === "inherit") {
        delete nextOverrides[overrideKey];
      } else {
        nextOverrides[overrideKey] = selection;
      }
      updateClientSettings({ sidebarProjectGroupingOverrides: nextOverrides });
    },
    [projectGroupingSettings.sidebarProjectGroupingOverrides, updateClientSettings],
  );

  const removeMembers = useCallback(
    async (members: ReadonlyArray<SidebarProjectGroupMember>) => {
      const api = readLocalApi();
      if (!api) return;

      const memberKeys = new Set(members.map(memberKey));
      const projectThreads = threads.filter((thread) =>
        memberKeys.has(`${thread.environmentId}:${thread.projectId}`),
      );
      const isWholeGroup = members.length === group.memberProjects.length;
      const singleMember = members.length === 1 ? members[0]! : null;
      const targetLabel = singleMember?.title ?? group.displayName;
      const confirmed = await settlePromise(() =>
        api.dialogs.confirm(
          [
            projectThreads.length > 0
              ? `移除工作空间“${targetLabel}”并删除其中的 ${projectThreads.length} 个任务？`
              : `移除工作空间“${targetLabel}”？`,
            ...(singleMember
              ? [`路径：${singleMember.workspaceRoot}`]
              : [`这将移除 ${members.length} 个已分组的工作空间条目。`]),
            ...(projectThreads.length > 0 ? ["相关任务的对话历史将被永久清除。"] : []),
            isWholeGroup
              ? "这里只移除工作空间记录，不会删除磁盘上的文件。"
              : "同一分组中的其他工作空间不会受到影响。",
            "此操作无法撤销。",
          ].join("\n"),
        ),
      );
      if (confirmed._tag === "Failure" || !confirmed.value) return;

      const draftStore = useComposerDraftStore.getState();
      for (const member of members) {
        const memberThreads = projectThreads.filter(
          (thread) =>
            thread.environmentId === member.environmentId && thread.projectId === member.id,
        );
        const result = mapAtomCommandResult(
          await deleteProject({
            environmentId: member.environmentId,
            input: {
              projectId: member.id,
              ...(memberThreads.length > 0 ? { force: true } : {}),
            },
          }),
          () => undefined,
        );
        if (result._tag === "Failure") {
          reportFailure(`移除“${member.title}”失败`, result);
          return;
        }
        const projectRef = scopeProjectRef(member.environmentId, member.id);
        const projectDraftThread = draftStore.getDraftThreadByProjectRef(projectRef);
        if (projectDraftThread) {
          draftStore.clearDraftThread(projectDraftThread.draftId);
        }
        draftStore.clearProjectDraftThreadId(projectRef);
      }

      if (isWholeGroup) {
        void navigate({ to: "/settings/projects", replace: true });
      }
    },
    [
      deleteProject,
      group.displayName,
      group.memberProjects.length,
      navigate,
      reportFailure,
      threads,
    ],
  );

  const repositoryLine =
    representative.repositoryIdentity?.displayName ??
    representative.repositoryIdentity?.canonicalKey ??
    "未检测到 Git 远程仓库";
  return (
    <SettingsPageContainer className="gap-10">
      <div className="flex items-center gap-3 px-3 sm:px-4">
        <ProjectFavicon
          environmentId={group.environmentId}
          cwd={group.workspaceRoot}
          className="size-8 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-[-0.02em] text-foreground">
            {group.displayName}
          </h1>
          <p className="truncate text-[13px] text-muted-foreground">
            {repositoryLine}
            {" · "}
            {group.memberProjects.length === 1
              ? "1 个检出目录"
              : `${group.memberProjects.length} 个检出目录`}
            {" · "}
            {groupThreadCount === 1 ? "1 个任务" : `${groupThreadCount} 个任务`}
          </p>
        </div>
        <Select value={group.projectKey} onValueChange={(value) => onSelectProject(String(value))}>
          <SelectTrigger className="sm:hidden" aria-label="切换工作空间">
            <SelectValue>{group.displayName}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {groups.map((candidate) => (
              <SelectItem key={candidate.projectKey} hideIndicator value={candidate.projectKey}>
                {candidate.displayName}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>

      <SettingsSection title="新任务">
        <SettingsRow
          id="project-new-thread-workspace"
          title="工作空间"
          description="新任务在此工作空间中开始。它会覆盖 t3.json 和全局默认设置，并应用于此分组中的所有检出目录。"
          resetAction={
            storedEnvMode !== null ? (
              <SettingResetButton
                label="project workspace default"
                onClick={() => setDefaultThreadEnvMode(null)}
              />
            ) : null
          }
          control={
            <Select
              value={storedEnvMode ?? "inherit"}
              onValueChange={(value) => {
                if (value === "worktree" || value === "local") {
                  setDefaultThreadEnvMode(value);
                } else if (value === "inherit") {
                  setDefaultThreadEnvMode(null);
                }
              }}
            >
              <SelectTrigger aria-label="新任务工作空间">
                <SelectValue>
                  {storedEnvMode === null
                    ? `默认（${localizedEnvModeLabel(inheritedEnvMode)}）`
                    : localizedEnvModeLabel(storedEnvMode)}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="inherit">
                  默认（{inheritedEnvModeSource === "global" ? "全局设置" : inheritedEnvModeSource}
                  ：{localizedEnvModeLabel(inheritedEnvMode)}）
                </SelectItem>
                <SelectItem value="worktree">{localizedEnvModeLabel("worktree")}</SelectItem>
                <SelectItem value="local">{localizedEnvModeLabel("local")}</SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection
        id="project-scripts"
        title="脚本"
        headerAction={
          <Button
            size="xs"
            variant="outline"
            disabled={isSavingScripts}
            onClick={() =>
              setEditorRequest({ scriptId: null, initial: EMPTY_PROJECT_SCRIPT_INPUT })
            }
          >
            <PlusIcon className="size-3.5" />
            添加操作
          </Button>
        }
      >
        {scripts.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground sm:px-4">
            暂无脚本。脚本会从任务顶部栏在工作空间终端中运行，也可以设置一个脚本在创建工作树时自动执行。
          </p>
        ) : (
          <div className="space-y-0.5">
            {scripts.map((script) => {
              const shortcutLabel = shortcutLabelForCommand(
                keybindings,
                commandForProjectScript(script.id),
              );
              return (
                <div
                  key={script.id}
                  className="group flex min-w-0 items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent/50 sm:px-4"
                >
                  <ScriptIcon
                    icon={script.icon}
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="shrink-0 text-sm font-medium text-foreground">
                    {script.name}
                  </span>
                  {script.runOnWorktreeCreate ? (
                    <span className="shrink-0 rounded-sm border border-border/60 px-1.5 py-px text-[11px] text-muted-foreground">
                      初始化
                    </span>
                  ) : null}
                  {script.previewUrl ? (
                    <span className="shrink-0 rounded-sm border border-border/60 px-1.5 py-px text-[11px] text-muted-foreground max-sm:hidden">
                      预览 · 仅桌面端
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground/80">
                    {script.command}
                  </span>
                  {shortcutLabel ? (
                    <span className="shrink-0 text-xs text-muted-foreground">{shortcutLabel}</span>
                  ) : null}
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                    aria-label={`编辑 ${script.name}`}
                    disabled={isSavingScripts}
                    onClick={() => setEditorRequest(editorRequestForScript(script, keybindings))}
                  >
                    <SettingsIcon className="size-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        {t3File.status === "invalid" ? (
          <SettingsRow
            title="t3.json 无效"
            description="工作空间根目录存在 t3.json，但文件解析失败，其中声明的脚本和图标都会被忽略。请检查 JSON 语法和图标值。"
            className="text-warning"
          />
        ) : null}
        {importableScripts.length > 0 ? (
          <SettingsRow
            title="从 t3.json 导入"
            description={`此仓库的 t3.json 中还有 ${importableScripts.length} 个脚本尚未导入。`}
            control={
              <div className="flex flex-wrap justify-end gap-1.5">
                {importableScripts.map((fileScript) => (
                  <Button
                    key={`${fileScript.name} ${fileScript.command}`}
                    size="xs"
                    variant="outline"
                    disabled={isSavingScripts}
                    onClick={() => void importFileScript(fileScript)}
                  >
                    <ScriptIcon icon={fileScript.icon ?? "play"} className="size-3.5" />
                    {fileScript.name}
                  </Button>
                ))}
              </div>
            }
          />
        ) : null}
      </SettingsSection>

      <SettingsSection id="project-checkouts" title="检出目录">
        <div className="space-y-2 px-3 sm:px-4">
          {group.memberProjects.map((member) => {
            const threadCount = threadCountByMember.get(memberKey(member)) ?? 0;
            const groupingOverride =
              projectGroupingSettings.sidebarProjectGroupingOverrides?.[
                deriveProjectGroupingOverrideKey(member)
              ] ?? "inherit";
            return (
              <div
                key={member.physicalProjectKey}
                className="space-y-3 rounded-lg border border-border/50 p-3"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    {member.title}
                  </span>
                  <span className="ms-auto shrink-0 text-xs text-muted-foreground">
                    {threadCount === 1 ? "1 个任务" : `${threadCount} 个任务`}
                  </span>
                  {group.memberProjects.length > 1 ? (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="shrink-0 text-muted-foreground hover:text-destructive-foreground"
                      aria-label={`移除检出目录 ${member.workspaceRoot}`}
                      onClick={() => void removeMembers([member])}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
                <div className="flex min-w-0 items-center gap-1.5">
                  <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
                  <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                    {member.workspaceRoot}
                  </span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-4 shrink-0 rounded-sm"
                    aria-label="复制工作空间路径"
                    onClick={() =>
                      copyPathToClipboard(member.workspaceRoot, { path: member.workspaceRoot })
                    }
                  >
                    <CopyIcon className="size-3" />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid min-w-0 gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">名称</span>
                    <Input
                      key={`${member.physicalProjectKey}:${member.title}`}
                      aria-label={`工作空间名称：${member.workspaceRoot}`}
                      defaultValue={member.title}
                      onBlur={(event) => {
                        void renameMember(member, event.currentTarget.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                  </label>
                  <label className="grid min-w-0 gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">分组规则</span>
                    <Select
                      value={groupingOverride}
                      onValueChange={(value) => {
                        if (
                          value === "inherit" ||
                          value === "repository" ||
                          value === "repository_path" ||
                          value === "separate"
                        ) {
                          updateGroupingPreference(member, value);
                        }
                      }}
                    >
                      <SelectTrigger
                        className="w-full"
                        aria-label={`分组规则：${member.workspaceRoot}`}
                      >
                        <SelectValue>
                          {groupingOverride === "inherit"
                            ? `默认（${PROJECT_GROUPING_MODE_LABELS[projectGroupingSettings.sidebarProjectGroupingMode]}）`
                            : PROJECT_GROUPING_MODE_LABELS[groupingOverride]}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup align="start" alignItemWithTrigger={false}>
                        <SelectItem hideIndicator value="inherit">
                          使用全局默认
                        </SelectItem>
                        <SelectItem hideIndicator value="repository">
                          {PROJECT_GROUPING_MODE_LABELS.repository}
                        </SelectItem>
                        <SelectItem hideIndicator value="repository_path">
                          {PROJECT_GROUPING_MODE_LABELS.repository_path}
                        </SelectItem>
                        <SelectItem hideIndicator value="separate">
                          {PROJECT_GROUPING_MODE_LABELS.separate}
                        </SelectItem>
                      </SelectPopup>
                    </Select>
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="危险操作">
        <SettingsRow
          title={group.memberProjects.length > 1 ? "移除分组工作空间" : "移除工作空间"}
          description={
            group.memberProjects.length > 1
              ? `删除全部 ${group.memberProjects.length} 个检出目录及其任务，不会删除磁盘上的文件。`
              : "删除工作空间及其任务，不会删除磁盘上的文件。"
          }
          control={
            <Button
              variant="destructive-outline"
              onClick={() => void removeMembers(group.memberProjects)}
            >
              <Trash2Icon />
              {group.memberProjects.length > 1 ? "移除全部条目" : "移除工作空间"}
            </Button>
          }
        />
      </SettingsSection>

      <ProjectScriptEditorDialog
        request={editorRequest}
        scripts={scripts}
        onSubmit={submitScript}
        onDelete={deleteScript}
        onClose={() => setEditorRequest(null)}
      />
    </SettingsPageContainer>
  );
}
