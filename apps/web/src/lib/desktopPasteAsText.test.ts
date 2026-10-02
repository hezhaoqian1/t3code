import { describe, expect, it, vi } from "vite-plus/test";

import { DESKTOP_PASTE_AS_TEXT_EVENT, installDesktopPasteAsText } from "./desktopPasteAsText";

describe("installDesktopPasteAsText", () => {
  it("arms the composer before asking the desktop app to paste", () => {
    let listener: ((action: string) => void) | undefined;
    const order: string[] = [];
    const target = new EventTarget();
    target.addEventListener(DESKTOP_PASTE_AS_TEXT_EVENT, () => order.push("armed"));
    const unsubscribe = vi.fn();
    const bridge = {
      onMenuAction: (next: (action: string) => void) => {
        listener = next;
        return unsubscribe;
      },
      pasteAsText: vi.fn(async () => {
        order.push("pasted");
      }),
    };

    const dispose = installDesktopPasteAsText(bridge, target);
    listener?.("open-settings");
    expect(order).toEqual([]);
    listener?.("paste-as-text");
    expect(order).toEqual(["armed", "pasted"]);

    dispose?.();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("does nothing outside the desktop app", () => {
    expect(installDesktopPasteAsText(undefined, new EventTarget())).toBeUndefined();
  });
});
