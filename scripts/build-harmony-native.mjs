import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = resolve(repoRoot, "apps", "harmonyos-desktop");
const requestedArgs = process.argv.slice(2);
const args =
  requestedArgs.length > 0
    ? requestedArgs
    : ["assembleHap", "--mode", "module", "-p", "product=default"];

const wrapperNames =
  process.platform === "win32" ? ["hvigorw.bat", "hvigorw.cmd", "hvigorw"] : ["hvigorw"];
const localWrapper = wrapperNames
  .map((name) => resolve(appRoot, name))
  .find((path) => existsSync(path));

const command = localWrapper ?? findOnPath(wrapperNames[0]);
if (command === undefined) {
  console.error(
    "Harmony build unavailable: install DevEco Studio with a compatible HarmonyOS SDK, " +
      "then run this command from the generated project wrapper (hvigorw).",
  );
  process.exit(2);
}

const result = spawnSync(command, args, {
  cwd: appRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error !== undefined) {
  console.error(`Harmony build launcher failed: ${result.error.message}`);
  process.exit(2);
}
process.exit(result.status ?? 1);

function findOnPath(name) {
  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [name], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return undefined;
  const first = result.stdout.trim().split(/\r?\n/)[0];
  return first.length > 0 ? first : undefined;
}
