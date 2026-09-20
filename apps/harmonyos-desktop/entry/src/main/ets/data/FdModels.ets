export type FdThreadState = 'idle' | 'working' | 'queued' | 'error' | 'offline';
export type FdAttachmentState = 'selected' | 'uploading' | 'processing' | 'ready' | 'failed';

export interface FdAttachment {
  attachmentId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  state: FdAttachmentState;
  progress: number;
  previewUrl?: string;
  sourceUri?: string;
  errorMessage?: string;
}

export interface FdAttachmentPatch {
  state?: FdAttachmentState;
  progress?: number;
  sizeBytes?: number;
  previewUrl?: string;
  errorMessage?: string;
}

export interface FdMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  createdAt: string;
  updatedAt: string;
  streaming: boolean;
  attachments: Array<FdAttachment>;
}

export interface FdActivity {
  id: string;
  kind: string;
  summary: string;
  tone: 'info' | 'tool' | 'approval' | 'error';
  createdAt: string;
}

export interface FdThreadShell {
  id: string;
  title: string;
  model: string;
  skillVersionId?: number;
  state: FdThreadState;
  latestMessage: string;
  updatedAt: string;
  hasPendingApprovals: boolean;
}

export interface FdThreadDetail extends FdThreadShell {
  messages: Array<FdMessage>;
  activities: Array<FdActivity>;
  attachments: Array<FdAttachment>;
  sequence: number;
  resumeToken?: string;
  hasMoreHistory: boolean;
  historyCursor?: string;
}

export interface FdSkill {
  id: number;
  versionId: number;
  name: string;
  displayName: string;
  description: string;
  riskTier: string;
  modelCapabilities: Array<string>;
}

export interface FdSession {
  accessToken: string;
  accessExpiresAt: number;
  userName: string;
  runtimeTokenId?: number;
}

/**
 * The runtime owns credential lifecycle. The client persists only a
 * short-lived session projection and never stores passwords or provider keys.
 */
export interface FdSessionStorage {
  load(): Promise<FdSession | undefined>;
  save(session: FdSession): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryFdSessionStorage implements FdSessionStorage {
  private value: FdSession | undefined;

  async load(): Promise<FdSession | undefined> {
    return this.value;
  }

  async save(session: FdSession): Promise<void> {
    this.value = { ...session };
  }

  async clear(): Promise<void> {
    this.value = undefined;
  }
}

/** Visible-only workspace state used to render the last session offline. */
export interface FdWorkspaceSnapshot {
  accountName: string;
  threads: Array<FdThreadShell>;
  activeThread: FdThreadDetail;
  queuedTurns: Array<FdQueuedTurn>;
  selectedSkillVersionId: number;
  selectedModel: string;
  savedAt: number;
}

export interface FdWorkspaceCache {
  load(accountName: string): Promise<FdWorkspaceSnapshot | undefined>;
  save(snapshot: FdWorkspaceSnapshot): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryFdWorkspaceCache implements FdWorkspaceCache {
  private value: FdWorkspaceSnapshot | undefined;

  async load(accountName: string): Promise<FdWorkspaceSnapshot | undefined> {
    if (this.value === undefined || this.value.accountName !== accountName) return undefined;
    return this.value;
  }

  async save(snapshot: FdWorkspaceSnapshot): Promise<void> {
    this.value = sanitizeWorkspaceSnapshot(snapshot);
  }

  async clear(): Promise<void> {
    this.value = undefined;
  }
}

export interface FdQueuedTurn {
  id: string;
  /** Stable visible user-message id so a failed queue retry cannot duplicate it. */
  messageId: string;
  text: string;
  attachments: Array<FdAttachment>;
  skillVersionId?: number;
  model: string;
  createdAt: string;
}

const CACHE_MAX_CHARS: number = 800000;
const CACHE_MAX_MESSAGES: number = 100;
const CACHE_MAX_ACTIVITIES: number = 32;
const CACHE_MAX_QUEUE: number = 20;

function visibleText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n[离线缓存已截断，重新连接后可加载完整内容]`;
}

function visibleAttachment(attachment: FdAttachment): FdAttachment {
  const interrupted = attachment.state === 'selected' || attachment.state === 'uploading' || attachment.state === 'processing';
  const state: FdAttachmentState = interrupted ? 'failed' : attachment.state;
  return {
    attachmentId: attachment.attachmentId,
    name: visibleText(attachment.name, 240),
    mimeType: attachment.mimeType,
    sizeBytes: Number.isFinite(attachment.sizeBytes) ? Math.max(0, attachment.sizeBytes) : 0,
    state,
    progress: state === 'ready' ? 100 : Math.max(0, Math.min(100, attachment.progress)),
    ...(attachment.errorMessage !== undefined ? { errorMessage: visibleText(attachment.errorMessage, 600) } : {}),
    ...(interrupted && attachment.errorMessage === undefined ? { errorMessage: '应用重启后需要重新选择附件' } : {})
  } as FdAttachment;
}

function visibleMessage(message: FdMessage): FdMessage {
  return {
    id: message.id,
    role: message.role,
    text: visibleText(message.text, 16000),
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    streaming: false,
    attachments: message.attachments.map((attachment: FdAttachment) => visibleAttachment(attachment))
  };
}

function visibleShell(thread: FdThreadShell): FdThreadShell {
  return {
    id: thread.id,
    title: visibleText(thread.title, 240),
    model: thread.model,
    skillVersionId: thread.skillVersionId,
    state: thread.state === 'working' ? 'offline' : thread.state,
    latestMessage: visibleText(thread.latestMessage, 1200),
    updatedAt: thread.updatedAt,
    hasPendingApprovals: thread.hasPendingApprovals
  };
}

function visibleThread(thread: FdThreadDetail): FdThreadDetail {
  const shell = visibleShell(thread);
  return {
    ...shell,
    messages: thread.messages.slice(-CACHE_MAX_MESSAGES).map((message: FdMessage) => visibleMessage(message)),
    activities: thread.activities.slice(-CACHE_MAX_ACTIVITIES).map((activity: FdActivity) => ({
      id: activity.id,
      kind: activity.kind,
      summary: visibleText(activity.summary, 600),
      tone: activity.tone,
      createdAt: activity.createdAt
    })),
    attachments: thread.attachments.map((attachment: FdAttachment) => visibleAttachment(attachment)),
    sequence: Number.isFinite(thread.sequence) ? Math.max(0, thread.sequence) : 0,
    hasMoreHistory: thread.hasMoreHistory
  } as FdThreadDetail;
}

function visibleQueuedTurn(turn: FdQueuedTurn): FdQueuedTurn {
  return {
    id: turn.id,
    messageId: turn.messageId,
    text: visibleText(turn.text, 16000),
    attachments: turn.attachments.map((attachment: FdAttachment) => visibleAttachment(attachment)),
    skillVersionId: turn.skillVersionId,
    model: turn.model,
    createdAt: turn.createdAt
  };
}

/**
 * Strip local-only and short-lived fields before a workspace snapshot crosses
 * into durable storage. The same projection is used by the in-memory fallback
 * so tests exercise the production privacy boundary too.
 */
export function sanitizeWorkspaceSnapshot(snapshot: FdWorkspaceSnapshot): FdWorkspaceSnapshot {
  const safe: FdWorkspaceSnapshot = {
    accountName: snapshot.accountName,
    threads: snapshot.threads.slice(0, 100).map((thread: FdThreadShell) => visibleShell(thread)),
    activeThread: visibleThread(snapshot.activeThread),
    queuedTurns: snapshot.queuedTurns.slice(0, CACHE_MAX_QUEUE).map((turn: FdQueuedTurn) => visibleQueuedTurn(turn)),
    selectedSkillVersionId: snapshot.selectedSkillVersionId,
    selectedModel: snapshot.selectedModel,
    savedAt: snapshot.savedAt
  };
  if (JSON.stringify(safe).length <= CACHE_MAX_CHARS) return safe;
  return {
    ...safe,
    threads: safe.threads.slice(0, 40),
    activeThread: {
      ...safe.activeThread,
      messages: safe.activeThread.messages.slice(-40).map((message: FdMessage) => ({
        ...message,
        text: visibleText(message.text, 4000)
      })),
      activities: safe.activeThread.activities.slice(-12)
    } as FdThreadDetail,
    queuedTurns: safe.queuedTurns.slice(0, 10).map((turn: FdQueuedTurn) => ({
      ...turn,
      text: visibleText(turn.text, 4000)
    }))
  } as FdWorkspaceSnapshot;
}

export type FdStreamEvent =
  | { type: 'thread.snapshot'; sequence: number; detail: FdThreadDetail; resumeToken?: string }
  | { type: 'thread.message-sent'; sequence: number; message: FdMessage }
  | { type: 'thread.synchronized'; sequence: number }
  | { type: 'turn.started'; sequence: number; turnId: string; model: string }
  | { type: 'turn.progress'; sequence: number; phase: string; message: string }
  | { type: 'skill.authorized'; sequence: number; skillVersionId: number }
  | { type: 'tool.started'; sequence: number; tool: string; label: string }
  | { type: 'tool.completed'; sequence: number; tool: string; status: 'succeeded' | 'failed' }
  | { type: 'attachment.processing'; sequence: number; attachmentId: string; progress: number }
  | { type: 'attachment.ready'; sequence: number; attachmentId: string; previewUrl?: string }
  | { type: 'attachment.failed'; sequence: number; attachmentId: string; message: string }
  | { type: 'assistant.reasoning'; sequence: number; message: string }
  | { type: 'assistant.delta'; sequence: number; messageId: string; delta: string }
  | { type: 'turn.completed'; sequence: number; messageId: string; text: string; resumeToken?: string }
  | { type: 'turn.failed'; sequence: number; message: string; retryable: boolean }
  | { type: 'turn.interrupted'; sequence: number; message?: string };

export function createClientId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

export function createUuid(): string {
  const hex = '0123456789abcdef';
  let value = '';
  for (let index = 0; index < 32; index += 1) value += hex[Math.floor(Math.random() * hex.length)];
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20)}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function sampleSkills(): Array<FdSkill> {
  return [
    {
      id: 1,
      versionId: 1,
      name: 'general-assistant',
      displayName: '通用助手',
      description: '基础问答、文件分析和任务执行。',
      riskTier: 'low',
      modelCapabilities: ['deepseek-flash', 'kimi-k3', 'qwen3.8-max', 'glm-5.2']
    },
    {
      id: 2,
      versionId: 2,
      name: 'company-data',
      displayName: '企业数据助手',
      description: '通过受控企业数据工具查询业务信息。',
      riskTier: 'managed',
      modelCapabilities: ['deepseek-flash', 'kimi-k3']
    }
  ];
}

export function sampleThread(): FdThreadDetail {
  return {
    id: createUuid(),
    title: '鸿蒙客户端演示任务',
    model: 'deepseek-flash',
    skillVersionId: 1,
    state: 'idle',
    latestMessage: '选择一个任务开始。',
    updatedAt: isoNow(),
    hasPendingApprovals: false,
    messages: [
      {
        id: 'demo-message',
        role: 'assistant',
        text: '这是原生 ArkUI 客户端的离线演示。登录 FD Runtime 后会加载真实线程和流式事件。',
        createdAt: isoNow(),
        updatedAt: isoNow(),
        streaming: false,
        attachments: []
      }
    ] as Array<FdMessage>,
    activities: [],
    attachments: [],
    sequence: 0,
    hasMoreHistory: false
  } as FdThreadDetail;
}

export function sampleThreadShells(): Array<FdThreadShell> {
  const thread = sampleThread();
  return [
    {
      id: thread.id,
      title: thread.title,
      model: thread.model,
      skillVersionId: thread.skillVersionId,
      state: thread.state,
      latestMessage: thread.latestMessage,
      updatedAt: thread.updatedAt,
      hasPendingApprovals: false
    }
  ];
}
