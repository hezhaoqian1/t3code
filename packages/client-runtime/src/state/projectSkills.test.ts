import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Layer from "effect/Layer";
import { Atom } from "effect/unstable/reactivity";

import { createProjectEnvironmentAtoms } from "./projectCommands.ts";

describe("createProjectEnvironmentAtoms project skills", () => {
  it("keys scoped skill queries by environment and project cwd", () => {
    const runtime = Atom.runtime(Layer.empty) as unknown as Parameters<
      typeof createProjectEnvironmentAtoms
    >[0];
    const projects = createProjectEnvironmentAtoms(runtime);
    const environmentId = EnvironmentId.make("environment-1");
    const original = {
      environmentId,
      input: { cwd: "/workspace/project-a" },
    };

    expect(projects.listSkills(original)).toBe(
      projects.listSkills({
        environmentId,
        input: { cwd: "/workspace/project-a" },
      }),
    );
    expect(
      projects.listSkills({
        environmentId,
        input: { cwd: "/workspace/project-b" },
      }),
    ).not.toBe(projects.listSkills(original));
    expect(
      projects.listSkills({
        environmentId: EnvironmentId.make("environment-2"),
        input: original.input,
      }),
    ).not.toBe(projects.listSkills(original));
  });
});
