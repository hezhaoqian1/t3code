import assert from "node:assert/strict";

const baseUrl = (value("FD_HARMONY_LIVE_BASE_URL") ?? "https://ai-api.fdsure.com").replace(
  /\/$/,
  "",
);
const username = value("FD_HARMONY_LIVE_USERNAME");
const password = value("FD_HARMONY_LIVE_PASSWORD");
const timeoutMs = 30_000;

if (username === undefined || password === undefined) {
  console.error(
    "Set FD_HARMONY_LIVE_USERNAME and FD_HARMONY_LIVE_PASSWORD to run the live Harmony contract smoke.",
  );
  process.exit(2);
}

const login = await request("/api/user/login", {
  method: "POST",
  body: { username, password },
  authenticated: false,
});
const token = stringValue(login.data?.access_token);
assert.ok(token.length > 0, "login did not return an access token");

const headers = { Authorization: `Bearer ${token}` };
const bootstrap = await request("/api/mobile/v1/bootstrap", { headers });
const skills = await request("/api/mobile/v1/skills", { headers });
const threads = await request("/api/mobile/v1/threads", { headers });
const bootstrapData = object(bootstrap.data ?? bootstrap);
const bootstrapCapabilities = object(
  bootstrapData.model_capabilities ?? bootstrapData.modelCapabilities,
);
const advertisedModels = Object.keys(bootstrapCapabilities);
assert.ok(advertisedModels.includes("deepseek-flash"), "bootstrap omitted deepseek-flash");
const rawThreadRows = object(threads.data ?? threads).threads;
assert.ok(Array.isArray(rawThreadRows), "thread list is not an array");
const threadRows = rawThreadRows;
const rawSkills = object(skills.data ?? skills).skills;
assert.ok(Array.isArray(rawSkills), "skill list is not an array");
assert.ok(rawSkills.length > 0, "skill list is empty");

let detailCount = 0;
let previewChecked = false;
let previewMimeType;
let readyAttachmentCount = 0;
for (const candidate of threadRows.slice(0, 25)) {
  if (!isRecord(candidate) || stringValue(candidate.id).length === 0) continue;
  const threadId = stringValue(candidate.id);
  const detail = await request(`/api/mobile/v1/threads/${encodeURIComponent(threadId)}`, {
    headers,
  });
  const thread = isRecord(detail.data) ? detail.data : detail;
  assert.equal(stringValue(thread.id), threadId, "thread detail id does not match list shell");
  assert.ok(Array.isArray(thread.messages), "thread detail messages is not an array");
  detailCount += 1;

  const attachment = findReadyAttachment(thread);
  if (attachment === undefined || stringValue(attachment.attachmentId).length === 0) continue;
  readyAttachmentCount += 1;
  const preview = await request(
    `/api/mobile/v1/attachments/${encodeURIComponent(stringValue(attachment.attachmentId))}/preview-url`,
    { method: "POST", headers, body: { requestId: `harmony-live-${crypto.randomUUID()}` } },
  );
  const previewData = isRecord(preview.data) ? preview.data : preview;
  const previewUrl = stringValue(
    previewData.url ?? previewData.previewUrl ?? previewData.preview_url,
  );
  assert.ok(previewUrl.length > 0, "ready attachment did not return a preview URL");
  const parsedPreviewUrl = new URL(previewUrl, baseUrl);
  assert.equal(
    parsedPreviewUrl.origin,
    new URL(baseUrl).origin,
    "preview URL escaped gateway origin",
  );
  const asset = await readPreviewPrefix(parsedPreviewUrl.toString());
  previewMimeType = asset.contentType;
  assert.ok(asset.status >= 200 && asset.status < 300, "preview asset request failed");
  previewChecked = true;
  break;
}
assert.ok(detailCount > 0 || threadRows.length === 0, "no usable thread detail was returned");
if (value("FD_HARMONY_LIVE_REQUIRE_PREVIEW") === "1") {
  assert.ok(previewChecked, "no ready attachment was available for preview validation");
}

console.log(
  JSON.stringify({
    baseUrl,
    login: true,
    bootstrap: true,
    modelCount: advertisedModels.length,
    skillCount: rawSkills.length,
    threadCount: threadRows.length,
    detailCount,
    readyAttachmentCount,
    previewChecked,
    ...(previewMimeType === undefined ? {} : { previewMimeType }),
  }),
);

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      "X-Request-ID": `harmony-live-${crypto.randomUUID()}`,
      ...(options.authenticated === false ? {} : (options.headers ?? {})),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let parsed = {};
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch (_error) {
      throw new Error(`${path} returned non-JSON HTTP ${response.status}`);
    }
  }
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return parsed;
}

async function readPreviewPrefix(value) {
  const url = new URL(value, baseUrl);
  const response = await fetch(url, {
    headers: { Range: "bytes=0-31" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.body !== null) {
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel();
  }
  return { status: response.status, contentType: response.headers.get("content-type") ?? "" };
}

function findReadyAttachment(thread) {
  const candidates = [];
  if (Array.isArray(thread.attachments)) candidates.push(...thread.attachments);
  if (Array.isArray(thread.messages)) {
    for (const message of thread.messages) {
      if (isRecord(message) && Array.isArray(message.attachments))
        candidates.push(...message.attachments);
    }
  }
  return candidates.find((attachment) => isRecord(attachment) && attachment.state === "ready");
}

function value(name) {
  const result = process.env[name];
  return result === undefined || result.length === 0 ? undefined : result;
}

function stringValue(input) {
  return typeof input === "string" ? input : "";
}

function object(input) {
  return isRecord(input) ? input : {};
}

function isRecord(input) {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
