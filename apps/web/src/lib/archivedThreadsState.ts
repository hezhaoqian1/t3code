import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback } from "react";

import { orchestrationEnvironment } from "../state/orchestration";
import { appAtomRegistry } from "../rpc/atomRegistry";

function archivedSnapshotAtom(environmentId: EnvironmentId) {
  return orchestrationEnvironment.archivedShellSnapshot({
    environmentId,
    input: {},
  });
}

const EMPTY_ARCHIVED_SNAPSHOT_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("web:archived-thread-snapshot:empty"),
);

export function refreshArchivedThreadsForEnvironment(environmentId: EnvironmentId): void {
  appAtomRegistry.refresh(archivedSnapshotAtom(environmentId));
}

export function useArchivedThreadSnapshot(environmentId: EnvironmentId | null) {
  const result = useAtomValue(
    environmentId === null ? EMPTY_ARCHIVED_SNAPSHOT_ATOM : archivedSnapshotAtom(environmentId),
  );
  const refresh = useCallback(() => {
    if (environmentId !== null) appAtomRegistry.refresh(archivedSnapshotAtom(environmentId));
  }, [environmentId]);
  const failure = result._tag === "Failure" ? Cause.squash(result.cause) : null;

  return {
    snapshot: Option.getOrNull(AsyncResult.value(result)),
    error:
      failure !== null
        ? failure instanceof Error
          ? failure.message
          : "Could not load archived threads."
        : null,
    isLoading: environmentId !== null && result.waiting,
    refresh,
  };
}
