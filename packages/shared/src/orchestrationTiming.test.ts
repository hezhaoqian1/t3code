import { describe, expect, it } from "vite-plus/test";

import { formatDuration } from "./orchestrationTiming.ts";

describe("formatDuration", () => {
  it.each([
    [999, "999ms"],
    [9_940, "9.9s"],
    [59_400, "59s"],
    [59_500, "1m"],
    [60_000, "1m"],
    [119_500, "2m"],
    [125_000, "2m 5s"],
  ])("formats %i ms as %s", (durationMs, expected) => {
    expect(formatDuration(durationMs)).toBe(expected);
  });
});
