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

export interface FdQueuedTurn {
  id: string;
  text: string;
  attachments: Array<FdAttachment>;
  skillVersionId?: number;
  model: string;
  createdAt: string;
}

export type FdStreamEvent =
  | { type: 'thread.snapshot'; sequence: number; detail: FdThreadDetail; resumeToken?: string }
  | { type: 'thread.synchronized'; sequence: number }
  | { type: 'turn.started'; sequence: number; turnId: string; model: string }
  | { type: 'skill.authorized'; sequence: number; skillVersionId: number }
  | { type: 'tool.started'; sequence: number; tool: string; label: string }
  | { type: 'tool.completed'; sequence: number; tool: string; status: 'succeeded' | 'failed' }
  | { type: 'attachment.processing'; sequence: number; attachmentId: string; progress: number }
  | { type: 'attachment.ready'; sequence: number; attachmentId: string; previewUrl?: string }
  | { type: 'attachment.failed'; sequence: number; attachmentId: string; message: string }
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
