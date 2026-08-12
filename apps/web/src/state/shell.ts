import {
  AVAILABLE_CONNECTION_STATE,
  connectionProjectionPhase,
} from "@t3tools/client-runtime/connection";
import {
  createEnvironmentShellAtoms,
  createEnvironmentShellSummaryAtom,
  createEnvironmentSnapshotAtom,
  createShellEnvironmentAtoms,
} from "@t3tools/client-runtime/state/shell";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { primaryEnvironmentIdAtom } from "./primaryEnvironment";

export const shellEnvironment = createShellEnvironmentAtoms(connectionAtomRuntime);
export const environmentShell = createEnvironmentShellAtoms(connectionAtomRuntime);
export const environmentSnapshotAtom = createEnvironmentSnapshotAtom(environmentShell.stateAtom);
export const environmentShellSummaryAtom = createEnvironmentShellSummaryAtom({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  shellStateValueAtom: environmentShell.stateValueAtom,
});

export const primaryEnvironmentShellBootstrappedAtom = Atom.make((get) => {
  const environmentId = get(primaryEnvironmentIdAtom);
  if (environmentId === null) return false;
  if (Option.isSome(get(environmentShell.stateValueAtom(environmentId)).snapshot)) {
    return true;
  }
  const connection = Option.getOrElse(
    AsyncResult.value(get(environmentCatalog.stateAtom(environmentId))),
    () => AVAILABLE_CONNECTION_STATE,
  );
  if (connectionProjectionPhase(connection) !== "disconnected") return false;
  return !(connection.phase === "backoff" && connection.desired && connection.attempt <= 2);
}).pipe(Atom.withLabel("web-primary-environment-shell-bootstrapped"));
