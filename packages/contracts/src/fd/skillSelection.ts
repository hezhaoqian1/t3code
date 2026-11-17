import * as Schema from "effect/Schema";

import { PositiveInt } from "../baseSchemas.ts";

/** How many FD Skills one turn can run with. */
export const MAX_FD_SKILLS_PER_TURN = 4;

/**
 * FD Skill versions selected alongside `fdSkillVersionId` for the same turn.
 * Read a turn's whole selection with `fdSkillVersionIdsOf`.
 */
export const AdditionalFdSkillVersionIds = Schema.Array(PositiveInt).check(
  Schema.isMaxLength(MAX_FD_SKILLS_PER_TURN - 1),
);

export interface FdSkillSelectionFields {
  readonly fdSkillVersionId?: number | undefined;
  readonly additionalFdSkillVersionIds?: ReadonlyArray<number> | undefined;
}

/**
 * Every FD Skill version a turn runs with, ascending and without duplicates.
 * Empty for an ordinary turn. Turns recorded before several Skills could be
 * selected carry only `fdSkillVersionId` and yield that one version.
 */
export function fdSkillVersionIdsOf(input: FdSkillSelectionFields): ReadonlyArray<number> {
  if (input.fdSkillVersionId === undefined) return [];
  return normalizeFdSkillVersionIds([
    input.fdSkillVersionId,
    ...(input.additionalFdSkillVersionIds ?? []),
  ]);
}

/** The fields that carry a selection on a turn; nothing for an empty selection. */
export function fdSkillSelectionFields(versionIds: ReadonlyArray<number>): {
  readonly fdSkillVersionId?: number;
  readonly additionalFdSkillVersionIds?: ReadonlyArray<number>;
} {
  const [first, ...rest] = normalizeFdSkillVersionIds(versionIds);
  if (first === undefined) return {};
  return rest.length === 0
    ? { fdSkillVersionId: first }
    : { fdSkillVersionId: first, additionalFdSkillVersionIds: rest };
}

/** Ascending positive version ids without duplicates. */
export function normalizeFdSkillVersionIds(
  versionIds: ReadonlyArray<number>,
): ReadonlyArray<number> {
  return [...new Set(versionIds.filter((id) => Number.isSafeInteger(id) && id > 0))].toSorted(
    (left, right) => left - right,
  );
}
