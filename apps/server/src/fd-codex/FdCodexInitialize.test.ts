import { describe, expect, it } from "vite-plus/test";

import { buildFdCodexInitializeParams } from "./FdCodexInitialize.ts";

describe("buildFdCodexInitializeParams", () => {
  it("negotiates the experimental API required by collaboration mode", () => {
    expect(buildFdCodexInitializeParams().capabilities?.experimentalApi).toBe(true);
  });
});
