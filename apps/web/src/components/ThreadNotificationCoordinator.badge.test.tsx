import * as Option from "effect/Option";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  mode: "notifications",
  inApp: false,
  toast: vi.fn(),
  environmentId: "local" as string | null,
  shell: null as unknown,
  navigate: vi.fn(),
  sound: vi.fn(),
  badge: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) =>
    atom === "primary-environment-id" ? state.environmentId : state.shell,
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => state.navigate,
  useParams: (options: { select?: (params: object) => unknown }) =>
    options.select ? options.select({}) : {},
}));
vi.mock("./ui/toast", () => ({ toastManager: { add: state.toast } }));
vi.mock("../state/shell", () => ({ environmentShell: { stateValueAtom: (id: string) => id } }));
vi.mock("../state/primaryEnvironment", () => ({
  primaryEnvironmentIdAtom: "primary-environment-id",
}));
vi.mock("../hooks/useSettings", () => ({
  useClientSettings: (
    select: (settings: { notificationMode: string; inAppNotificationsEnabled: boolean }) => unknown,
  ) => select({ notificationMode: state.mode, inAppNotificationsEnabled: state.inApp }),
  getClientSettings: () => ({ notificationMode: state.mode }),
}));
vi.mock("../threadNotifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../threadNotifications")>()),
  playNotificationSound: state.sound,
  unlockNotificationAudio: vi.fn(),
  setNotificationBadge: state.badge,
}));

import { ThreadNotificationCoordinator } from "./ThreadNotificationCoordinator";

class TestNotification extends EventTarget {
  static permission = "granted";
  static sent: TestNotification[] = [];
  close = vi.fn();
  get tag() {
    return this.options.tag ?? "";
  }
  constructor(
    readonly title: string,
    readonly options: NotificationOptions,
  ) {
    super();
    TestNotification.sent.push(this);
  }
}

type TestThread = {
  id: string;
  title: string;
  archivedAt: string | null;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
  session: null;
  latestTurn: { turnId: string; state: string; completedAt: string | null };
};

const baseThread = (id: string): TestThread => ({
  id,
  title: `任务 ${id}`,
  archivedAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  session: null,
  latestTurn: { turnId: `turn-${id}`, state: "running", completedAt: null },
});
let threads: TestThread[] = [];
let renderer: ReactTestRenderer | undefined;
let focused = false;

function publish() {
  state.shell = {
    status: "live",
    snapshot: Option.some({ threads: threads.map((t) => ({ ...t })) }),
  };
}
function update(id: string, patch: Partial<TestThread>) {
  threads = threads.map((thread) => (thread.id === id ? { ...thread, ...patch } : thread));
  publish();
}
function complete(id: string, completedAt = "2026-10-02T08:00:00Z") {
  update(id, { latestTurn: { turnId: `turn-${id}`, state: "completed", completedAt } });
}
async function render() {
  await act(async () => {
    if (renderer) renderer.update(<ThreadNotificationCoordinator />);
    else renderer = create(<ThreadNotificationCoordinator />);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.mode = "notifications";
  state.inApp = false;
  state.environmentId = "local";
  threads = [baseThread("a"), baseThread("b")];
  publish();
  focused = false;
  TestNotification.permission = "granted";
  TestNotification.sent = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Notification", TestNotification);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { focus: vi.fn() }));
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), {
      hasFocus: () => focused,
      get visibilityState() {
        return "visible";
      },
    }),
  );
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it("counts background tasks, replaces a repeat alert for one task, and clears on focus", async () => {
  await render();
  complete("a");
  await render();
  expect(state.badge).toHaveBeenLastCalledWith(1);
  complete("a", "2026-10-02T08:01:00Z");
  complete("b");
  await render();
  expect(state.badge).toHaveBeenLastCalledWith(2);
  expect(TestNotification.sent[0]!.close).toHaveBeenCalledOnce();
  focused = true;
  window.dispatchEvent(new Event("focus"));
  expect(state.badge).toHaveBeenLastCalledWith(0);
  expect(TestNotification.sent.every((n) => n.close.mock.calls.length > 0)).toBe(true);
});

it("does not badge old completions on first load or reconnect", async () => {
  complete("a");
  await render();
  state.shell = { status: "connecting", snapshot: Option.none() };
  await render();
  complete("a", "2026-10-02T08:01:00Z");
  await render();
  expect(TestNotification.sent).toHaveLength(0);
  expect(state.badge.mock.calls.every(([count]) => count === 0)).toBe(true);
});

it("drops alerts when the account's environment goes away", async () => {
  await render();
  complete("a");
  await render();
  expect(state.badge).toHaveBeenLastCalledWith(1);
  const [notification] = TestNotification.sent;
  state.environmentId = null;
  await render();
  expect(state.badge).toHaveBeenLastCalledWith(0);
  expect(notification!.close).toHaveBeenCalled();
});

it("starts a fresh count after the native window regains focus", async () => {
  let clear: (() => void) | undefined;
  const unsubscribe = vi.fn();
  Object.assign(window, {
    desktopBridge: {
      onNotificationBadgeClear: (listener: () => void) => {
        clear = listener;
        return unsubscribe;
      },
    },
  });
  await render();
  complete("a");
  await render();
  clear!();
  expect(state.badge).toHaveBeenLastCalledWith(0);
  complete("b");
  await render();
  expect(state.badge).toHaveBeenLastCalledWith(1);
  await act(async () => renderer!.unmount());
  renderer = undefined;
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(state.badge).toHaveBeenLastCalledWith(0);
});

it.each(["off", "sound", "focused", "denied", "archived"])(
  "does not show system alerts when %s",
  async (condition) => {
    if (condition === "off" || condition === "sound") state.mode = condition;
    if (condition === "focused") focused = true;
    if (condition === "denied") TestNotification.permission = "denied";
    await render();
    complete("a");
    if (condition === "archived") {
      update("a", { archivedAt: "2026-10-02T08:00:00Z", hasPendingApprovals: true });
    }
    await render();
    expect(TestNotification.sent).toHaveLength(0);
    expect(state.badge.mock.calls.every(([count]) => count === 0)).toBe(true);
  },
);

it.each([
  ["hasPendingApprovals", "任务需要你授权"],
  ["hasPendingUserInput", "任务需要你回答"],
] as const)("badges %s, opens the task on click, and clears when disabled", async (flag, title) => {
  await render();
  update("a", { [flag]: true });
  await render();
  expect(state.badge).toHaveBeenLastCalledWith(1);
  const notification = TestNotification.sent[0]!;
  expect(notification.title).toBe(title);
  notification.dispatchEvent(new Event("click"));
  expect(state.navigate).toHaveBeenCalledWith({ to: "/$threadId", params: { threadId: "a" } });
  state.mode = "sound";
  await render();
  expect(state.badge).toHaveBeenLastCalledWith(0);
  expect(notification.close).toHaveBeenCalled();
});

it("shows in-app alerts without adding a badge while focused", async () => {
  state.inApp = true;
  focused = true;
  await render();
  complete("a");
  await render();
  expect(state.toast).toHaveBeenCalledOnce();
  expect(TestNotification.sent).toHaveLength(0);
  expect(state.badge.mock.calls.every(([count]) => count === 0)).toBe(true);
});

it("badges background failures with in-app notifications enabled", async () => {
  state.inApp = true;
  await render();
  update("a", { latestTurn: { turnId: "turn-a", state: "error", completedAt: null } });
  await render();
  expect(TestNotification.sent[0]?.title).toBe("任务失败");
  expect(state.badge).toHaveBeenLastCalledWith(1);
  expect(state.toast).not.toHaveBeenCalled();
});
