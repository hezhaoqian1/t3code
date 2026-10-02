import { useAtomValue } from "@effect/atom-react";

import { undoLatestThreadAction, useThreadUndoNotice } from "../../hooks/showThreadUndoNotice";
import { shortcutLabelForCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Alert, AlertDescription } from "../ui/alert";
import { InlineButton } from "../ui/button";

/** Confirms the latest settle, snooze, unpin or archive and offers to undo it. */
export function SidebarThreadUndoNotice() {
  const notice = useThreadUndoNotice((state) => state.notice);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  if (!notice) return null;
  const shortcut = shortcutLabelForCommand(keybindings, "thread.undo");

  return (
    <Alert role="status" variant="sidebar" data-testid="sidebar-thread-undo-notice">
      <AlertDescription>
        {notice.action} {notice.count} 个任务，
        <InlineButton onClick={undoLatestThreadAction}>
          {shortcut ? `撤销（${shortcut}）` : "撤销"}
        </InlineButton>
      </AlertDescription>
    </Alert>
  );
}
