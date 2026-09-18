import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = resolve(root, "apps/harmonyos-desktop");

const read = (relativePath) => readFileSync(resolve(app, relativePath), "utf8");
const requiredFiles = [
  "AppScope/app.json5",
  "AppScope/resources/base/element/string.json",
  "AppScope/resources/base/media/icon.svg",
  "entry/src/main/module.json5",
  "entry/src/main/resources/base/profile/main_pages.json",
  "entry/src/main/ets/config/HarmonyConfig.ets",
  "entry/src/main/ets/data/FdModels.ets",
  "entry/src/main/ets/network/FdRuntimeClient.ets",
  "entry/src/main/ets/state/FdStore.ets",
  "entry/src/main/ets/pages/Index.ets",
];

for (const file of requiredFiles) assert.ok(existsSync(resolve(app, file)), `missing ${file}`);

const index = read("entry/src/main/ets/pages/Index.ets");
const client = read("entry/src/main/ets/network/FdRuntimeClient.ets");
const store = read("entry/src/main/ets/state/FdStore.ets");
const config = read("entry/src/main/ets/config/HarmonyConfig.ets");

assert.match(index, /DocumentViewPicker/);
assert.match(index, /ForEach\(this\.threads/);
assert.match(index, /ForEach\(this\.messages/);
assert.match(index, /buildSkillSheet/);
assert.match(index, /buildQueueSheet/);
assert.match(index, /buildPreviewSheet/);
assert.match(index, /connectThreadStream/);
assert.match(index, /Web\(\{ src: this\.previewUrl/);
assert.doesNotMatch(index, /HARMONY_WEB_URL|USE_PACKAGED_WEB_BUNDLE/);

assert.match(client, /fd-skills\/self/);
assert.match(client, /agent\/turns/);
assert.match(client, /agent\/desktop\/threads/);
assert.match(client, /client: 'fd_desktop'/);
assert.match(client, /parseLegacySse/);
assert.match(client, /attachments_require_mobile_api/);
assert.match(client, /afterSequence=/);
assert.match(client, /Authorization/);
assert.match(store, /activeTurnId/);
assert.match(store, /this\.queuedTurns/);
assert.match(store, /this\.applyEvent\(event\)/);
assert.match(read("entry/src/main/ets/data/FdModels.ets"), /createUuid/);
assert.match(config, /deepseek-flash/);

const moduleJson5 = read("entry/src/main/module.json5");
assert.match(moduleJson5, /ohos\.permission\.INTERNET/);
assert.match(moduleJson5, /deviceTypes/);

console.log(`Harmony native static checks passed (${requiredFiles.length} files).`);
