import { create } from "zustand";

export const FD_SKILL_THREAD_TITLE = "FD Skill 对话";

interface FdSkillSelectionState {
  readonly selectedByThread: Readonly<Record<string, number | null>>;
  readonly select: (threadId: string, versionId: number | null) => void;
  readonly clear: (threadId: string) => void;
  readonly clearAll: () => void;
  readonly get: (threadId: string) => number | null;
}

export const useFdSkillSelectionStore = create<FdSkillSelectionState>((set, get) => ({
  selectedByThread: {},
  select: (threadId, versionId) =>
    set((state) => ({
      selectedByThread: { ...state.selectedByThread, [threadId]: versionId },
    })),
  clear: (threadId) =>
    set((state) => {
      if (!(threadId in state.selectedByThread)) return state;
      const next = { ...state.selectedByThread };
      delete next[threadId];
      return { selectedByThread: next };
    }),
  clearAll: () => set({ selectedByThread: {} }),
  get: (threadId) => get().selectedByThread[threadId] ?? null,
}));

export function clearFdSkillSelection(threadId: string): void {
  useFdSkillSelectionStore.getState().clear(threadId);
}

export function clearAllFdSkillSelections(): void {
  useFdSkillSelectionStore.getState().clearAll();
}

export function selectedFdSkillVersionId(threadId: string): number | undefined {
  const versionId = useFdSkillSelectionStore.getState().get(threadId);
  return versionId === null ? undefined : versionId;
}
