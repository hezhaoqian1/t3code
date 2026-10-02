import { useState } from "react";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  NOTIFICATION_MODE_LABELS,
  playNotificationSound,
  unlockNotificationAudio,
} from "../../threadNotifications";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

type NotificationMode = keyof typeof NOTIFICATION_MODE_LABELS;

function isNotificationMode(value: unknown): value is NotificationMode {
  return typeof value === "string" && value in NOTIFICATION_MODE_LABELS;
}

/** Asks for notification permission; resolves to a message when it is unavailable. */
async function ensureNotificationPermission(): Promise<string | null> {
  if (typeof Notification === "undefined" || !window.isSecureContext) {
    return "当前环境不支持系统通知，可以改用“仅提示音”。";
  }
  if (Notification.permission === "granted") return null;
  try {
    const permission = await Notification.requestPermission();
    return permission === "granted"
      ? null
      : "系统通知被拦截了。请在系统设置中允许方德 AI 发送通知后再选一次；也可以改用“仅提示音”。";
  } catch {
    return "当前环境不支持系统通知，可以改用“仅提示音”。";
  }
}

/** Notification preferences: how background tasks alert you, in-app toasts, and a test. */
export function NotificationSettingsSection() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const mode = settings.notificationMode;

  const sendTest = async () => {
    setTestMessage(null);
    if (mode === "off") {
      setTestMessage("请先选择一种通知方式。");
      return;
    }
    if (hasNotificationSound(mode)) {
      // A click counts as the user gesture browsers require before audio plays.
      unlockNotificationAudio();
      void playNotificationSound("completion", () => true);
    }
    if (hasDesktopNotifications(mode)) {
      const problem = await ensureNotificationPermission();
      if (problem) {
        setTestMessage(problem);
        return;
      }
      try {
        const notification = new Notification("任务已完成", {
          body: "这是一条测试通知",
          silent: true,
        });
        notification.addEventListener("click", () => notification.close());
      } catch {
        setTestMessage("系统拒绝显示通知，请检查系统的通知设置。");
        return;
      }
    }
    setTestMessage("已发送。没有看到或听到的话，请检查系统通知和音量设置。");
  };

  return (
    <SettingsSection title="通知">
      <SettingsRow
        {...searchableSetting("thread-notifications")}
        description={
          permissionMessage ??
          "应用不在前台时，任务完成、失败或需要你回答、授权，会用系统通知或提示音提醒你，并在任务栏图标上显示数量。"
        }
        resetAction={
          mode !== "notifications" ? (
            <SettingResetButton
              label="thread notifications"
              onClick={() => {
                setPermissionMessage(null);
                updateSettings({ notificationMode: "notifications" });
              }}
            />
          ) : null
        }
        control={
          <Select
            value={mode}
            disabled={requesting}
            onValueChange={async (value) => {
              if (!isNotificationMode(value)) return;
              setPermissionMessage(null);
              setTestMessage(null);
              if (hasNotificationSound(value)) unlockNotificationAudio();
              if (hasDesktopNotifications(value)) {
                setRequesting(true);
                const problem = await ensureNotificationPermission();
                setRequesting(false);
                if (problem) {
                  setPermissionMessage(problem);
                  return;
                }
              }
              updateSettings({ notificationMode: value });
            }}
          >
            <SelectTrigger className="w-full sm:w-44" aria-label="任务通知">
              <SelectValue>{NOTIFICATION_MODE_LABELS[mode]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {Object.entries(NOTIFICATION_MODE_LABELS).map(([value, label]) => (
                <SelectItem key={value} hideIndicator value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        {...searchableSetting("in-app-notifications")}
        description="正在看另一个任务时，用应用内提示告诉你哪个任务完成、失败或需要处理，点一下即可跳转。"
        control={
          <Switch
            checked={settings.inAppNotificationsEnabled}
            onCheckedChange={(checked) =>
              updateSettings({ inAppNotificationsEnabled: Boolean(checked) })
            }
            aria-label="应用内提醒"
          />
        }
      />
      <SettingsRow
        {...searchableSetting("test-notification")}
        description={testMessage ?? "按当前设置发一条测试通知，确认系统通知和提示音是否正常。"}
        control={
          <Button size="xs" variant="outline" onClick={() => void sendTest()}>
            发送测试通知
          </Button>
        }
      />
    </SettingsSection>
  );
}
