// The welcome message that names the task area can land a few seconds after
// the shell snapshot on a cold start. Keep the loading screen up that long
// before calling the task area unavailable.
export const TASK_AREA_UNAVAILABLE_GRACE_MS = 15_000;

/** Which screen the start page shows while it opens a new task's draft. */
export function resolveIndexLandingView(input: {
  readonly bootstrapped: boolean;
  readonly taskAreaFound: boolean;
  readonly draftStartFailed: boolean;
  readonly taskAreaGraceElapsed: boolean;
}): "loading" | "draft-start-error" | "task-area-unavailable" {
  if (input.taskAreaFound) {
    return input.draftStartFailed ? "draft-start-error" : "loading";
  }
  return input.bootstrapped && input.taskAreaGraceElapsed ? "task-area-unavailable" : "loading";
}
