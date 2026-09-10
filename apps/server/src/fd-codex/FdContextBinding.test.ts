import { describe, expect, it } from "vite-plus/test";
import { encodeFdContextBinding, restoreFdContextBinding } from "./FdContextBinding.ts";

describe("FD context binding", () => {
  it("restores local and enterprise threads independently after serialization", () => {
    const cursor = encodeFdContextBinding(
      "enterprise:17",
      new Map([
        ["local", { threadId: "ordinary" }],
        ["enterprise:17", { threadId: "skill-17" }],
        ["enterprise:22", { threadId: "skill-22" }],
      ]),
    );
    const restored = restoreFdContextBinding(JSON.parse(JSON.stringify(cursor)));
    expect(restored.activeProfile).toBe("enterprise:17");
    expect(restored.profiles.get("local")).toEqual({ threadId: "ordinary" });
    expect(restored.profiles.get("enterprise:17")).toEqual({ threadId: "skill-17" });
    expect(restored.profiles.get("enterprise:22")).toEqual({ threadId: "skill-22" });
  });
  it("does not assign legacy local context to an enterprise Skill", () => {
    const restored = restoreFdContextBinding({ threadId: "legacy" });
    expect(restored.profiles.get("local")).toEqual({ threadId: "legacy" });
    expect(restored.profiles.has("enterprise:17")).toBe(false);
  });
  it("does not accept an FD placeholder as a provider thread", () => {
    expect(
      restoreFdContextBinding({ schemaVersion: 1, sessionId: "fd-thread" }).profiles.size,
    ).toBe(0);
  });
  it("starts fresh for unknown bindings without assigning Skill history to local context", () => {
    expect(
      restoreFdContextBinding({ threadId: "skill", fdContext: { version: 2 } }).profiles.size,
    ).toBe(0);
  });
  it("starts fresh for damaged provider ids and inconsistent active bindings", () => {
    for (const cursor of [
      { threadId: 123 },
      { threadId: " " },
      { fdContext: { version: 1 } },
      {
        threadId: "wrong",
        fdContext: {
          version: 1,
          activeProfile: "local",
          profiles: { local: { threadId: "actual" } },
        },
      },
    ])
      expect(restoreFdContextBinding(cursor).profiles.size).toBe(0);
  });
});
