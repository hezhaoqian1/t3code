import { describe, expect, it } from "vite-plus/test";

import { resolveRenameCommit, shouldShowOpenInPicker } from "./ChatHeader";

describe("shouldShowOpenInPicker", () => {
  it("shows the picker for an active project", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
      }),
    ).toBe(true);
  });

  it("hides the picker when there is no active project", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: undefined,
      }),
    ).toBe(false);
  });
});

describe("resolveRenameCommit", () => {
  it("commits a trimmed changed title", () => {
    expect(resolveRenameCommit({ title: "  New title ", originalTitle: "Old" })).toEqual({
      action: "commit",
      title: "New title",
    });
  });

  it("rejects empty and whitespace-only titles", () => {
    expect(resolveRenameCommit({ title: "   ", originalTitle: "Old" })).toEqual({
      action: "reject-empty",
    });
  });

  it("no-ops when the trimmed title is unchanged", () => {
    expect(resolveRenameCommit({ title: " Old ", originalTitle: "Old" })).toEqual({
      action: "noop",
    });
  });
});
