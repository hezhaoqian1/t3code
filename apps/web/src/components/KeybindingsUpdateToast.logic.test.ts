import type { ServerConfigStreamEvent } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  createKeybindingsUpdateToastController,
  KEYBINDINGS_TOAST_COOLDOWN_MS,
} from "./KeybindingsUpdateToast.logic";

function keybindingsEvent(
  overrides: Partial<Extract<ServerConfigStreamEvent, { type: "keybindingsUpdated" }>> = {},
): Extract<ServerConfigStreamEvent, { type: "keybindingsUpdated" }> {
  return {
    version: 1,
    type: "keybindingsUpdated",
    payload: {
      keybindings: [],
      issues: [],
    },
    ...overrides,
  };
}

describe("keybindings update toast policy", () => {
  it("coalesces repeated successful reload notifications during the cooldown", () => {
    let now = 1_000;
    const controller = createKeybindingsUpdateToastController({
      now: () => now,
    });

    expect(controller.handle(keybindingsEvent())).toEqual({ _tag: "Success" });

    now += KEYBINDINGS_TOAST_COOLDOWN_MS - 1;
    expect(controller.handle(keybindingsEvent())).toBeNull();

    now += 1;
    expect(controller.handle(keybindingsEvent())).toEqual({ _tag: "Success" });
  });

  it("surfaces keybinding configuration issues", () => {
    const controller = createKeybindingsUpdateToastController({});

    expect(
      controller.handle(
        keybindingsEvent({
          payload: {
            keybindings: [],
            issues: [
              {
                kind: "keybindings.malformed-config",
                message: "Expected JSON array",
              },
            ],
          },
        }),
      ),
    ).toEqual({
      _tag: "InvalidConfiguration",
      message: "Expected JSON array",
    });
  });

  it("shows one warning when a save and the file watcher report the same issue", () => {
    let currentTime = 0;
    const controller = createKeybindingsUpdateToastController({ now: () => currentTime });
    const withIssues = (messages: ReadonlyArray<string>) =>
      keybindingsEvent({
        payload: {
          keybindings: [],
          issues: messages.map((message, index) => ({
            kind: "keybindings.invalid-entry" as const,
            message,
            index,
          })),
        },
      });
    const invalid = { _tag: "InvalidConfiguration", message: "unknown command" };

    expect(controller.handle(withIssues(["unknown command"]))).toEqual(invalid);
    currentTime = 100;
    expect(controller.handle(withIssues(["unknown command"]))).toBeNull();

    currentTime = 200;
    expect(controller.handle(withIssues(["bad shortcut"]))).toEqual({
      _tag: "InvalidConfiguration",
      message: "bad shortcut",
    });

    currentTime = 5_000;
    expect(controller.handle(withIssues(["bad shortcut"]))).toEqual({
      _tag: "InvalidConfiguration",
      message: "bad shortcut",
    });
    currentTime = 5_100;
    expect(controller.handle(withIssues([]))).toEqual({ _tag: "Success" });
    currentTime = 5_200;
    expect(controller.handle(withIssues([]))).toBeNull();
  });

  it("ignores unrelated server config notifications", () => {
    const controller = createKeybindingsUpdateToastController({});

    expect(
      controller.handle({
        version: 1,
        type: "settingsUpdated",
        payload: { settings: {} as never },
      }),
    ).toBeNull();
  });
});
