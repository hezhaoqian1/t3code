import { assert, describe, it } from "@effect/vitest";

import { normalizeModelMetricLabel } from "./Attributes.ts";

describe("Attributes", () => {
  it("groups the FD DeepSeek model under a bounded metric label", () => {
    assert.strictEqual(normalizeModelMetricLabel("deepseek-v4-flash"), "deepseek");
    assert.strictEqual(normalizeModelMetricLabel("private-custom-label"), "other");
  });
});
