// @effect-diagnostics nodeBuiltinImport:off - Tests exercise root env file precedence directly.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { loadRepoEnv } from "./public-config.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadRepoEnv", () => {
  it("applies process, root local, and root precedence in that order", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(NodePath.join(repoRoot, ".env"), "FD_TEST_SETTING=root\n");
    NodeFS.writeFileSync(NodePath.join(repoRoot, ".env.local"), "FD_TEST_SETTING=local\n");

    expect(
      loadRepoEnv({
        baseEnv: {
          FD_TEST_SETTING: "process",
        },
        repoRoot,
      }),
    ).toMatchObject({
      FD_TEST_SETTING: "process",
    });
  });

  it("does not project retired remote configuration aliases", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env"),
      [
        "T3CODE_RELAY_URL=https://relay.example.test",
        "T3CODE_RELAY_CLIENT_OTLP_TRACES_URL=https://traces.example.test",
        "T3CODE_HOSTED_APP_URL=https://hosted.example.test",
      ].join("\n"),
    );

    const env = loadRepoEnv({ baseEnv: {}, repoRoot });
    expect(env.VITE_T3CODE_RELAY_URL).toBeUndefined();
    expect(env.VITE_RELAY_OTLP_TRACES_URL).toBeUndefined();
  });
});

function makeTemporaryDirectory() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-public-config-"));
  temporaryDirectories.push(directory);
  return directory;
}
