import {
  FdAttachment,
  FdAttachmentPatch,
  FdMessage,
  FdQueuedTurn,
  FdSkill,
  FdStreamEvent,
  FdThreadDetail,
  FdThreadShell,
  createClientId,
  isoNow,
  sampleSkills,
  sampleThread,
  sampleThreadShells
} from '../data/FdModels';
import { FdRuntimeClient, FdRuntimeError } from '../network/FdRuntimeClient';

export class FdStore {
  readonly client: FdRuntimeClient;
  threads: Array<FdThreadShell> = [];
  skills: Array<FdSkill> = [];
  models: Array<string> = ['deepseek-flash'];
  activeThread: FdThreadDetail = sampleThread();
  queuedTurns: Array<FdQueuedTurn> = [];
  selectedSkillVersionId: number = 0;
  selectedModel: string = 'deepseek-flash';
  activeTurnId: string = '';
  loading: boolean = false;
  signedIn: boolean = false;
  accountName: string = '';
  lastError: string = '';

  constructor(client: FdRuntimeClient = new FdRuntimeClient()) {
    this.client = client;
    this.threads = sampleThreadShells();
    this.skills = sampleSkills();
  }

  async login(username: string, password: string): Promise<void> {
    this.loading = true;
    this.lastError = '';
    try {
      const session = await this.client.login(username, password);
      this.signedIn = true;
      this.accountName = session.userName;
      await this.refreshWorkspace();
    } catch (error) {
      this.lastError = error instanceof FdRuntimeError ? error.message : '登录失败，请检查网络';
      throw error;
    } finally {
      this.loading = false;
    }
  }

  logout(): void {
    this.client.logout();
    this.signedIn = false;
    this.accountName = '';
    this.threads = sampleThreadShells();
    this.skills = sampleSkills();
    this.models = ['deepseek-flash'];
    this.activeThread = sampleThread();
    this.queuedTurns = [];
    this.selectedSkillVersionId = 0;
    this.lastError = '';
  }

  async refreshWorkspace(): Promise<void> {
    this.lastError = '';
    let skillsLoaded = false;
    try {
      const skills = await this.client.getSkills();
      if (skills.length > 0) this.skills = skills;
      this.models = this.client.supportedModels;
      skillsLoaded = true;
    } catch (error) {
      this.lastError = error instanceof FdRuntimeError ? error.message : 'Skill 目录暂不可用';
    }
    try {
      const threads = await this.client.listThreads();
      if (threads.length > 0) {
        this.threads = threads;
        await this.openThread(threads[0].id);
      }
    } catch (error) {
      // The native shell remains usable while the mobile API is being rolled out.
      // A thread 404 must not discard a successfully loaded Skill/model catalog.
      if (!skillsLoaded || this.lastError.length === 0) {
        this.lastError = error instanceof FdRuntimeError ? error.message : '任务列表暂不可用';
      }
    }
  }

  async openThread(threadId: string): Promise<void> {
    const local = this.threads.find((thread: FdThreadShell) => thread.id === threadId);
    if (local === undefined) return;
    try {
      this.activeThread = await this.client.getThread(threadId);
    } catch (_error) {
      try {
        const history = await this.client.getLegacyHistory(threadId);
        if (history.length > 0) {
          const last = history[history.length - 1];
          this.activeThread.messages = history;
          if (last !== undefined) this.activeThread.latestMessage = last.text;
          this.activeThread.updatedAt = isoNow();
        }
      } catch (_historyError) {
        // The mobile history endpoint is optional during the compatibility rollout.
      }
    }
    this.selectedModel = this.activeThread.model;
    this.selectedSkillVersionId = this.activeThread.skillVersionId ?? 0;
  }

  async createThread(): Promise<void> {
    if (!this.client.isAuthenticated) {
      this.activeThread = sampleThread();
      this.threads = [this.activeThread, ...this.threads.filter((thread: FdThreadShell) => thread.id !== this.activeThread.id)];
      this.selectedModel = this.activeThread.model;
      this.selectedSkillVersionId = 0;
      this.queuedTurns = [];
      return;
    }
    const detail = await this.client.createThread(this.selectedModel);
    this.activeThread = detail;
    const shell: FdThreadShell = {
      id: detail.id,
      title: detail.title,
      model: detail.model,
      skillVersionId: detail.skillVersionId,
      state: detail.state,
      latestMessage: detail.latestMessage,
      updatedAt: detail.updatedAt,
      hasPendingApprovals: detail.hasPendingApprovals
    };
    this.threads = [shell, ...this.threads.filter((thread: FdThreadShell) => thread.id !== shell.id)];
    this.selectedModel = detail.model;
    this.selectedSkillVersionId = detail.skillVersionId ?? 0;
    this.queuedTurns = [];
    this.activeTurnId = '';
  }

  selectSkill(versionId: number): void {
    this.selectedSkillVersionId = this.selectedSkillVersionId === versionId ? 0 : versionId;
  }

  addAttachment(attachment: FdAttachment): void {
    const next = this.activeThread.attachments.filter(
      (item: FdAttachment) => item.attachmentId !== attachment.attachmentId
    );
    next.push(attachment);
    this.activeThread.attachments = next;
  }

  updateAttachment(attachmentId: string, update: FdAttachmentPatch): void {
    const index = this.activeThread.attachments.findIndex(
      (item: FdAttachment) => item.attachmentId === attachmentId
    );
    if (index < 0) return;
    const current = this.activeThread.attachments[index];
    if (current === undefined) return;
    this.activeThread.attachments[index] = { ...current, ...update };
  }

  removeAttachment(attachmentId: string): void {
    this.activeThread.attachments = this.activeThread.attachments.filter(
      (item: FdAttachment) => item.attachmentId !== attachmentId
    );
  }

  enqueueTurn(text: string): FdQueuedTurn {
    const turn: FdQueuedTurn = {
      id: createClientId('queued'),
      text,
      attachments: this.activeThread.attachments.slice(),
      skillVersionId: this.selectedSkillVersionId === 0 ? undefined : this.selectedSkillVersionId,
      model: this.selectedModel,
      createdAt: isoNow()
    };
    this.queuedTurns.push(turn);
    this.activeThread.state = 'queued';
    return turn;
  }

  editQueued(id: string, text: string): void {
    const target = this.queuedTurns.find((turn: FdQueuedTurn) => turn.id === id);
    if (target !== undefined) target.text = text;
  }

  removeQueued(id: string): void {
    this.queuedTurns = this.queuedTurns.filter((turn: FdQueuedTurn) => turn.id !== id);
    if (this.queuedTurns.length === 0 && this.activeThread.state === 'queued') this.activeThread.state = 'idle';
  }

  moveQueued(id: string, direction: number): void {
    const index = this.queuedTurns.findIndex((turn: FdQueuedTurn) => turn.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= this.queuedTurns.length) return;
    const current = this.queuedTurns[index];
    const next = this.queuedTurns[target];
    if (current === undefined || next === undefined) return;
    this.queuedTurns[index] = next;
    this.queuedTurns[target] = current;
  }

  async startTurn(turn: FdQueuedTurn): Promise<string> {
    const userMessage: FdMessage = {
      id: createClientId('message'),
      role: 'user',
      text: turn.text,
      createdAt: isoNow(),
      updatedAt: isoNow(),
      streaming: false,
      attachments: turn.attachments.slice()
    };
    this.activeThread.messages.push(userMessage);
    this.activeThread.latestMessage = turn.text;
    this.activeThread.state = 'working';
    this.activeThread.updatedAt = isoNow();
    if (!this.client.isAuthenticated) {
      const assistant: FdMessage = {
        id: createClientId('message'),
        role: 'assistant',
        text: `已收到：${turn.text}\n\n这是离线演示响应。登录并连接移动 FD Runtime 后会切换为真实流式输出。`,
        createdAt: isoNow(),
        updatedAt: isoNow(),
        streaming: false,
        attachments: []
      };
      this.activeThread.messages.push(assistant);
      this.activeThread.latestMessage = assistant.text;
      this.activeThread.state = 'idle';
      return '';
    }
    const receipt = await this.client.startTurn(
      this.activeThread.id,
      turn.text,
      turn.attachments,
      turn.model,
      turn.skillVersionId
    );
    this.activeTurnId = receipt.turnId;
    for (const event of receipt.events) this.applyEvent(event);
    return receipt.streamUrl;
  }

  applyEvent(event: FdStreamEvent): void {
    if (event.sequence <= this.activeThread.sequence) return;
    this.activeThread.sequence = event.sequence;
    switch (event.type) {
      case 'thread.snapshot':
        this.activeThread = event.detail;
        if (event.resumeToken !== undefined) this.activeThread.resumeToken = event.resumeToken;
        break;
      case 'turn.started':
        this.activeThread.state = 'working';
        this.activeThread.activities.push({
          id: createClientId('activity'), kind: 'turn.started', summary: `模型 ${event.model} 已开始处理`, tone: 'info', createdAt: isoNow()
        });
        break;
      case 'skill.authorized':
        this.activeThread.skillVersionId = event.skillVersionId;
        break;
      case 'assistant.delta': {
        let message = this.activeThread.messages.find((item: FdMessage) => item.id === event.messageId);
        if (message === undefined) {
          message = { id: event.messageId, role: 'assistant', text: '', createdAt: isoNow(), updatedAt: isoNow(), streaming: true, attachments: [] };
          this.activeThread.messages.push(message);
        }
        message.text += event.delta;
        message.updatedAt = isoNow();
        message.streaming = true;
        this.activeThread.latestMessage = message.text;
        break;
      }
      case 'turn.completed': {
        const message = this.activeThread.messages.find((item: FdMessage) => item.id === event.messageId);
        if (message === undefined) {
          this.activeThread.messages.push({ id: event.messageId, role: 'assistant', text: event.text, createdAt: isoNow(), updatedAt: isoNow(), streaming: false, attachments: [] });
        } else {
          message.text = event.text;
          message.streaming = false;
          message.updatedAt = isoNow();
        }
        this.activeThread.latestMessage = event.text;
        this.activeThread.state = 'idle';
        this.activeTurnId = '';
        if (event.resumeToken !== undefined) this.activeThread.resumeToken = event.resumeToken;
        break;
      }
      case 'turn.failed':
        this.activeThread.state = 'error';
        this.lastError = event.message;
        this.activeTurnId = '';
        break;
      case 'turn.interrupted':
        this.activeThread.state = 'idle';
        this.activeTurnId = '';
        break;
      case 'attachment.processing': {
        const item = this.activeThread.attachments.find((attachment: FdAttachment) => attachment.attachmentId === event.attachmentId);
        if (item !== undefined) {
          item.state = 'processing';
          item.progress = event.progress;
        }
        break;
      }
      case 'attachment.ready': {
        const item = this.activeThread.attachments.find((attachment: FdAttachment) => attachment.attachmentId === event.attachmentId);
        if (item !== undefined) {
          item.state = 'ready';
          item.progress = 100;
          item.previewUrl = event.previewUrl;
        }
        break;
      }
      case 'attachment.failed': {
        const item = this.activeThread.attachments.find((attachment: FdAttachment) => attachment.attachmentId === event.attachmentId);
        if (item !== undefined) {
          item.state = 'failed';
          item.errorMessage = event.message;
        }
        break;
      }
      case 'tool.started':
      case 'tool.completed':
        this.activeThread.activities.push({
          id: createClientId('activity'), kind: event.type, summary: event.type === 'tool.started' ? event.label : `${event.tool} ${event.status}`, tone: 'tool', createdAt: isoNow()
        });
        break;
      case 'thread.synchronized':
        break;
    }
  }
}
