import { assert, it } from "@effect/vitest";

import { CatalogDependencyResolutionError, resolveCatalogDependencies } from "./resolve-catalog.ts";

it("reports unresolved catalog dependencies with lookup context", () => {
  try {
    resolveCatalogDependencies({ effect: "catalog:runtime" }, {}, "apps/server");
    assert.fail("Expected catalog resolution to fail.");
  } catch (error) {
    assert.instanceOf(error, CatalogDependencyResolutionError);
    assert.equal(error.workspacePackage, "apps/server");
    assert.equal(error.dependencyName, "effect");
    assert.equal(error.catalogSpec, "catalog:runtime");
    assert.equal(error.catalogKey, "runtime");
    assert.equal(
      error.message,
      "Unable to resolve 'catalog:runtime' for apps/server dependency 'effect'. Expected key 'runtime' in root workspace catalog.",
    );
  }
});

it("resolves version-qualified overrides without changing their selectors", () => {
  assert.deepStrictEqual(
    resolveCatalogDependencies(
      {
        "undici@^8": "catalog:",
        "ws@^8": "catalog:",
        "@clerk/backend@^3": "catalog:",
        "@scope/parent@^1>undici@^8": "catalog:",
        "parent@^1>@clerk/backend@^3": "catalog:",
        effect: "catalog:",
      },
      { undici: "8.11.2", ws: "8.21.0", "@clerk/backend": "3.18.1", effect: "4.0.0" },
      "apps/desktop",
    ),
    {
      "undici@^8": "8.11.2",
      "ws@^8": "8.21.0",
      "@clerk/backend@^3": "3.18.1",
      "@scope/parent@^1>undici@^8": "8.11.2",
      "parent@^1>@clerk/backend@^3": "3.18.1",
      effect: "4.0.0",
    },
  );
});
