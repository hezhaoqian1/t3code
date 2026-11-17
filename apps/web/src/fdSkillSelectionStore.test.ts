import { MAX_FD_SKILLS_PER_TURN } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  FD_SKILL_THREAD_TITLE,
  clearAllFdSkillSelections,
  clearFdSkillSelection,
  hasFdSkillSelection,
  selectedFdSkillVersionIds,
  useFdSkillSelectionStore,
} from "./fdSkillSelectionStore";

describe("fdSkillSelectionStore", () => {
  beforeEach(() => {
    useFdSkillSelectionStore.setState({ selectedByThread: {} });
  });

  it("keeps selection on its conversation and defaults a new conversation to none", () => {
    useFdSkillSelectionStore.getState().toggle("thread-a", 10004);

    expect(selectedFdSkillVersionIds("thread-a")).toEqual([10004]);
    expect(selectedFdSkillVersionIds("thread-b")).toEqual([]);
    expect(hasFdSkillSelection("thread-a")).toBe(true);
    expect(hasFdSkillSelection("thread-b")).toBe(false);
    expect(FD_SKILL_THREAD_TITLE).toBe("FD Skill 对话");
  });

  it("selects several FD Skills for one conversation in ascending order", () => {
    const store = useFdSkillSelectionStore.getState();
    store.toggle("thread-a", 10012);
    store.toggle("thread-a", 10004);

    expect(selectedFdSkillVersionIds("thread-a")).toEqual([10004, 10012]);
  });

  it("removes one FD Skill and keeps the others selected", () => {
    const store = useFdSkillSelectionStore.getState();
    store.toggle("thread-a", 10004);
    store.toggle("thread-a", 10012);
    store.toggle("thread-a", 10004);

    expect(selectedFdSkillVersionIds("thread-a")).toEqual([10012]);

    store.toggle("thread-a", 10012);

    expect(useFdSkillSelectionStore.getState().selectedByThread).toEqual({});
  });

  it("ignores a selection beyond the per-turn limit", () => {
    const store = useFdSkillSelectionStore.getState();
    const versionIds = Array.from({ length: MAX_FD_SKILLS_PER_TURN }, (_, index) => 10001 + index);
    for (const versionId of versionIds) store.toggle("thread-a", versionId);
    store.toggle("thread-a", 20000);

    expect(selectedFdSkillVersionIds("thread-a")).toEqual(versionIds);
  });

  it("replaces a selection with a normalized list", () => {
    useFdSkillSelectionStore.getState().replace("thread-a", [10012, 10004, 10012]);

    expect(selectedFdSkillVersionIds("thread-a")).toEqual([10004, 10012]);
  });

  it("clears a selected FD Skill without changing other conversations", () => {
    const store = useFdSkillSelectionStore.getState();
    store.toggle("thread-a", 10004);
    store.toggle("thread-a", 10012);
    store.toggle("thread-b", 10003);
    clearFdSkillSelection("thread-a");

    expect(selectedFdSkillVersionIds("thread-a")).toEqual([]);
    expect(selectedFdSkillVersionIds("thread-b")).toEqual([10003]);
  });

  it("clears every account-scoped selection at an identity boundary", () => {
    const store = useFdSkillSelectionStore.getState();
    store.toggle("thread-a", 10004);
    store.toggle("thread-b", 10003);

    clearAllFdSkillSelections();

    expect(useFdSkillSelectionStore.getState().selectedByThread).toEqual({});
  });
});
