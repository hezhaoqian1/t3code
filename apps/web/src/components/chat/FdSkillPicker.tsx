import { Building2Icon, CheckIcon, ChevronDownIcon, ShieldCheckIcon, XIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ServerProvider, ServerProviderSkill } from "@t3tools/contracts";

import { useFdSkillSelectionStore } from "../../fdSkillSelectionStore";
import {
  clearEnterpriseComposerDraft,
  excludeEnterpriseComposerDraftFromPersistence,
} from "../../composerDraftStore";
import { formatProviderSkillDisplayName } from "../../providerSkillPresentation";
import { cn } from "~/lib/utils";

export type BusinessCapabilityCatalogState = "loading" | "ready" | "error";

export const MAX_VISIBLE_FD_SKILLS = 4;

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

export function clearRevokedFdSkillSelection(input: {
  readonly threadId: string | null;
  readonly selectedVersionId: number | null;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly providerCatalogState: BusinessCapabilityCatalogState;
}): boolean {
  if (
    !shouldClearRevokedFdSkillSelection({
      selectedVersionId: input.selectedVersionId,
      skills: input.skills,
      providerCatalogState: input.providerCatalogState,
    }) ||
    !input.threadId
  ) {
    return false;
  }

  clearEnterpriseComposerDraft(input.threadId);
  useFdSkillSelectionStore.getState().clear(input.threadId);
  return true;
}

export function shouldClearRevokedFdSkillSelection(input: {
  readonly selectedVersionId: number | null;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly providerCatalogState: BusinessCapabilityCatalogState;
}): boolean {
  if (input.providerCatalogState !== "ready" || input.selectedVersionId === null) return false;
  return !input.skills.some(
    (skill) =>
      skill.enabled &&
      skill.scope === "fd-managed" &&
      versionIdFromPath(skill.path) === input.selectedVersionId,
  );
}

export function FdSkillPicker(props: {
  threadId: string | null;
  skills: ReadonlyArray<ServerProviderSkill>;
  providerCatalogState?: BusinessCapabilityCatalogState;
}) {
  const providerCatalogState = props.providerCatalogState ?? "ready";
  const [open, setOpen] = useState(false);
  const [revokedNotice, setRevokedNotice] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ bottom: number; left: number } | null>(null);
  const selectedVersionId = useFdSkillSelectionStore((state) =>
    props.threadId ? (state.selectedByThread[props.threadId] ?? null) : null,
  );
  const { fdSkills } = useMemo(() => partitionBusinessCapabilities(props.skills), [props.skills]);
  const selectedSkill = fdSkills.find(
    (skill) => versionIdFromPath(skill.path) === selectedVersionId,
  );

  useEffect(() => {
    setOpen(false);
    setRevokedNotice(false);
  }, [props.threadId]);

  useEffect(() => {
    const revoked = clearRevokedFdSkillSelection({
      threadId: props.threadId,
      selectedVersionId,
      skills: props.skills,
      providerCatalogState,
    });
    if (revoked) setRevokedNotice(true);
  }, [props.skills, props.threadId, providerCatalogState, selectedVersionId]);

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
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
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

  const selectFdSkill = (versionId: number | null) => {
    if (!props.threadId) return;
    if (versionId === null) clearEnterpriseComposerDraft(props.threadId);
    useFdSkillSelectionStore.getState().select(props.threadId, versionId);
    if (versionId !== null) excludeEnterpriseComposerDraftFromPersistence(props.threadId);
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
          selectedSkill
            ? `FD Skills：${formatProviderSkillDisplayName(selectedSkill)}`
            : "FD Skills"
        }
        title="选择 FD Skill"
        disabled={!props.threadId}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex h-8 max-w-48 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors",
          selectedSkill
            ? "border-primary/50 bg-primary/10 text-foreground"
            : "border-border/70 bg-background/40 text-muted-foreground hover:bg-background/80 hover:text-foreground",
          !props.threadId && "cursor-not-allowed opacity-50",
        )}
      >
        <ShieldCheckIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {selectedSkill ? formatProviderSkillDisplayName(selectedSkill) : "FD Skills"}
        </span>
        <ChevronDownIcon className="size-3 shrink-0" aria-hidden="true" />
      </button>

      {open && menuPosition
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              aria-label="FD Skills"
              className="fixed z-[80] w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-xl"
              style={{ bottom: menuPosition.bottom, left: menuPosition.left }}
            >
              <div className="flex items-center justify-between gap-3 px-2.5 pb-2 pt-1.5">
                <div>
                  <div className="text-sm font-semibold">FD Skills</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    已授权 {fdSkills.length} 项
                  </div>
                </div>
                <ShieldCheckIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
              </div>
              {revokedNotice ? (
                <p
                  role="status"
                  className="mx-2 mb-2 rounded-md bg-warning/10 px-2.5 py-2 text-xs text-muted-foreground"
                >
                  所选 FD Skill 权限已更新，已为你清除。
                </p>
              ) : null}
              {selectedVersionId !== null ? (
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  onClick={() => selectFdSkill(null)}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted"
                >
                  <XIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">清除已选 FD Skill</span>
                </button>
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
                fdSkills.map((skill) => {
                  const versionId = versionIdFromPath(skill.path)!;
                  const selected = versionId === selectedVersionId;
                  return (
                    <button
                      key={`${skill.name}:${versionId}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => selectFdSkill(versionId)}
                      className={cn(
                        "flex min-h-12 w-full items-start gap-2.5 rounded-md border border-transparent px-2.5 py-2.5 text-left transition-colors hover:border-border/70 hover:bg-muted/70",
                        selected && "border-primary/25 bg-primary/8",
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
                })
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
