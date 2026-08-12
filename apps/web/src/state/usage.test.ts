import { describe, expect, it } from "vite-plus/test";

import { resolveUsageLoadingState } from "./usage";

describe("resolveUsageLoadingState", () => {
  it("keeps an existing summary visible while a refresh is waiting", () => {
    expect(resolveUsageLoadingState({ waiting: true, hasValue: true })).toEqual({
      isPending: false,
      isRefreshing: true,
    });
  });

  it("marks the initial request pending when no value exists", () => {
    expect(resolveUsageLoadingState({ waiting: true, hasValue: false })).toEqual({
      isPending: true,
      isRefreshing: false,
    });
  });

  it("is idle after a value settles", () => {
    expect(resolveUsageLoadingState({ waiting: false, hasValue: true })).toEqual({
      isPending: false,
      isRefreshing: false,
    });
  });
});
