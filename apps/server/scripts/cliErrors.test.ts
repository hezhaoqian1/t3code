import { assert, describe, it } from "@effect/vitest";

import { ServerCliCommandExitError } from "./cliErrors.ts";

describe("server CLI errors", () => {
  it("preserves failed command context without changing its message", () => {
    const error = new ServerCliCommandExitError({
      command: "vp",
      args: ["--run", "build:bundle"],
      cwd: "/repo",
      exitCode: 17,
    });

    assert.equal(error._tag, "ServerCliCommandExitError");
    assert.equal(error.command, "vp");
    assert.deepEqual(error.args, ["--run", "build:bundle"]);
    assert.equal(error.cwd, "/repo");
    assert.equal(error.exitCode, 17);
    assert.equal(error.message, "Command exited with non-zero exit code (17)");
  });
});
