import type { FdAccountState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getFdAccountDisplayName } from "./SidebarChrome";

describe("FD account menu display name", () => {
  it("prefers the employee display name", () => {
    const state: FdAccountState = {
      status: "authenticated",
      policyVersion: 1,
      profile: { id: 7, username: "employee", displayName: "方德员工" },
      capabilities: { generalAssistant: true },
      expiresAt: 2_000_000_000,
    };

    expect(getFdAccountDisplayName(state)).toBe("方德员工");
  });

  it("falls back to the username and handles non-authenticated states", () => {
    expect(
      getFdAccountDisplayName({
        status: "authenticated",
        policyVersion: 1,
        profile: { id: 7, username: "employee", displayName: "  " },
        capabilities: { generalAssistant: true },
        expiresAt: 2_000_000_000,
      }),
    ).toBe("employee");
    expect(getFdAccountDisplayName({ status: "anonymous" })).toBe("未登录");
  });
});
