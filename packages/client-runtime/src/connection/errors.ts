import type { EnvironmentId } from "@t3tools/contracts";

import { ConnectionBlockedError } from "./model.ts";

export function environmentMismatchError(input: {
  readonly expected: EnvironmentId;
  readonly actual: EnvironmentId;
}): ConnectionBlockedError {
  return new ConnectionBlockedError({
    reason: "configuration",
    detail: `Connected environment ${input.actual} does not match ${input.expected}.`,
  });
}
