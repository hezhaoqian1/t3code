import type { FdAccountState } from "@t3tools/contracts";
import type { FdAccountBridge } from "./accountController";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { createFdAccountController } from "./accountController";
import {
  FdAccountContext,
  FdAccountProvider,
  type FdAccountContextValue,
} from "./FdAccountProvider";
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
    // The same loading screen as the startup stages, draggable by its top edge.
    expect(markup).toContain("方小德正在来的路上");
    expect(markup).toContain('data-window-drag-strip="true"');
    expect(markup).not.toContain("data-app-shell");
  });

  it("lets the login screen drag the frameless window and shows the transparent mark", () => {
    const account: FdAccountContextValue = {
      state: { status: "anonymous" },
      busy: null,
      error: null,
      login: vi.fn(async () => true),
      logout: vi.fn(async () => undefined),
      retryRevocation: vi.fn(async () => undefined),
      reload: vi.fn(async () => undefined),
      clearError: vi.fn(),
    };
    const markup = renderToStaticMarkup(
      <FdAccountContext value={account}>
        <FdLoginGate>
          <div data-app-shell="mounted" />
        </FdLoginGate>
      </FdAccountContext>,
    );
    expect(markup).toContain("员工账号");
    expect(markup).toContain('data-window-drag-strip="true"');
    expect(markup).toContain("fd-boot-purple");
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
