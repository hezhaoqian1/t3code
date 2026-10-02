import type { DesktopBridge } from "@t3tools/contracts";

export const DESKTOP_PASTE_AS_TEXT_EVENT = "fd:paste-as-text";

/**
 * The desktop "粘贴为纯文本" menu item (⌘⇧V on macOS) arms the composer to
 * keep the paste inline, then asks the main process to paste.
 */
export function installDesktopPasteAsText(
  bridge: Pick<DesktopBridge, "onMenuAction" | "pasteAsText"> | undefined,
  target: EventTarget,
): (() => void) | undefined {
  return bridge?.onMenuAction((action) => {
    if (action !== "paste-as-text") return;
    target.dispatchEvent(new Event(DESKTOP_PASTE_AS_TEXT_EVENT));
    void bridge.pasteAsText?.();
  });
}
