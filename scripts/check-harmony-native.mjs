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
  "entry/src/main/ets/entryability/EntryAbility.ets",
  "entry/src/main/ets/runtime/HarmonyContext.ets",
  "entry/src/main/ets/runtime/HarmonySessionStorage.ets",
  "entry/src/main/ets/runtime/HarmonyWorkspaceCache.ets",
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
  "../../scripts/build-harmony-native.mjs",
];

for (const file of requiredFiles) assert.ok(existsSync(resolve(app, file)), `missing ${file}`);

const index = read("entry/src/main/ets/pages/Index.ets");
const client = read("entry/src/main/ets/network/FdRuntimeClient.ets");
const transfer = read("entry/src/main/ets/network/AttachmentTransfer.ets");
const store = read("entry/src/main/ets/state/FdStore.ets");
const config = read("entry/src/main/ets/config/HarmonyConfig.ets");
const moduleJson5 = read("entry/src/main/module.json5");

assert.match(index, /@Entry/);
assert.match(index, /DocumentViewPicker/);
assert.match(index, /ForEach\(this\.threads/);
assert.match(index, /ForEach\(this\.messages/);
assert.match(index, /buildSkillSheet/);
assert.match(index, /buildQueueSheet/);
assert.match(index, /buildPreviewSheet/);
assert.match(index, /connectThreadStream/);
assert.match(index, /supportsReplayStream/);
assert.match(index, /sendQueuedImmediately/);
assert.match(index, /application\/msword/);
assert.match(index, /application\/vnd\.ms-excel/);
assert.match(index, /application\/vnd\.ms-powerpoint/);
assert.match(index, /text\/csv/);
assert.match(index, /text\/markdown/);
assert.match(index, /先刷新后再添加附件/);
assert.match(index, /先刷新后再预览附件/);
assert.match(index, /运行进度/);
assert.match(index, /this.store.clearAttachments()/);
assert.match(index, /activeTurnId.length/);
assert.match(index, /remoteWorkspaceReady/);
assert.match(index, /restoreQueuedTurn/);
assert.match(index, /restoreQueuedTurn\(turn, true\)/);
assert.match(index, /createHarmonyWorkspaceCache/);
assert.match(index, /cachedWorkspaceLoaded/);
assert.match(index, /Web\(\{ src: this\.previewUrl/);
assert.doesNotMatch(index, /HARMONY_WEB_URL|USE_PACKAGED_WEB_BUNDLE/);

assert.match(client, /fd-skills\/self/);
assert.match(client, /agent\/turns/);
assert.match(client, /agent\/desktop\/threads/);
assert.match(client, /client: 'fd_desktop'/);
assert.match(client, /parseLegacySse/);
assert.match(client, /requestInStream/);
assert.match(client, /dataReceive/);
assert.match(client, /dataEnd/);
assert.match(client, /attachments_require_mobile_api/);
assert.match(client, /uploadAttachmentPart/);
assert.match(client, /completeAttachmentUpload/);
assert.match(client, /threadId,/);
assert.match(client, /idempotencyKey: createClientId\('thread'\)/);
assert.match(client, /type: 'attachment.processing'/);
assert.match(client, /type: 'attachment.ready'/);
assert.match(client, /type: 'attachment.failed'/);
assert.match(client, /type: 'thread.message-sent'/);
assert.match(client, /type: 'assistant.reasoning'/);
assert.match(client, /supportedModels/);
assert.match(client, /loadBootstrap/);
assert.match(client, /replayStreamAvailable/);
assert.match(client, /getThreadHistory/);
assert.match(client, /historyCursor/);
assert.match(client, /identifierValue/);
assert.match(client, /parseAttachment/);
assert.match(client, /parseActivity/);
assert.match(client, /item\['attachments'\]/);
assert.match(client, /value\['attachments'\]/);
assert.match(transfer, /fileIo\.openSync/);
assert.match(transfer, /fileIo\.readSync/);
assert.match(transfer, /cryptoFramework\.createMd\('SHA256'\)/);
assert.match(transfer, /wholeDigest\.digest/);
assert.match(transfer, /uploadPickedAttachment/);
assert.match(transfer, /MAX_PART_UPLOAD_ATTEMPTS/);
assert.match(transfer, /isRetryablePartError/);
assert.match(client, /afterSequence=/);
assert.match(client, /Authorization/);
assert.match(store, /activeTurnId/);
assert.match(store, /remoteWorkspaceReady/);
assert.match(store, /messageId/);
assert.match(store, /restoreQueuedTurn/);
assert.match(store, /legacy endpoint returns messages only/);
assert.match(store, /messages: history/);
assert.match(store, /this\.queuedTurns/);
assert.match(store, /editQueued/);
assert.match(store, /private findAttachment/);
assert.match(store, /attachment_unavailable/);
assert.match(store, /FD Runtime 连接中断，请重试/);
assert.match(store, /this\.models/);
assert.match(store, /this\.applyEvent\(event\)/);
assert.match(store, /case 'thread.message-sent'/);
assert.match(store, /case 'assistant.reasoning'/);
assert.match(store, /loadOlderHistory/);
assert.match(store, /this\.skills = \[\];/);
assert.match(store, /this\.threads = \[\];/);
assert.match(store, /restoreSession/);
assert.match(store, /loadCachedWorkspace/);
assert.match(store, /clearWorkspaceCache/);
assert.match(store, /sanitizeWorkspaceSnapshot/);
assert.match(store, /workspacePersistQueue/);
assert.match(store, /selectModel/);
assert.doesNotMatch(client, /unlimited_quota/);
assert.match(client, /findRuntimeToken/);
assert.match(client, /sessionStorage\.save/);
assert.match(client, /sessionStorage\.load/);
assert.match(client, /sessionStorage\.clear/);
assert.match(client, /restoreSession/);
assert.match(client, /isTransientSessionValidationError/);
assert.match(
  read("entry/src/main/ets/runtime/HarmonySessionStorage.ets"),
  /preferences\.getPreferences/,
);
assert.match(read("entry/src/main/ets/runtime/HarmonySessionStorage.ets"), /prefs\.flush/);
const workspaceCache = read("entry/src/main/ets/runtime/HarmonyWorkspaceCache.ets");
assert.match(workspaceCache, /preferences\.getPreferences/);
assert.match(workspaceCache, /sanitizeWorkspaceSnapshot/);
assert.match(workspaceCache, /accountName/);
assert.doesNotMatch(workspaceCache, /sourceUri/);
assert.doesNotMatch(workspaceCache, /previewUrl/);
assert.match(read("entry/src/main/ets/runtime/HarmonyContext.ets"), /setHarmonyAbilityContext/);
const models = read("entry/src/main/ets/data/FdModels.ets");
assert.match(models, /createUuid/);
assert.match(models, /FdAttachmentPatch/);
assert.match(models, /thread\.message-sent/);
assert.match(models, /assistant\.reasoning/);
assert.match(models, /sanitizeWorkspaceSnapshot/);
assert.match(models, /应用重启后需要重新选择附件/);
assert.match(config, /deepseek-flash/);
assert.match(moduleJson5, /ohos\.permission\.INTERNET/);
assert.match(moduleJson5, /deviceTypes/);

console.log(`Harmony native static checks passed (${requiredFiles.length} files).`);
