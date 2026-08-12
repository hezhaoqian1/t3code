import * as Schema from "effect/Schema";

import { PrimaryConnectionTarget } from "./model.ts";

export interface ConnectionCatalogEntry {
  readonly target: PrimaryConnectionTarget;
}

export class PrimaryConnectionRegistration extends Schema.TaggedClass<PrimaryConnectionRegistration>()(
  "PrimaryConnectionRegistration",
  { target: PrimaryConnectionTarget },
) {}

export function connectionRegistrationCatalogEntry(
  registration: PrimaryConnectionRegistration,
): ConnectionCatalogEntry {
  return { target: registration.target };
}
