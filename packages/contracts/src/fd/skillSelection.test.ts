import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  AdditionalFdSkillVersionIds,
  MAX_FD_SKILLS_PER_TURN,
  fdSkillSelectionFields,
  fdSkillVersionIdsOf,
  normalizeFdSkillVersionIds,
} from "./skillSelection.ts";

describe("FD Skill selection", () => {
  it("reads a turn's whole selection ascending and without duplicates", () => {
    expect(fdSkillVersionIdsOf({})).toEqual([]);
    expect(fdSkillVersionIdsOf({ fdSkillVersionId: 10004 })).toEqual([10004]);
    expect(
      fdSkillVersionIdsOf({
        fdSkillVersionId: 10012,
        additionalFdSkillVersionIds: [10004, 10012, 10020],
      }),
    ).toEqual([10004, 10012, 10020]);
  });

  it("treats additional versions without a first one as no selection", () => {
    expect(fdSkillVersionIdsOf({ additionalFdSkillVersionIds: [10004] })).toEqual([]);
  });

  it("splits a selection into the turn fields", () => {
    expect(fdSkillSelectionFields([])).toEqual({});
    expect(fdSkillSelectionFields([10004])).toEqual({ fdSkillVersionId: 10004 });
    expect(fdSkillSelectionFields([10020, 10004, 10012, 10004])).toEqual({
      fdSkillVersionId: 10004,
      additionalFdSkillVersionIds: [10012, 10020],
    });
  });

  it("round-trips a selection through the turn fields", () => {
    const versionIds = [10004, 10012, 10020];
    expect(fdSkillVersionIdsOf(fdSkillSelectionFields(versionIds))).toEqual(versionIds);
  });

  it("drops values that are not positive version ids", () => {
    expect(normalizeFdSkillVersionIds([3, 0, -1, 1.5, Number.NaN, 2, 3])).toEqual([2, 3]);
  });

  it("bounds the additional versions to the per-turn limit", () => {
    const decode = Schema.decodeUnknownSync(AdditionalFdSkillVersionIds);
    const atLimit = Array.from({ length: MAX_FD_SKILLS_PER_TURN - 1 }, (_, index) => index + 1);

    expect(decode(atLimit)).toEqual(atLimit);
    expect(() => decode([...atLimit, 99])).toThrow();
    expect(() => decode([0])).toThrow();
  });
});
