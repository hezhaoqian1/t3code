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
  FdMessage,
  FdSession,
  FdSkill,
  FdStreamEvent,
  FdThreadDetail,
  FdThreadShell,
  createClientId,
  isoNow
} from '../data/FdModels';

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

export interface FdStreamHandle {
  close(): void;
}

export class FdRuntimeClient {
  private readonly origin: string;
  private accessToken: string = '';
  private runtimeTokenId: number = 0;
  private userName: string = '';

  constructor(origin: string = FD_RUNTIME_ORIGIN) {
    this.origin = origin.replace(/\/$/, '');
  }

  get isAuthenticated(): boolean {
    return this.accessToken.length > 0;
  }

  get currentUserName(): string {
    return this.userName;
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
    const root = await this.request(`${FD_LEGACY_API_PREFIX}/fd-skills/self`, 'GET');
    const data = object(root['data'] ?? root);
    const skills = arrayValue(data['skills']);
    const capabilities = object(data['model_capabilities'] ?? {});
    return skills.map((raw: Object) => {
      const item = object(raw);
      const modelCapabilities: Array<string> = [];
      for (const model of FD_SUPPORTED_MODELS) {
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

  async startTurn(
    threadId: string,
    text: string,
    attachments: Array<FdAttachment>,
    model: string,
    skillVersionId?: number
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
      const root = await this.request(
        `${FD_RUNTIME_API_PREFIX}/threads/${encodeURIComponent(threadId)}/turns`,
        'POST',
        body
      );
      const data = object(root['data'] ?? root);
      return {
        turnId: stringValue(data['turnId'] ?? data['turn_id']) || createClientId('turn'),
        sequence: numberValue(data['sequence'], 0),
        streamUrl: stringValue(data['streamUrl'] ?? data['stream_url']) || 'default',
        events: []
      };
    } catch (error) {
      if (!(error instanceof FdRuntimeError) || (error.code !== 'http_404' && error.code !== 'http_405')) throw error;
      if (attachments.length > 0) {
        throw new FdRuntimeError('attachments_require_mobile_api', '当前 FD 网关旧接口不支持鸿蒙附件，请等待移动附件接口上线');
      }
      return this.startLegacySseTurn(threadId, text, model, skillVersionId);
    }
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.request(
      `${FD_RUNTIME_API_PREFIX}/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/interrupt`,
      'POST',
      { requestId: createClientId('interrupt') }
    );
  }

  async createAttachmentUpload(
    name: string,
    mimeType: string,
    sizeBytes: number,
    sha256: string
  ): Promise<{ attachmentId: string; chunkSize: number; uploadUrl: string }> {
    const root = await this.request(`${FD_RUNTIME_API_PREFIX}/attachments`, 'POST', {
      name,
      mimeType,
      sizeBytes,
      sha256
    });
    const data = object(root['data'] ?? root);
    return {
      attachmentId: stringValue(data['attachmentId'] ?? data['attachment_id']),
      chunkSize: numberValue(data['chunkSize'] ?? data['chunk_size'], 8 * 1024 * 1024),
      uploadUrl: stringValue(data['uploadUrl'] ?? data['upload_url'])
    };
  }

  async getPreviewUrl(attachmentId: string): Promise<string> {
    const root = await this.request(
      `${FD_RUNTIME_API_PREFIX}/attachments/${encodeURIComponent(attachmentId)}/preview-url`,
      'POST',
      { requestId: createClientId('preview') }
    );
    const data = object(root['data'] ?? root);
    return stringValue(data['url'] ?? data['previewUrl'] ?? data['preview_url']);
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

  private async findOrCreateRuntimeToken(): Promise<number> {
    const tokenName = 'harmony-native-fd-client';
    const search = await this.request(
      `${FD_LEGACY_API_PREFIX}/token/search?keyword=${encodeURIComponent(tokenName)}&p=1&size=100`,
      'GET'
    );
    const data = object(search['data'] ?? {});
    const items = arrayValue(data['items']);
    const existing = items.find((raw: Object) => stringValue(object(raw)['name']) === tokenName);
    if (existing !== undefined) return numberValue(object(existing)['id'], 0);
    const created = await this.request(`${FD_LEGACY_API_PREFIX}/token/`, 'POST', {
      name: tokenName,
      expired_time: -1,
      status: 1,
      unlimited_quota: true,
      model_limits_enabled: true,
      model_limits: FD_SUPPORTED_MODELS.join(',')
    });
    if (created['success'] !== true) {
      throw new FdRuntimeError('token_unavailable', '无法配置鸿蒙端模型权限');
    }
    const refreshed = await this.request(
      `${FD_LEGACY_API_PREFIX}/token/search?keyword=${encodeURIComponent(tokenName)}&p=1&size=100`,
      'GET'
    );
    const refreshedData = object(refreshed['data'] ?? {});
    const refreshedItems = arrayValue(refreshedData['items']);
    const match = refreshedItems.find((raw: Object) => stringValue(object(raw)['name']) === tokenName);
    const id = match === undefined ? 0 : numberValue(object(match)['id'], 0);
    if (id === 0) throw new FdRuntimeError('token_unavailable', '鸿蒙端模型权限创建后无法读取');
    return id;
  }

  private async startLegacySseTurn(
    threadId: string,
    text: string,
    model: string,
    skillVersionId?: number
  ): Promise<FdTurnReceipt> {
    if (this.runtimeTokenId === 0) this.runtimeTokenId = await this.findOrCreateRuntimeToken();
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
    messages.push({
      id: stringValue(item['id']),
      role: stringValue(item['role']) as FdMessage['role'] || 'assistant',
      text: stringValue(item['text']),
      createdAt: stringValue(item['createdAt'] ?? item['created_at']) || isoNow(),
      updatedAt: stringValue(item['updatedAt'] ?? item['updated_at']) || isoNow(),
      streaming: item['streaming'] === true,
      attachments: []
    } as FdMessage);
  }
  return {
    ...shell,
    messages,
    activities: [] as Array<FdActivity>,
    attachments: [] as Array<FdAttachment>,
    sequence: numberValue(value['sequence'] ?? value['snapshotSequence'], 0),
    resumeToken: stringValue(value['resumeToken'] ?? value['resume_token']) || undefined,
    hasMoreHistory: value['hasMoreHistory'] === true || value['has_more_history'] === true,
    historyCursor: stringValue(value['historyCursor'] ?? value['history_cursor']) || undefined
  } as FdThreadDetail;
}

function parseStreamEvent(value: JsonObject): FdStreamEvent {
  const type = stringValue(value['type']);
  const sequence = numberValue(value['sequence'], 0);
  if (type === 'assistant.delta') return {
    type: 'assistant.delta', sequence, messageId: stringValue(value['messageId'] ?? value['message_id']), delta: stringValue(value['delta'])
  };
  if (type === 'turn.completed') return {
    type: 'turn.completed', sequence, messageId: stringValue(value['messageId'] ?? value['message_id']), text: stringValue(value['text']), resumeToken: stringValue(value['resumeToken'] ?? value['resume_token']) || undefined
  };
  if (type === 'turn.failed') return {
    type: 'turn.failed', sequence, message: stringValue(value['message']) || '任务失败', retryable: value['retryable'] === true
  };
  if (type === 'turn.started') return {
    type: 'turn.started', sequence, turnId: stringValue(value['turnId'] ?? value['turn_id']), model: stringValue(value['model'])
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
    let eventName = '';
    const dataLines: Array<string> = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (eventName.length === 0 || dataLines.length === 0) continue;
    try {
      const value = object(JSON.parse(dataLines.join('\n')));
      sequence += 1;
      const turnId = stringValue(value['turn_id'] ?? value['turnId']);
      if (eventName === 'turn.started') {
        events.push({ type: 'turn.started', sequence, turnId, model: stringValue(value['model']) });
      } else if (eventName === 'assistant.delta') {
        events.push({ type: 'assistant.delta', sequence, messageId: stringValue(value['message_id'] ?? value['messageId']) || createClientId('message'), delta: stringValue(value['delta']) });
      } else if (eventName === 'turn.completed') {
        const message = object(value['message'] ?? value);
        events.push({ type: 'turn.completed', sequence, messageId: stringValue(message['id']) || createClientId('message'), text: stringValue(message['text']), resumeToken: stringValue(value['resume_token']) || undefined });
      } else if (eventName === 'turn.failed') {
        events.push({ type: 'turn.failed', sequence, message: stringValue(value['message']) || '任务失败', retryable: value['retryable'] === true });
      } else if (eventName === 'tool.started') {
        events.push({ type: 'tool.started', sequence, tool: stringValue(value['tool']), label: stringValue(value['label']) });
      } else if (eventName === 'tool.completed') {
        events.push({ type: 'tool.completed', sequence, tool: stringValue(value['tool']), status: value['status'] === 'succeeded' ? 'succeeded' : 'failed' });
      }
    } catch (_error) {
      throw new FdRuntimeError('invalid_stream', 'FD Agent 返回了无法解析的事件');
    }
  }
  if (events.length === 0) throw new FdRuntimeError('empty_stream', 'FD Agent 没有返回任务事件');
  return events;
}
