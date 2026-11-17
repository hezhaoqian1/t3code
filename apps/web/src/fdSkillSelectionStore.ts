import { MAX_FD_SKILLS_PER_TURN, normalizeFdSkillVersionIds } from "@t3tools/contracts";
import { create } from "zustand";

export const FD_SKILL_THREAD_TITLE = "FD Skill 对话";

const NO_FD_SKILLS: ReadonlyArray<number> = [];

interface FdSkillSelectionState {
  /** Selected FD Skill versions per conversation, ascending; a missing entry is none. */
  readonly selectedByThread: Readonly<Record<string, ReadonlyArray<number>>>;
  /** Adds or removes one Skill. Adding beyond the per-turn limit changes nothing. */
  readonly toggle: (threadId: string, versionId: number) => void;
  readonly replace: (threadId: string, versionIds: ReadonlyArray<number>) => void;
  readonly clear: (threadId: string) => void;
  readonly clearAll: () => void;
  readonly get: (threadId: string) => ReadonlyArray<number>;
}

export const useFdSkillSelectionStore = create<FdSkillSelectionState>((set, get) => {
  const replace = (threadId: string, versionIds: ReadonlyArray<number>) =>
    set((state) => {
      const next = normalizeFdSkillVersionIds(versionIds).slice(0, MAX_FD_SKILLS_PER_TURN);
      if (next.length === 0) {
        if (!(threadId in state.selectedByThread)) return state;
        const { [threadId]: _removed, ...rest } = state.selectedByThread;
        return { selectedByThread: rest };
      }
      return { selectedByThread: { ...state.selectedByThread, [threadId]: next } };
    });
  return {
    selectedByThread: {},
    toggle: (threadId, versionId) => {
      const current = get().selectedByThread[threadId] ?? NO_FD_SKILLS;
      if (current.includes(versionId)) {
        replace(
          threadId,
          current.filter((id) => id !== versionId),
        );
      } else if (current.length < MAX_FD_SKILLS_PER_TURN) {
        replace(threadId, [...current, versionId]);
      }
    },
    replace,
    clear: (threadId) => replace(threadId, NO_FD_SKILLS),
    clearAll: () => set({ selectedByThread: {} }),
    get: (threadId) => get().selectedByThread[threadId] ?? NO_FD_SKILLS,
  };
});

export function clearFdSkillSelection(threadId: string): void {
  useFdSkillSelectionStore.getState().clear(threadId);
}

export function clearAllFdSkillSelections(): void {
  useFdSkillSelectionStore.getState().clearAll();
}

/** The FD Skill versions selected for a conversation, ascending; empty for none. */
export function selectedFdSkillVersionIds(threadId: string): ReadonlyArray<number> {
  return useFdSkillSelectionStore.getState().get(threadId);
}

export function hasFdSkillSelection(threadId: string): boolean {
  return selectedFdSkillVersionIds(threadId).length > 0;
}
