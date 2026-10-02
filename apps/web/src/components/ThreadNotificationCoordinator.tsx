import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { getClientSettings, useClientSettings } from "../hooks/useSettings";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { environmentShell } from "../state/shell";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
  setNotificationBadge,
  unlockNotificationAudio,
} from "../threadNotifications";
import { resolveSidebarThreadStatus } from "./Sidebar.logic";
import { toastManager } from "./ui/toast";

/**
 * Tells the employee when a task they are not looking at finishes, fails, or
 * needs an answer or approval: a system notification (and badge) while the
 * window is in the background, an in-app toast while it is focused on another
 * task, and an optional sound. Mounted once at the root.
 */
export function ThreadNotificationCoordinator() {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inAppNotificationsEnabled = useClientSettings(
    (settings) => settings.inAppNotificationsEnabled,
  );
  const pending = useRef(
    new Map<string, { environmentId: EnvironmentId; notification: Notification }>(),
  );
  const onNotification = useCallback((environmentId: EnvironmentId, notification: Notification) => {
    pending.current.get(notification.tag)?.notification.close();
    pending.current.set(notification.tag, { environmentId, notification });
    setNotificationBadge(pending.current.size);
  }, []);

  // Notifications from a previous account or environment must not linger.
  useEffect(() => {
    const count = pending.current.size;
    for (const [tag, entry] of pending.current) {
      if (entry.environmentId === environmentId) continue;
      entry.notification.close();
      pending.current.delete(tag);
    }
    if (count !== pending.current.size) setNotificationBadge(pending.current.size);
  }, [environmentId]);

  useEffect(() => {
    const clear = () => {
      for (const { notification } of pending.current.values()) notification.close();
      pending.current.clear();
      setNotificationBadge(0);
    };
    clear();
    if (!hasDesktopNotifications(mode)) return;
    const unsubscribe = window.desktopBridge?.onNotificationBadgeClear?.(clear);
    window.addEventListener("focus", clear);
    return () => {
      unsubscribe?.();
      window.removeEventListener("focus", clear);
      clear();
    };
  }, [mode]);

  useEffect(() => {
    if (!hasNotificationSound(mode)) return;
    document.addEventListener("pointerdown", unlockNotificationAudio);
    document.addEventListener("keydown", unlockNotificationAudio);
    return () => {
      document.removeEventListener("pointerdown", unlockNotificationAudio);
      document.removeEventListener("keydown", unlockNotificationAudio);
    };
  }, [mode]);

  if (environmentId === null || (mode === "off" && !inAppNotificationsEnabled)) return null;

  return (
    <EnvironmentNotifications
      key={environmentId}
      environmentId={environmentId}
      onNotification={onNotification}
    />
  );
}

type NotificationKind = "completion" | "approval" | "input" | "failed";

const NOTIFICATION_TITLES: Record<NotificationKind, string> = {
  completion: "任务已完成",
  approval: "任务需要你授权",
  input: "任务需要你回答",
  failed: "任务失败",
};

function EnvironmentNotifications({
  environmentId,
  onNotification,
}: {
  environmentId: EnvironmentId;
  onNotification: (environmentId: EnvironmentId, notification: Notification) => void;
}) {
  const shell = useAtomValue(environmentShell.stateValueAtom(environmentId));
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inAppNotificationsEnabled = useClientSettings(
    (settings) => settings.inAppNotificationsEnabled,
  );
  const navigate = useNavigate();
  const activeThreadId = useParams({
    strict: false,
    select: (params) => (params as { threadId?: string }).threadId ?? null,
  });
  const previous = useRef(
    new Map<ThreadId, { attention: string | null; completion: number | null }>(),
  );

  useEffect(() => {
    if (shell.status !== "live" || Option.isNone(shell.snapshot)) {
      previous.current.clear();
      return;
    }
    const openThread = (threadId: ThreadId) =>
      void navigate({ to: "/$threadId", params: { threadId } });
    const next = new Map<ThreadId, { attention: string | null; completion: number | null }>();
    for (const thread of shell.snapshot.value.threads) {
      let status = resolveSidebarThreadStatus(thread);
      if (status === "ready" && thread.latestTurn?.state === "error") status = "failed";
      const prior = previous.current.get(thread.id);
      const attention =
        status === "input" || status === "approval" || status === "failed"
          ? `${thread.latestTurn?.turnId ?? ""}:${status}`
          : null;
      const completedAt = Date.parse(thread.latestTurn?.completedAt ?? "");
      const completion =
        status === "ready" &&
        thread.latestTurn?.state === "completed" &&
        Number.isFinite(completedAt)
          ? completedAt
          : (prior?.completion ?? null);
      next.set(thread.id, { attention, completion });
      // The first snapshot only seeds the baseline: nothing that happened
      // before the app opened is announced.
      if (!prior || thread.archivedAt !== null) continue;
      const kind: NotificationKind | null =
        attention && attention !== prior.attention
          ? status === "approval"
            ? "approval"
            : status === "failed"
              ? "failed"
              : "input"
          : completion !== null && (prior.completion === null || completion > prior.completion)
            ? "completion"
            : null;
      if (!kind) continue;
      const title = NOTIFICATION_TITLES[kind];
      if (hasNotificationSound(mode)) {
        void playNotificationSound(kind === "completion" ? "completion" : "input", () =>
          hasNotificationSound(getClientSettings().notificationMode),
        );
      }
      const windowFocused = document.visibilityState === "visible" && document.hasFocus();
      if (windowFocused) {
        // The open task already shows its own state.
        if (!inAppNotificationsEnabled || activeThreadId === thread.id) continue;
        const toastId = toastManager.add({
          type: kind === "completion" ? "success" : kind === "failed" ? "error" : "warning",
          title,
          description: thread.title,
          data: {
            hideCopyButton: true,
            leadingIcon:
              kind === "completion" ? (
                <CircleCheckIcon aria-hidden className="size-4 text-success-foreground" />
              ) : kind === "approval" ? (
                <ShieldQuestionIcon aria-hidden className="size-4 text-warning-foreground" />
              ) : kind === "failed" ? (
                <CircleAlertIcon aria-hidden className="size-4 text-destructive-foreground" />
              ) : (
                <MessageCircleQuestionIcon aria-hidden className="size-4 text-info-foreground" />
              ),
          },
          actionProps: {
            children: "打开任务",
            onClick: () => {
              toastManager.close(toastId);
              openThread(thread.id);
            },
          },
        });
        continue;
      }
      if (
        !hasDesktopNotifications(mode) ||
        typeof Notification === "undefined" ||
        Notification.permission !== "granted"
      )
        continue;
      try {
        const notification = new Notification(title, {
          body: thread.title,
          tag: `${environmentId}:${thread.id}`,
          silent: true,
        });
        onNotification(environmentId, notification);
        notification.addEventListener("click", () => {
          notification.close();
          window.focus();
          openThread(thread.id);
        });
      } catch {
        // Some platforms expose Notification but reject desktop presentation.
      }
    }
    previous.current = next;
  }, [
    activeThreadId,
    environmentId,
    inAppNotificationsEnabled,
    mode,
    navigate,
    onNotification,
    shell,
  ]);

  return null;
}
