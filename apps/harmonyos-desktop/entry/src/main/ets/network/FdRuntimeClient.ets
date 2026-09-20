import { http, webSocket } from '@kit.NetworkKit';

import {
  FD_DEFAULT_MODEL,
  FD_LEGACY_API_PREFIX,
  FD_RUNTIME_API_PREFIX,
  FD_RUNTIME_ORIGIN,
  FD_SUPPORTED_MODELS
} from '../config/HarmonyConfig';
import {
  FdActivity,
  FdAttachment,
  FdAttachmentState,
  FdMessage,
  FdSession,
  FdSkill,
  FdStreamEvent,
  FdThreadDetail,
  FdThreadShell,
  createClientId,
  createUuid,
  isoNow
} from '../data/FdModels';
import { util } from '@kit.ArkTS';

type JsonObject = Record<string, Object>;
type HttpVerb = 'GET' | 'POST' | 'DELETE';

export class FdRuntimeError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'FdRuntimeError';
    this.code = code;
  }
}

export interface FdTurnReceipt {
  turnId: string;
  sequence: number;
  streamUrl: string;
  events: Array<FdStreamEvent>;
}

export interface FdHistoryPage {
  messages: Array<FdMessage>;
  hasMoreHistory: boolean;
  historyCursor?: string;
}

export interface FdStreamHandle {
  close(): void;
}

export class FdRuntimeClient {
  private readonly origin: string;
  private accessToken: string = '';
  private runtimeTokenId: number = 0;
  private userName: string = '';
  private modelCatalog: Array<string> = FD_SUPPORTED_MODELS.slice();

  constructor(origin: string = FD_RUNTIME_ORIGIN) {
    this.origin = origin.replace(/\/$/, '');
  }

  get isAuthenticated(): boolean {
    return this.accessToken.length > 0;
  }

  get currentUserName(): string {
    return this.userName;
  }

  get supportedModels(): Array<string> {
    return this.modelCatalog.slice();
  }

  async login(username: string, password: string): Promise<FdSession> {
    const root = await this.request(`${FD_LEGACY_API_PREFIX}/user/login`, 'POST', {
      username,
      password
    });
    if (root['success'] !== true) {
      throw new FdRuntimeError('invalid_credentials', '用户名或密码不正确');
    }
    const data = object(root['data']);
    const token = stringValue(data['access_token']);
    if (token.length === 0) {
      throw new FdRuntimeError('invalid_response', '登录响应缺少 access_token');
    }
    this.accessToken = token;
    this.userName = username;
    const expiresAt = numberValue(data['access_expires_at'], 0);
    return {
      accessToken: token,
      accessExpiresAt: expiresAt,
      userName: username,
      ...(this.runtimeTokenId === 0 ? {} : { runtimeTokenId: this.runtimeTokenId })
    };
  }

  logout(): void {
    this.accessToken = '';
    this.runtimeTokenId = 0;
    this.userName = '';
  }

  async getSkills(): Promise<Array<FdSkill>> {
    let root: JsonObject;
    try {
      root = await this.request(`${FD_RUNTIME_API_PREFIX}/skills`, 'GET');
    } catch (error) {
      if (!(error instanceof FdRuntimeError) || (error.code !== 'http_404' && error.code !== 'http_405')) throw error;
      root = await this.request(`${FD_LEGACY_API_PREFIX}/fd-skills/self`, 'GET');
    }
    const data = object(root['data'] ?? root);
    const skills = arrayValue(data['skills']);
    const capabilities = object(data['model_capabilities'] ?? {});
    const advertisedModels = Object.keys(capabilities)
      .filter((model: string) => model.length > 0 && model.length <= 128);
    if (advertisedModels.length > 0) this.modelCatalog = advertisedModels;
    return skills.map((raw: Object) => {
      const item = object(raw);
      const modelCapabilities: Array<string> = [];
      for (const model of this.modelCatalog) {
        const capability = object(capabilities[model] ?? {});
        if (capability['fd_skills'] === true) modelCapabilities.push(model);
      }
      return {
        id: numberValue(item['id'], 0),
        versionId: numberValue(item['version_id'], 0),
        name: stringValue(item['name']),
        displayName: stringValue(item['display_name']),
        description: stringValue(item['description']),
        riskTier: stringValue(item['risk_tier']),
        modelCapabilities
      } as FdSkill;
    });
  }

  async listThreads(): Promise<Array<FdThreadShell>> {
    const root = await this.request(`${FD_RUNTIME_API_PREFIX}/threads`, 'GET');
    const data = object(root['data'] ?? root);
    const rows = arrayValue(data['threads']);
    return rows.map((raw: Object) => parseThreadShell(object(raw)));
  }

  async getThread(threadId: string): Promise<FdThreadDetail> {
    const root = await this.request(
      `${FD_RUNTIME_API_PREFIX}/threads/${encodeURIComponent(threadId)}`,
      'GET'
    );
    return parseThreadDetail(object(root['data'] ?? root));
  }

  async createThread(model: string): Promise<FdThreadDetail> {
    const root = await this.request(`${FD_RUNTIME_API_PREFIX}/threads`, 'POST', {
      clientThreadId: createUuid(),
      model: model.length > 0 ? model : FD_DEFAULT_MODEL
    });
    return parseThreadDetail(object(root['data'] ?? root));
  }

  async getLegacyHistory(threadId: string): Promise<Array<FdMessage>> {
    const root = await this.request(
      `${FD_LEGACY_API_PREFIX}/agent/desktop/threads/${encodeURIComponent(threadId)}/history`,
      'GET'
    );
    const data = object(root['data'] ?? root);
    return arrayValue(data['messages']).map((raw: Object) => {
      const item = object(raw);
      return {
        id: stringValue(item['id']) || createClientId('history'),
        role: stringValue(item['role']) as FdMessage['role'] || 'assistant',
        text: stringValue(item['text']),
        createdAt: stringValue(item['createdAt'] ?? item['created_at']) || isoNow(),
        updatedAt: stringValue(item['createdAt'] ?? item['created_at']) || isoNow(),
        streaming: false,
        attachments: []
      } as FdMessage;
    });
  }

  async getThreadHistory(threadId: string, before: string, limit: number = 200): Promise<FdHistoryPage> {
    const query = `?before=${encodeURIComponent(before)}&limit=${Math.max(1, Math.min(500, Math.floor(limit)))}`;
    const root = await this.request(
      `${FD_RUNTIME_API_PREFIX}/threads/${encodeURIComponent(threadId)}/history${query}`,
      'GET'
    );
    const data = object(root['data'] ?? root);
    const messages = arrayValue(data['messages']).map((raw: Object) => parseMessage(object(raw)));
    const cursor = stringValue(data['cursor'] ?? data['historyCursor'] ?? data['history_cursor'] ?? data['next_before']);
    return {
      messages,
      hasMoreHistory: data['truncated'] === true || data['hasMoreHistory'] === true || data['has_more_history'] === true,
      ...(cursor.length === 0 ? {} : { historyCursor: cursor })
    };
  }

  async startTurn(
    threadId: string,
    text: string,
    attachments: Array<FdAttachment>,
    model: string,
    skillVersionId?: number,
    onEvent?: (event: FdStreamEvent) => void
  ): Promise<FdTurnReceipt> {
    const body: JsonObject = {
      requestId: createClientId('request'),
      idempotencyKey: createClientId('turn'),
      text,
      model: model.length > 0 ? model : FD_DEFAULT_MODEL,
      attachments: attachments.map((item: FdAttachment) => ({ attachmentId: item.attachmentId })),
      ...(skillVersionId === undefined ? {} : { skillVersionId })
    };
    try {
      const events = await this.requestSse(
        `${FD_RUNTIME_API_PREFIX}/threads/${encodeURIComponent(threadId)}/turns`, body,
        onEvent ?? ((_event: FdStreamEvent): void => {})
      );
      const started = events.find((event: FdStreamEvent) => event.type === 'turn.started');
      return {
        turnId: started !== undefined && started.type === 'turn.started' ? started.turnId : createClientId('turn'),
        sequence: 0,
        streamUrl: '',
        events
      };
    } catch (error) {
      if (!(error instanceof FdRuntimeError) || (error.code !== 'http_404' && error.code !== 'http_405')) throw error;
      if (attachments.length > 0) {
        throw new FdRuntimeError('attachments_require_mobile_api', '当前 FD 网关旧接口不支持鸿蒙附件，请等待移动附件接口上线');
      }
      return this.startLegacySseTurn(threadId, text, model, skillVersionId, onEvent);
    }
  }

  async interruptTurn(threadId: string, turnId: string): Promise<boolean> {
    const root = await this.request(
      `${FD_RUNTIME_API_PREFIX}/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/interrupt`,
      'POST',
      { requestId: createClientId('interrupt') }
    );
    const data = object(root['data'] ?? root);
    return data['interrupted'] !== false;
  }

  async createAttachmentUpload(
    threadId: string,
    name: string,
    mimeType: string,
    sizeBytes: number,
    sha256: string
  ): Promise<{ attachmentId: string; chunkSize: number; uploadUrl: string }> {
    const root = await this.request(`${FD_RUNTIME_API_PREFIX}/attachments`, 'POST', {
      threadId,
      name,
      mimeType,
      sizeBytes,
      ...(sha256.length > 0 ? { sha256 } : {})
    });
    const data = object(root['data'] ?? root);
    return {
      attachmentId: stringValue(data['attachmentId'] ?? data['attachment_id']),
      chunkSize: numberValue(data['chunkSize'] ?? data['chunk_size'], 8 * 1024 * 1024),
      uploadUrl: stringValue(data['uploadUrl'] ?? data['upload_url'])
    };
  }

  async uploadAttachmentPart(
    uploadUrl: string,
    partIndex: number,
    totalParts: number,
    data: ArrayBuffer,
    checksum: string
  ): Promise<void> {
    if (this.accessToken.length === 0) throw new FdRuntimeError('unauthenticated', '请先登录 FD AI');
    const request = http.createHttp();
    try {
      const target = uploadUrl.startsWith('http://') || uploadUrl.startsWith('https://')
        ? uploadUrl
        : `${this.origin}${uploadUrl.startsWith('/') ? '' : '/'}${uploadUrl}`;
      const response = await request.request(target, {
        method: http.RequestMethod.PUT,
        header: {
          'Content-Type': 'application/octet-stream',
          'X-Part-Index': String(partIndex),
          'X-Part-Count': String(totalParts),
          ...(target.startsWith(this.origin) ? { Authorization: `Bearer ${this.accessToken}` } : {}),
          ...(checksum.length > 0 ? { 'X-Part-SHA256': checksum } : {})
        },
        extraData: data,
        expectDataType: http.HttpDataType.STRING
      });
      if (response.responseCode < 200 || response.responseCode >= 300) {
        throw new FdRuntimeError(`http_${response.responseCode}`, '附件分片上传失败');
      }
    } catch (error) {
      if (error instanceof FdRuntimeError) throw error;
      throw new FdRuntimeError('network_error', '附件分片上传连接失败');
    } finally {
      request.destroy();
    }
  }

  async completeAttachmentUpload(
    attachmentId: string,
    totalParts: number,
    sha256: string
  ): Promise<FdAttachment> {
    const root = await this.request(
      `${FD_RUNTIME_API_PREFIX}/attachments/${encodeURIComponent(attachmentId)}/complete`,
      'POST',
      { totalParts, sha256 }
    );
    const data = object(root['data'] ?? root);
    return {
      attachmentId,
      name: stringValue(data['name']),
      mimeType: stringValue(data['mimeType'] ?? data['mime_type']),
      sizeBytes: numberValue(data['sizeBytes'] ?? data['size_bytes'], 0),
      state: (stringValue(data['state']) as FdAttachment['state']) || 'processing',
      progress: numberValue(data['progress'], stringValue(data['state']) === 'ready' ? 100 : 0),
      ...(stringValue(data['errorMessage'] ?? data['error_message']).length === 0 ? {} : { errorMessage: stringValue(data['errorMessage'] ?? data['error_message']) })
    };
  }

  async getPreviewUrl(attachmentId: string): Promise<string> {
    const root = await this.request(
      `${FD_RUNTIME_API_PREFIX}/attachments/${encodeURIComponent(attachmentId)}/preview-url`,
      'POST',
      { requestId: createClientId('preview') }
    );
    const data = object(root['data'] ?? root);
    const url = stringValue(data['url'] ?? data['previewUrl'] ?? data['preview_url']);
    return url.startsWith('/') ? `${this.origin}${url}` : url;
  }

  connectThreadStream(
    threadId: string,
    afterSequence: number,
    resumeToken: string,
    onEvent: (event: FdStreamEvent) => void,
    onClosed: (message: string) => void
  ): FdStreamHandle {
    const socket = webSocket.createWebSocket();
    const streamUrl = this.origin.replace(/^http/, 'ws') +
      `${FD_RUNTIME_API_PREFIX}/threads/${encodeURIComponent(threadId)}/stream` +
      `?afterSequence=${afterSequence}&resumeToken=${encodeURIComponent(resumeToken)}`;
    socket.on('message', (value: string | ArrayBuffer) => {
      try {
        const raw = typeof value === 'string' ? value : String(value);
        onEvent(parseStreamEvent(object(JSON.parse(raw))));
      } catch (_error) {
        onClosed('流式事件无法解析');
      }
    });
    socket.on('error', () => onClosed('流式连接失败'));
    socket.on('close', () => onClosed('流式连接已关闭'));
    socket.connect(streamUrl, {
      header: { Authorization: `Bearer ${this.accessToken}` }
    }).catch(() => onClosed('无法连接 FD Runtime 流'));
    return { close: () => { socket.close(); } };
  }

  private async findRuntimeToken(): Promise<number> {
    const tokenName = 'harmony-native-fd-client';
    const search = await this.request(
      `${FD_LEGACY_API_PREFIX}/token/search?keyword=${encodeURIComponent(tokenName)}&p=1&size=100`,
      'GET'
    );
    const data = object(search['data'] ?? {});
    const items = arrayValue(data['items']);
    const existing = items.find((raw: Object) => stringValue(object(raw)['name']) === tokenName);
    const id = existing === undefined ? 0 : numberValue(object(existing)['id'], 0);
    if (id > 0) return id;
    throw new FdRuntimeError('token_unavailable', '网关未配置鸿蒙兼容 Token，请联系管理员配置后重试');
  }

  private async startLegacySseTurn(
    threadId: string,
    text: string,
    model: string,
    skillVersionId?: number,
    onEvent?: (event: FdStreamEvent) => void
  ): Promise<FdTurnReceipt> {
    if (this.runtimeTokenId === 0) this.runtimeTokenId = await this.findRuntimeToken();
    const body: JsonObject = {
      client_thread_id: threadId,
      model: model.length > 0 ? model : FD_DEFAULT_MODEL,
      token_id: this.runtimeTokenId,
      message: text,
      // The existing enterprise gateway validates the legacy desktop client marker.
      // The new mobile API does not rely on this compatibility field.
      client: 'fd_desktop',
      ...(skillVersionId === undefined ? {} : { skill_version_ids: [skillVersionId] })
    };
    const raw = await this.requestText(`${FD_LEGACY_API_PREFIX}/agent/turns`, body, 'text/event-stream');
    const events = parseLegacySse(raw);
    if (onEvent !== undefined) {
      for (const event of events) onEvent(event);
    }
    const started = events.find((event: FdStreamEvent) => event.type === 'turn.started');
    const turnId = started !== undefined && started.type === 'turn.started' ? started.turnId : createClientId('turn');
    return { turnId, sequence: 0, streamUrl: '', events };
  }

  private async request(path: string, method: HttpVerb, body?: JsonObject): Promise<JsonObject> {
    if (method !== 'GET' && this.accessToken.length === 0 && !path.endsWith('/user/login')) {
      throw new FdRuntimeError('unauthenticated', '请先登录 FD AI');
    }
    const request = http.createHttp();
    const options: http.HttpRequestOptions = {
      method: method === 'GET' ? http.RequestMethod.GET : (method === 'POST' ? http.RequestMethod.POST : http.RequestMethod.DELETE),
      header: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(this.accessToken.length === 0 ? {} : { Authorization: `Bearer ${this.accessToken}` })
      },
      expectDataType: http.HttpDataType.STRING
    };
    if (body !== undefined) options.extraData = JSON.stringify(body);
    try {
      const response = await request.request(this.origin + path, options);
      const raw = typeof response.result === 'string' ? response.result : String(response.result);
      const parsed = object(JSON.parse(raw));
      if (response.responseCode < 200 || response.responseCode >= 300) {
        throw new FdRuntimeError(`http_${response.responseCode}`, stringValue(parsed['message']) || 'FD Runtime 请求失败');
      }
      return parsed;
    } catch (error) {
      if (error instanceof FdRuntimeError) throw error;
      throw new FdRuntimeError('network_error', '无法连接 FD Runtime');
    } finally {
      request.destroy();
    }
  }

  private async requestText(path: string, body: JsonObject, accept: string): Promise<string> {
    if (this.accessToken.length === 0) throw new FdRuntimeError('unauthenticated', '请先登录 FD AI');
    const request = http.createHttp();
    try {
      const response = await request.request(this.origin + path, {
        method: http.RequestMethod.POST,
        header: {
          Accept: accept,
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`
        },
        extraData: JSON.stringify(body),
        expectDataType: http.HttpDataType.STRING
      });
      const raw = typeof response.result === 'string' ? response.result : String(response.result);
      if (response.responseCode < 200 || response.responseCode >= 300) {
        throw new FdRuntimeError(`http_${response.responseCode}`, 'FD Agent 请求失败');
      }
      return raw;
    } catch (error) {
      if (error instanceof FdRuntimeError) throw error;
      throw new FdRuntimeError('network_error', '无法连接 FD Agent');
    } finally {
      request.destroy();
    }
  }

  private async requestSse(
    path: string,
    body: JsonObject,
    onEvent: (event: FdStreamEvent) => void
  ): Promise<Array<FdStreamEvent>> {
    if (this.accessToken.length === 0) throw new FdRuntimeError('unauthenticated', '请先登录 FD AI');
    const request = http.createHttp();
    const decoder = util.TextDecoder.create('utf-8', { ignoreBOM: true });
    const events: Array<FdStreamEvent> = [];
    let pending = '';
    let sequence = 0;
    let parseError: FdRuntimeError | undefined;
    let resolveEnd: (() => void) | undefined;
    const endPromise = new Promise<void>((resolve: () => void) => { resolveEnd = resolve; });
    const handleChunk = (data: ArrayBuffer): void => {
      if (parseError !== undefined) return;
      pending += decoder.decodeToString(new Uint8Array(data), { stream: true });
      const blocks = pending.replace(/\r\n/g, '\n').split('\n\n');
      pending = blocks.pop() ?? '';
      for (const block of blocks) {
        try {
          const parsed = parseLegacySseBlock(block, sequence);
          sequence = parsed.sequence;
          if (parsed.event !== undefined) {
            events.push(parsed.event);
            onEvent(parsed.event);
          }
        } catch (error) {
          parseError = error instanceof FdRuntimeError
            ? error
            : new FdRuntimeError('invalid_stream', 'FD Agent 返回了无法解析的事件');
          return;
        }
      }
    };
    const handleEnd = (): void => {
      if (resolveEnd !== undefined) resolveEnd();
    };
    request.on('dataReceive', handleChunk);
    request.on('dataEnd', handleEnd);
    try {
      const responseCode = await new Promise<number>((resolve: (value: number) => void, reject: (reason: Object) => void) => {
        request.requestInStream(this.origin + path, {
          method: http.RequestMethod.POST,
          header: {
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.accessToken}`
          },
          extraData: JSON.stringify(body),
          usingCache: false,
          readTimeout: 300000,
          connectTimeout: 60000
        }, (error: Object, code: number) => {
          if (error !== null && error !== undefined) reject(error);
          else resolve(code);
        });
      });
      await endPromise;
      pending += decoder.decodeToString(new Uint8Array(0), { stream: false });
      if (pending.trim().length > 0 && parseError === undefined) {
        const parsed = parseLegacySseBlock(pending, sequence);
        sequence = parsed.sequence;
        if (parsed.event !== undefined) {
          events.push(parsed.event);
          onEvent(parsed.event);
        }
      }
      if (responseCode < 200 || responseCode >= 300) {
        throw new FdRuntimeError(`http_${responseCode}`, 'FD Agent 请求失败');
      }
      if (parseError !== undefined) throw parseError;
      if (events.length === 0) throw new FdRuntimeError('empty_stream', 'FD Agent 没有返回任务事件');
      return events;
    } catch (error) {
      if (error instanceof FdRuntimeError) throw error;
      throw new FdRuntimeError('network_error', '无法连接 FD Agent');
    } finally {
      request.off('dataReceive', handleChunk);
      request.off('dataEnd', handleEnd);
      request.destroy();
    }
  }
}

function object(value: Object): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as JsonObject;
}

function arrayValue(value: Object): Array<Object> {
  return Array.isArray(value) ? value as Array<Object> : [];
}

function stringValue(value: Object): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: Object, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseThreadShell(value: JsonObject): FdThreadShell {
  return {
    id: stringValue(value['id']),
    title: stringValue(value['title']) || '未命名任务',
    model: stringValue(value['model']) || FD_DEFAULT_MODEL,
    skillVersionId: numberValue(value['skillVersionId'] ?? value['skill_version_id'], 0) || undefined,
    state: stringValue(value['state']) as FdThreadShell['state'] || 'idle',
    latestMessage: stringValue(value['latestMessage'] ?? value['latest_message']),
    updatedAt: stringValue(value['updatedAt'] ?? value['updated_at']) || isoNow(),
    hasPendingApprovals: value['hasPendingApprovals'] === true || value['has_pending_approvals'] === true
  } as FdThreadShell;
}

function parseThreadDetail(value: JsonObject): FdThreadDetail {
  const shell = parseThreadShell(value);
  const messages: Array<FdMessage> = [];
  const rawMessages = arrayValue(value['messages']);
  for (const raw of rawMessages) {
    const item = object(raw);
    messages.push(parseMessage(item));
  }
  return {
    ...shell,
    messages,
    activities: arrayValue(value['activities']).map((raw: Object) => parseActivity(object(raw))),
    attachments: arrayValue(value['attachments']).map((raw: Object) => parseAttachment(object(raw))),
    sequence: numberValue(value['sequence'] ?? value['snapshotSequence'], 0),
    resumeToken: stringValue(value['resumeToken'] ?? value['resume_token']) || undefined,
    hasMoreHistory: value['hasMoreHistory'] === true || value['has_more_history'] === true,
    historyCursor: stringValue(value['historyCursor'] ?? value['history_cursor']) || undefined
  } as FdThreadDetail;
}

function parseMessage(item: JsonObject): FdMessage {
  return {
    id: identifierValue(item['id']) || createClientId('message'),
    role: stringValue(item['role']) as FdMessage['role'] || 'assistant',
    text: stringValue(item['text']),
    createdAt: stringValue(item['createdAt'] ?? item['created_at']) || isoNow(),
    updatedAt: stringValue(item['updatedAt'] ?? item['updated_at']) || isoNow(),
    streaming: item['streaming'] === true,
    attachments: arrayValue(item['attachments']).map((raw: Object) => parseAttachment(object(raw)))
  } as FdMessage;
}

function parseAttachment(item: JsonObject): FdAttachment {
  const previewUrl = stringValue(item['previewUrl'] ?? item['preview_url']);
  const sourceUri = stringValue(item['sourceUri'] ?? item['source_uri']);
  const errorMessage = stringValue(item['errorMessage'] ?? item['error_message']);
  return {
    attachmentId: identifierValue(item['attachmentId'] ?? item['attachment_id'] ?? item['id']) || createClientId('attachment'),
    name: stringValue(item['name']) || '附件',
    mimeType: stringValue(item['mimeType'] ?? item['mime_type']) || 'application/octet-stream',
    sizeBytes: numberValue(item['sizeBytes'] ?? item['size_bytes'], 0),
    state: attachmentState(item['state']),
    progress: Math.max(0, Math.min(100, numberValue(item['progress'], 0))),
    ...(previewUrl.length === 0 ? {} : { previewUrl }),
    ...(sourceUri.length === 0 ? {} : { sourceUri }),
    ...(errorMessage.length === 0 ? {} : { errorMessage })
  } as FdAttachment;
}

function attachmentState(value: Object): FdAttachmentState {
  const state = stringValue(value);
  if (state === 'selected' || state === 'uploading' || state === 'processing' || state === 'ready' || state === 'failed') {
    return state as FdAttachmentState;
  }
  return 'processing';
}

function parseActivity(item: JsonObject): FdActivity {
  const tone = stringValue(item['tone']);
  return {
    id: identifierValue(item['id']) || createClientId('activity'),
    kind: stringValue(item['kind'] ?? item['type']) || 'runtime',
    summary: stringValue(item['summary'] ?? item['message']),
    tone: tone === 'tool' || tone === 'approval' || tone === 'error' ? tone : 'info',
    createdAt: stringValue(item['createdAt'] ?? item['created_at']) || isoNow()
  } as FdActivity;
}

function identifierValue(value: Object): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function parseStreamEvent(value: JsonObject): FdStreamEvent {
  const type = stringValue(value['type']);
  const sequence = numberValue(value['sequence'], 0);
  const turnId = stringValue(value['turnId'] ?? value['turn_id']);
  const stableMessageId = stringValue(value['messageId'] ?? value['message_id']) ||
    (turnId.length > 0 ? `assistant-${turnId}` : createClientId('message'));
  if (type === 'assistant.delta') return {
    type: 'assistant.delta', sequence, messageId: stableMessageId, delta: stringValue(value['delta'])
  };
  if (type === 'turn.completed') {
    const message = object(value['message']);
    return {
      type: 'turn.completed', sequence,
      messageId: stringValue(value['messageId'] ?? value['message_id']) || stringValue(message['id']) || stableMessageId,
      text: stringValue(value['text']) || stringValue(message['text']),
      resumeToken: stringValue(value['resumeToken'] ?? value['resume_token']) || undefined
    };
  }
  if (type === 'turn.failed') return {
    type: 'turn.failed', sequence, message: stringValue(value['message']) || '任务失败', retryable: value['retryable'] === true
  };
  if (type === 'turn.started') return {
    type: 'turn.started', sequence, turnId, model: stringValue(value['model'])
  };
  if (type === 'turn.progress') return {
    type: 'turn.progress', sequence, phase: stringValue(value['phase']), message: stringValue(value['message'])
  };
  if (type === 'skill.authorized') return {
    type: 'skill.authorized', sequence, skillVersionId: numberValue(value['skillVersionId'] ?? value['skill_version_id'], 0)
  };
  if (type === 'thread.snapshot') return {
    type: 'thread.snapshot', sequence, detail: parseThreadDetail(object(value['detail'] ?? value)), resumeToken: stringValue(value['resumeToken'] ?? value['resume_token']) || undefined
  };
  if (type === 'thread.synchronized') return { type: 'thread.synchronized', sequence };
  if (type === 'turn.interrupted') return { type: 'turn.interrupted', sequence, message: stringValue(value['message']) || undefined };
  throw new FdRuntimeError('invalid_event', 'FD Runtime 返回了未知事件');
}

function parseLegacySse(raw: string): Array<FdStreamEvent> {
  const events: Array<FdStreamEvent> = [];
  let sequence = 0;
  const blocks = raw.replace(/\r\n/g, '\n').split('\n\n');
  for (const block of blocks) {
    const parsed = parseLegacySseBlock(block, sequence);
    sequence = parsed.sequence;
    if (parsed.event !== undefined) {
      events.push(parsed.event);
    }
  }
  if (events.length === 0) throw new FdRuntimeError('empty_stream', 'FD Agent 没有返回任务事件');
  return events;
}

function parseLegacySseBlock(block: string, currentSequence: number): { event?: FdStreamEvent; sequence: number } {
  let eventName = '';
  const dataLines: Array<string> = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (eventName.length === 0 || dataLines.length === 0) return { sequence: currentSequence };
  try {
    const value = object(JSON.parse(dataLines.join('\n')));
    const advertisedSequence = numberValue(value['sequence'], 0);
    const sequence = advertisedSequence > 0 ? advertisedSequence : currentSequence + 1;
    const nextSequence = Math.max(currentSequence, sequence);
    const turnId = stringValue(value['turn_id'] ?? value['turnId']);
    const stableMessageId = stringValue(value['message_id'] ?? value['messageId']) ||
      (turnId.length > 0 ? `assistant-${turnId}` : createClientId('message'));
    if (eventName === 'turn.started') return { sequence: nextSequence, event: { type: 'turn.started', sequence: nextSequence, turnId, model: stringValue(value['model']) } };
    if (eventName === 'turn.progress') return { sequence: nextSequence, event: { type: 'turn.progress', sequence: nextSequence, phase: stringValue(value['phase']), message: stringValue(value['message']) } };
    if (eventName === 'assistant.delta') return { sequence: nextSequence, event: { type: 'assistant.delta', sequence: nextSequence, messageId: stableMessageId, delta: stringValue(value['delta']) } };
    if (eventName === 'turn.completed') {
      const message = object(value['message'] ?? value);
      return { sequence: nextSequence, event: { type: 'turn.completed', sequence: nextSequence, messageId: stringValue(value['message_id'] ?? value['messageId']) || stringValue(message['id']) || stableMessageId, text: stringValue(value['text']) || stringValue(message['text']), resumeToken: stringValue(value['resume_token']) || undefined } };
    }
    if (eventName === 'turn.failed') return { sequence: nextSequence, event: { type: 'turn.failed', sequence: nextSequence, message: stringValue(value['message']) || '任务失败', retryable: value['retryable'] === true } };
    if (eventName === 'tool.started') return { sequence: nextSequence, event: { type: 'tool.started', sequence: nextSequence, tool: stringValue(value['tool']), label: stringValue(value['label']) } };
    if (eventName === 'tool.completed') return { sequence: nextSequence, event: { type: 'tool.completed', sequence: nextSequence, tool: stringValue(value['tool']), status: value['status'] === 'succeeded' ? 'succeeded' : 'failed' } };
    return { sequence: currentSequence };
  } catch (_error) {
    throw new FdRuntimeError('invalid_stream', 'FD Agent 返回了无法解析的事件');
  }
}
