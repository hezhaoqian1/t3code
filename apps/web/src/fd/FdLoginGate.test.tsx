import type { FdAccountState } from "@t3tools/contracts";
import type { FdAccountBridge } from "./accountController";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { createFdAccountController } from "./accountController";
import { FdAccountProvider } from "./FdAccountProvider";
import { FdLoginGate } from "./FdLoginGate";

describe("FD login gate state", () => {
  it("keeps application content unavailable until authentication", () => {
    const markup = renderToStaticMarkup(
      <FdAccountProvider>
        <FdLoginGate>
          <div data-app-shell="mounted" />
        </FdLoginGate>
      </FdAccountProvider>,
    );

    expect(markup).toContain("正在检查账号");
    expect(markup).not.toContain("data-app-shell");
  });

  it("unsubscribes account events when the controller stops", () => {
    const unsubscribe = vi.fn();
    const bridge: FdAccountBridge = {
      getFdAccountState: vi.fn(async (): Promise<FdAccountState> => ({ status: "anonymous" })),
      loginFdAccount: vi.fn(),
      logoutFdAccount: vi.fn(),
      reloadFdAccount: vi.fn(),
      retryFdAccountRevocation: vi.fn(),
      onFdAccountState: vi.fn(() => unsubscribe),
    };
    const stop = createFdAccountController(bridge, () => undefined).start();
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
