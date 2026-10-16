import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const root = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const app = NodePath.resolve(root, "apps/harmonyos-desktop");
const read = (relativePath) => NodeFS.readFileSync(NodePath.resolve(app, relativePath), "utf8");
const requiredFiles = [
  "AppScope/app.json5",
  "AppScope/resources/base/element/string.json",
  "AppScope/resources/base/media/icon.svg",
  "entry/src/main/module.json5",
  "entry/src/main/resources/base/profile/main_pages.json",
  "entry/src/main/ets/entryability/EntryAbility.ets",
  "entry/src/main/ets/config/HarmonyConfig.ets",
  "entry/src/main/ets/data/FdModels.ets",
  "entry/src/main/ets/network/FdRuntimeClient.ets",
  "entry/src/main/ets/network/AttachmentTransfer.ets",
  "entry/src/main/ets/state/FdStore.ets",
  "entry/src/main/ets/pages/Index.ets",
  "build-profile.json5",
  "hvigorfile.ts",
  "hvigor-config.json5",
  "oh-package.json5",
];

for (const file of requiredFiles)
  NodeAssert.ok(NodeFS.existsSync(NodePath.resolve(app, file)), `missing ${file}`);

const index = read("entry/src/main/ets/pages/Index.ets");
const client = read("entry/src/main/ets/network/FdRuntimeClient.ets");
const transfer = read("entry/src/main/ets/network/AttachmentTransfer.ets");
const store = read("entry/src/main/ets/state/FdStore.ets");
const config = read("entry/src/main/ets/config/HarmonyConfig.ets");
const moduleJson5 = read("entry/src/main/module.json5");

NodeAssert.match(index, /@Entry/);
NodeAssert.match(index, /DocumentViewPicker/);
NodeAssert.match(index, /ForEach\(this\.threads/);
NodeAssert.match(index, /ForEach\(this\.messages/);
NodeAssert.match(index, /buildSkillSheet/);
NodeAssert.match(index, /buildQueueSheet/);
NodeAssert.match(index, /buildPreviewSheet/);
NodeAssert.match(index, /connectThreadStream/);
NodeAssert.match(index, /Web\(\{ src: this\.previewUrl/);
NodeAssert.doesNotMatch(
  index,
  /HARMONY_WEB_URL|USE_PACKAGED_WEB_BUNDLE|this\.webUrl|onShowFileSelector/,
);

NodeAssert.match(client, /fd-skills\/self/);
NodeAssert.match(client, /agent\/turns/);
NodeAssert.match(client, /agent\/desktop\/threads/);
NodeAssert.match(client, /client: 'fd_desktop'/);
NodeAssert.match(client, /parseLegacySse/);
NodeAssert.match(client, /requestInStream/);
NodeAssert.match(client, /dataReceive/);
NodeAssert.match(client, /dataEnd/);
NodeAssert.match(client, /attachments_require_mobile_api/);
NodeAssert.match(client, /uploadAttachmentPart/);
NodeAssert.match(client, /completeAttachmentUpload/);
NodeAssert.match(client, /threadId,/);
NodeAssert.match(client, /supportedModels/);
NodeAssert.match(client, /getThreadHistory/);
NodeAssert.match(client, /historyCursor/);
NodeAssert.match(client, /identifierValue/);
NodeAssert.match(client, /afterSequence=/);
NodeAssert.match(client, /Authorization/);
NodeAssert.match(transfer, /fileIo\.openSync/);
NodeAssert.match(transfer, /fileIo\.readSync/);
NodeAssert.match(transfer, /cryptoFramework\.createMd\('SHA256'\)/);
NodeAssert.match(transfer, /wholeDigest\.digest/);
NodeAssert.match(transfer, /uploadPickedAttachment/);
NodeAssert.match(store, /activeTurnId/);
NodeAssert.match(store, /this\.queuedTurns/);
NodeAssert.match(store, /editQueued/);
NodeAssert.match(store, /this\.models/);
NodeAssert.match(store, /this\.applyEvent\(event\)/);
NodeAssert.match(store, /loadOlderHistory/);
NodeAssert.match(read("entry/src/main/ets/data/FdModels.ets"), /createUuid/);
NodeAssert.match(read("entry/src/main/ets/data/FdModels.ets"), /FdAttachmentPatch/);
NodeAssert.match(config, /deepseek-flash/);
NodeAssert.match(moduleJson5, /ohos\.permission\.INTERNET/);
NodeAssert.match(moduleJson5, /deviceTypes/);

console.log(`Harmony native static checks passed (${requiredFiles.length} files).`);
