import { describe, expect, it } from "@effect/vitest";

import { isPathInside } from "./presentation.ts";

describe("presentation IPC path boundary", () => {
  it("allows only a task project or its descendants", () => {
    expect(
      isPathInside("/Users/employee/FangdeAI/Tasks", "/Users/employee/FangdeAI/Tasks/deck"),
    ).toBe(true);
    expect(isPathInside("/Users/employee/FangdeAI/Tasks", "/Users/employee/FangdeAI/Tasks")).toBe(
      true,
    );
    expect(
      isPathInside("/Users/employee/FangdeAI/Tasks", "/Users/employee/FangdeAI/Tasks-other/deck"),
    ).toBe(false);
    expect(isPathInside("/Users/employee/FangdeAI/Tasks", "/Users/employee/.ssh")).toBe(false);
  });
});
