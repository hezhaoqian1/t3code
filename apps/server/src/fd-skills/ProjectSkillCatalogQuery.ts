import {
  ProjectListSkillsError,
  type ProjectListSkillsResult,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { NativeSkillCatalog } from "./NativeSkillCatalog.ts";

function toProviderSkill(skill: {
  readonly name: string;
  readonly description: string;
  readonly skillPath: string;
  readonly scope: string;
  readonly source: string;
}): ServerProviderSkill {
  return {
    name: skill.name,
    description: skill.description,
    path: skill.skillPath,
    scope: `${skill.scope}:${skill.source}`,
    enabled: true,
    displayName: skill.name,
    shortDescription: skill.description,
  };
}

export const listProjectSkills = Effect.fn("ProjectSkillCatalogQuery.listProjectSkills")(function* (
  cwd: string,
) {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const project = yield* projectionSnapshotQuery.getActiveProjectByWorkspaceRoot(cwd).pipe(
    Effect.mapError(
      (cause) =>
        new ProjectListSkillsError({
          cwd,
          failure: "project_lookup_failed",
          cause,
        }),
    ),
  );
  if (Option.isNone(project)) {
    return yield* new ProjectListSkillsError({
      cwd,
      failure: "project_not_found",
    });
  }

  const snapshot = yield* Effect.tryPromise(() =>
    new NativeSkillCatalog({ projectRoot: cwd }).refresh(),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new ProjectListSkillsError({
          cwd,
          failure: "catalog_refresh_failed",
          cause,
        }),
    ),
  );
  return {
    skills: snapshot.skills.map(toProviderSkill),
  } satisfies ProjectListSkillsResult;
});
