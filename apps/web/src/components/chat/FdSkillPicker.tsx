import {
  Building2Icon,
  CheckIcon,
  ChevronDownIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  MAX_FD_SKILLS_PER_TURN,
  type EnvironmentId,
  type ServerProvider,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { useFdSkillSelectionStore } from "../../fdSkillSelectionStore";
import {
  clearEnterpriseComposerDraft,
  excludeEnterpriseComposerDraftFromPersistence,
} from "../../composerDraftStore";
import { formatProviderSkillDisplayName } from "../../providerSkillPresentation";
import { refreshProviderSkillsCommand } from "../../state/providerSkills";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import { cn } from "~/lib/utils";

export type BusinessCapabilityCatalogState = "loading" | "ready" | "error";

export const MAX_VISIBLE_FD_SKILLS = 12;

export function resolveProviderSkillCatalogState(
  provider: Pick<ServerProvider, "skillCatalogState" | "status"> | null,
): BusinessCapabilityCatalogState {
  if (provider === null) return "loading";
  return provider.skillCatalogState ?? (provider.status === "error" ? "error" : "ready");
}

function versionIdFromPath(path: string): number | null {
  const match = /^fd-managed:\/\/(\d+)$/.exec(path.trim());
  if (!match) return null;
  const versionId = Number(match[1]);
  return Number.isSafeInteger(versionId) && versionId > 0 ? versionId : null;
}

export function partitionBusinessCapabilities(skills: ReadonlyArray<ServerProviderSkill>) {
  const enabled = skills.filter((skill) => skill.enabled);
  return {
    fdSkills: enabled
      .filter((skill) => skill.scope === "fd-managed" && versionIdFromPath(skill.path) !== null)
      .slice(0, MAX_VISIBLE_FD_SKILLS),
    localSkills: enabled.filter((skill) => skill.scope !== "fd-managed"),
  };
}

export function mergeBusinessCapabilities(
  providerSkills: ReadonlyArray<ServerProviderSkill>,
  projectSkills: ReadonlyArray<ServerProviderSkill>,
): ReadonlyArray<ServerProviderSkill> {
  const merged: ServerProviderSkill[] = [];
  const names = new Set<string>();
  const append = (skill: ServerProviderSkill) => {
    if (names.has(skill.name)) return;
    names.add(skill.name);
    merged.push(skill);
  };

  for (const skill of providerSkills) {
    if (skill.scope === "fd-managed" && versionIdFromPath(skill.path) !== null) append(skill);
  }
  for (const skill of projectSkills) {
    if (skill.scope !== "fd-managed") append(skill);
  }
  return merged;
}

/**
 * Drops selected FD Skills the account no longer has. The draft was written
 * for the whole selection, so losing any of it clears the draft as well.
 */
export function clearRevokedFdSkillSelection(input: {
  readonly threadId: string | null;
  readonly selectedVersionIds: ReadonlyArray<number>;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly providerCatalogState: BusinessCapabilityCatalogState;
}): boolean {
  const revoked = revokedFdSkillVersionIds(input);
  if (revoked.length === 0 || !input.threadId) return false;

  clearEnterpriseComposerDraft(input.threadId);
  useFdSkillSelectionStore.getState().replace(
    input.threadId,
    input.selectedVersionIds.filter((versionId) => !revoked.includes(versionId)),
  );
  return true;
}

/** Selected versions missing from a loaded catalog; none while it is loading or failed. */
export function revokedFdSkillVersionIds(input: {
  readonly selectedVersionIds: ReadonlyArray<number>;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly providerCatalogState: BusinessCapabilityCatalogState;
}): ReadonlyArray<number> {
  if (input.providerCatalogState !== "ready") return [];
  const authorized = new Set(
    input.skills
      .filter((skill) => skill.enabled && skill.scope === "fd-managed")
      .map((skill) => versionIdFromPath(skill.path)),
  );
  return input.selectedVersionIds.filter((versionId) => !authorized.has(versionId));
}

/** The composer chip text: the Skill's name, or the first name and how many more. */
export function fdSkillSelectionLabel(names: ReadonlyArray<string>): string {
  const [first, ...rest] = names;
  if (first === undefined) return "FD Skills";
  return rest.length === 0 ? first : `${first} +${rest.length}`;
}

const NO_FD_SKILLS: ReadonlyArray<number> = [];

export function FdSkillPicker(props: {
  threadId: string | null;
  skills: ReadonlyArray<ServerProviderSkill>;
  providerCatalogState?: BusinessCapabilityCatalogState;
  openRequest?: number;
  /** Environment whose catalog the refresh button rescans; omit to hide it. */
  environmentId?: EnvironmentId | null;
}) {
  const providerCatalogState = props.providerCatalogState ?? "ready";
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshProviderSkills = useAtomCommand(refreshProviderSkillsCommand, {
    reportFailure: false,
  });
  const refreshCatalog = async () => {
    if (!props.environmentId || refreshing) return;
    setRefreshing(true);
    const result = await refreshProviderSkills({ environmentId: props.environmentId, input: {} });
    setRefreshing(false);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Skill 列表刷新失败",
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    }
  };
  const [revokedNotice, setRevokedNotice] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const lastOpenRequestRef = useRef(props.openRequest ?? 0);
  const [menuPosition, setMenuPosition] = useState<{
    bottom: number;
    left: number;
    maxHeight: number;
  } | null>(null);
  const selectedVersionIds = useFdSkillSelectionStore((state) =>
    props.threadId ? (state.selectedByThread[props.threadId] ?? NO_FD_SKILLS) : NO_FD_SKILLS,
  );
  const { fdSkills } = useMemo(() => partitionBusinessCapabilities(props.skills), [props.skills]);
  const selectedSkillNames = fdSkills
    .filter((skill) => selectedVersionIds.includes(versionIdFromPath(skill.path)!))
    .map(formatProviderSkillDisplayName);
  const hasSelection = selectedVersionIds.length > 0;
  const limitReached = selectedVersionIds.length >= MAX_FD_SKILLS_PER_TURN;

  useEffect(() => {
    setOpen(false);
    setRevokedNotice(false);
  }, [props.threadId]);

  useEffect(() => {
    const openRequest = props.openRequest ?? 0;
    if (openRequest === lastOpenRequestRef.current) return;
    lastOpenRequestRef.current = openRequest;
    if (openRequest > 0 && props.threadId) setOpen(true);
  }, [props.openRequest, props.threadId]);

  useEffect(() => {
    const revoked = clearRevokedFdSkillSelection({
      threadId: props.threadId,
      selectedVersionIds,
      skills: props.skills,
      providerCatalogState,
    });
    if (revoked) setRevokedNotice(true);
  }, [props.skills, props.threadId, providerCatalogState, selectedVersionIds]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    // The menu no longer closes on a tick, so Escape has to dismiss it too.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    const updatePosition = () => {
      const rect = root.getBoundingClientRect();
      const menuWidth = Math.min(320, window.innerWidth - 32);
      setMenuPosition({
        bottom: window.innerHeight - rect.top + 8,
        left: Math.min(Math.max(16, rect.left), window.innerWidth - menuWidth - 16),
        // The menu opens upward: keep it inside the window and let the list scroll.
        maxHeight: Math.max(180, rect.top - 24),
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    observer?.observe(root);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  // The menu stays open while Skills are ticked so several can be picked in
  // one visit; it closes on an outside click or after clearing.
  const toggleFdSkill = (versionId: number) => {
    if (!props.threadId) return;
    useFdSkillSelectionStore.getState().toggle(props.threadId, versionId);
    excludeEnterpriseComposerDraftFromPersistence(props.threadId);
    setRevokedNotice(false);
  };
  const clearFdSkills = () => {
    if (!props.threadId) return;
    useFdSkillSelectionStore.getState().clear(props.threadId);
    setRevokedNotice(false);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative shrink-0" data-fd-skill-picker="true">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={
          selectedSkillNames.length > 0
            ? `FD Skills：${selectedSkillNames.join("、")}`
            : "FD Skills"
        }
        title={
          selectedSkillNames.length > 1
            ? `已选 ${selectedSkillNames.length} 个：${selectedSkillNames.join("、")}`
            : "选择 FD Skill（可多选）"
        }
        disabled={!props.threadId}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex h-8 max-w-48 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors",
          hasSelection
            ? "border-primary/50 bg-primary/10 text-foreground"
            : "border-border/70 bg-background/40 text-muted-foreground hover:bg-background/80 hover:text-foreground",
          !props.threadId && "cursor-not-allowed opacity-50",
        )}
      >
        <ShieldCheckIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{fdSkillSelectionLabel(selectedSkillNames)}</span>
        <ChevronDownIcon className="size-3 shrink-0" aria-hidden="true" />
      </button>

      {open && menuPosition
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              aria-multiselectable="true"
              aria-label="FD Skills"
              className="fixed z-[80] flex w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-xl"
              style={{
                bottom: menuPosition.bottom,
                left: menuPosition.left,
                maxHeight: menuPosition.maxHeight,
              }}
            >
              <div className="flex items-center justify-between gap-3 px-2.5 pb-2 pt-1.5">
                <div>
                  <div className="text-sm font-semibold">FD Skills</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    已授权 {fdSkills.length} 项 · 可多选，最多 {MAX_FD_SKILLS_PER_TURN} 个
                  </div>
                </div>
                {props.environmentId ? (
                  <button
                    type="button"
                    aria-label="刷新 Skill 列表"
                    title="刷新 Skill 列表（新授权的 Skill 无需重启应用）"
                    disabled={refreshing}
                    onClick={() => void refreshCatalog()}
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    <RefreshCwIcon
                      className={cn("size-3.5", refreshing && "animate-spin")}
                      aria-hidden="true"
                    />
                  </button>
                ) : (
                  <ShieldCheckIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                )}
              </div>
              {revokedNotice ? (
                <p
                  role="status"
                  className="mx-2 mb-2 rounded-md bg-warning/10 px-2.5 py-2 text-xs text-muted-foreground"
                >
                  所选 FD Skill 权限已更新，已为你清除。
                </p>
              ) : null}
              {hasSelection ? (
                <button
                  type="button"
                  onClick={clearFdSkills}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted"
                >
                  <XIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    {selectedVersionIds.length > 1
                      ? `清除已选的 ${selectedVersionIds.length} 个 FD Skill`
                      : "清除已选 FD Skill"}
                  </span>
                </button>
              ) : null}
              {limitReached ? (
                <p role="status" className="px-2.5 pb-1.5 text-[11px] text-muted-foreground">
                  已选满 {MAX_FD_SKILLS_PER_TURN} 个，取消一个后才能再选。
                </p>
              ) : null}
              {providerCatalogState === "loading" ? (
                <p role="status" className="px-2.5 py-2 text-xs text-muted-foreground">
                  正在加载 FD Skills…
                </p>
              ) : providerCatalogState === "error" ? (
                <p role="alert" className="px-2.5 py-2 text-xs text-muted-foreground">
                  FD Skills 暂不可用，请稍后重试。
                </p>
              ) : fdSkills.length === 0 ? (
                <p className="px-2.5 py-2 text-xs text-muted-foreground">
                  当前账号没有已授权的 FD Skills。
                </p>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {fdSkills.map((skill) => {
                    const versionId = versionIdFromPath(skill.path)!;
                    const selected = selectedVersionIds.includes(versionId);
                    const unavailable = limitReached && !selected;
                    return (
                      <button
                        key={`${skill.name}:${versionId}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        aria-disabled={unavailable}
                        disabled={unavailable}
                        onClick={() => toggleFdSkill(versionId)}
                        className={cn(
                          "flex min-h-12 w-full items-start gap-2.5 rounded-md border border-transparent px-2.5 py-2.5 text-left transition-colors hover:border-border/70 hover:bg-muted/70",
                          selected && "border-primary/25 bg-primary/8",
                          unavailable &&
                            "cursor-not-allowed opacity-50 hover:border-transparent hover:bg-transparent",
                        )}
                      >
                        <Building2Icon
                          className="mt-0.5 size-4 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">
                            {formatProviderSkillDisplayName(skill)}
                          </span>
                          {skill.shortDescription || skill.description ? (
                            <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">
                              {skill.shortDescription ?? skill.description}
                            </span>
                          ) : null}
                        </span>
                        {selected ? (
                          <CheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
              {fdSkills.length > 0 && providerCatalogState === "ready" ? (
                <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-border/60 px-2.5 pt-2 pb-0.5">
                  <span className="text-[11px] text-muted-foreground">
                    {hasSelection ? `已选 ${selectedVersionIds.length} 个` : "未选择"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    完成
                  </button>
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
