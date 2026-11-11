import { DEFAULT_MODEL } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { NEW_TASK_MODEL_SELECTION } from "./newTaskModel";

describe("new task model", () => {
  it("starts every new task on FD's default model, Flash", () => {
    expect(NEW_TASK_MODEL_SELECTION).toEqual({
      instanceId: "fd-deepseek",
      model: "deepseek-flash",
    });
    expect(NEW_TASK_MODEL_SELECTION.model).toBe(DEFAULT_MODEL);
  });
});
