import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  FD_SKILL_THREAD_TITLE,
  clearAllFdSkillSelections,
  clearFdSkillSelection,
  selectedFdSkillVersionId,
  useFdSkillSelectionStore,
} from "./fdSkillSelectionStore";

describe("fdSkillSelectionStore", () => {
  beforeEach(() => {
    useFdSkillSelectionStore.setState({ selectedByThread: {} });
  });

  it("keeps selection on its conversation and defaults a new conversation to none", () => {
    useFdSkillSelectionStore.getState().select("thread-a", 10004);

    expect(selectedFdSkillVersionId("thread-a")).toBe(10004);
    expect(selectedFdSkillVersionId("thread-b")).toBeUndefined();
    expect(FD_SKILL_THREAD_TITLE).toBe("FD Skill 对话");
  });

  it("clears a selected FD Skill without changing other conversations", () => {
    const store = useFdSkillSelectionStore.getState();
    store.select("thread-a", 10004);
    store.select("thread-b", 10003);
    clearFdSkillSelection("thread-a");

    expect(selectedFdSkillVersionId("thread-a")).toBeUndefined();
    expect(selectedFdSkillVersionId("thread-b")).toBe(10003);
  });

  it("clears every account-scoped selection at an identity boundary", () => {
    const store = useFdSkillSelectionStore.getState();
    store.select("thread-a", 10004);
    store.select("thread-b", 10003);

    clearAllFdSkillSelections();

    expect(useFdSkillSelectionStore.getState().selectedByThread).toEqual({});
  });
});
