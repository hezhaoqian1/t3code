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
  /** True only after the authenticated thread shell and detail are remote-backed. */
  remoteWorkspaceReady: boolean = false;
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
      this.remoteWorkspaceReady = false;
      // Do not expose the offline demo catalog while an authenticated
      // account is loading its server-owned workspace.
      this.threads = [];
      this.skills = [];
      this.activeThread = sampleThread();
      this.queuedTurns = [];
      this.activeTurnId = '';
      await this.refreshWorkspace();
    } catch (error) {
      this.lastError = error instanceof FdRuntimeError ? error.message : '登录失败，请检查网络';
      throw error;
    } finally {
      this.loading = false;
    }
  }

  async restoreSession(): Promise<boolean> {
    const session = await this.client.restoreSession();
    if (session === undefined) return false;
    this.signedIn = true;
    this.accountName = session.userName;
    this.remoteWorkspaceReady = false;
    this.threads = [];
    this.skills = [];
    this.activeThread = sampleThread();
    this.queuedTurns = [];
    this.activeTurnId = '';
    await this.refreshWorkspace();
    return true;
  }

  async logout(): Promise<void> {
    await this.client.logout();
    this.signedIn = false;
    this.remoteWorkspaceReady = false;
    this.accountName = '';
    this.threads = sampleThreadShells();
    this.skills = sampleSkills();
    this.models = ['deepseek-flash'];
    this.activeThread = sampleThread();
    this.queuedTurns = [];
    this.activeTurnId = '';
    this.selectedSkillVersionId = 0;
    this.lastError = '';
  }

  async refreshWorkspace(): Promise<void> {
    this.lastError = '';
    this.remoteWorkspaceReady = false;
    let skillsLoaded = false;
    try {
      const skills = await this.client.getSkills();
      this.skills = skills;
      this.models = this.client.supportedModels;
      skillsLoaded = true;
    } catch (error) {
      this.skills = [];
      this.lastError = error instanceof FdRuntimeError ? error.message : 'Skill 目录暂不可用';
    }
    try {
      const threads = await this.client.listThreads();
      // An authenticated empty list is authoritative. Do not leave the
      // offline demo row visible or send a new turn to its local ID.
      this.threads = threads;
      if (threads.length > 0) {
        const first = threads[0];
        if (first === undefined || !(await this.openThread(first.id))) {
          throw new FdRuntimeError('thread_unavailable', '任务详情暂不可用，请稍后重试');
        }
        this.remoteWorkspaceReady = true;
      } else {
        await this.createThread();
      }
    } catch (error) {
      // The native shell remains usable while the mobile API is being rolled out.
      // A thread 404 must not discard a successfully loaded Skill/model catalog.
      this.remoteWorkspaceReady = false;
      if (this.threads.length === 0) {
        this.activeThread = sampleThread();
        this.queuedTurns = [];
        this.activeTurnId = '';
      }
      if (!skillsLoaded || this.lastError.length === 0) {
        this.lastError = error instanceof FdRuntimeError ? error.message : '任务列表暂不可用';
      }
    }
  }

  async openThread(threadId: string): Promise<boolean> {
    const local = this.threads.find((thread: FdThreadShell) => thread.id === threadId);
    if (local === undefined) return false;
    try {
      this.activeThread = await this.client.getThread(threadId);
    } catch (_error) {
      try {
        const history = await this.client.getLegacyHistory(threadId);
        if (history.length > 0) {
          // The legacy endpoint returns messages only. Rebuild the target
          // detail from its shell so a fallback never keeps the previous
          // thread id, model, or title as the send target.
          this.activeThread = {
            ...local,
            messages: history,
            activities: [],
            attachments: [],
            sequence: 0,
            hasMoreHistory: false
          } as FdThreadDetail;
          const last = history[history.length - 1];
          if (last !== undefined) this.activeThread.latestMessage = last.text;
          this.activeThread.updatedAt = isoNow();
        } else {
          return false;
        }
      } catch (_historyError) {
        // The mobile history endpoint is optional during the compatibility rollout.
        return false;
      }
    }
    this.selectedModel = this.activeThread.model;
    this.selectedSkillVersionId = this.activeThread.skillVersionId ?? 0;
    // Mobile thread snapshots intentionally omit Skill internals. Start a
    // recovered thread with the first server-authorized Skill so the first
    // send is usable; the user can still deselect it explicitly in the sheet.
    if (this.selectedSkillVersionId === 0 && this.skills.length > 0) {
      for (const skill of this.skills) {
        if (skill.modelCapabilities.length === 0 || skill.modelCapabilities.includes(this.selectedModel)) {
          this.selectedSkillVersionId = skill.versionId;
          break;
        }
      }
    }
    return true;
  }

  async loadOlderHistory(): Promise<boolean> {
    const cursor = this.activeThread.historyCursor;
    if (!this.client.isAuthenticated || !this.activeThread.hasMoreHistory || cursor === undefined || cursor.length === 0) {
      return false;
    }
    const page = await this.client.getThreadHistory(this.activeThread.id, cursor);
    const existing = new Set(this.activeThread.messages.map((message: FdMessage) => message.id));
    const older = page.messages.filter((message: FdMessage) => !existing.has(message.id));
    this.activeThread.messages = [...older, ...this.activeThread.messages];
    this.activeThread.hasMoreHistory = page.hasMoreHistory;
    this.activeThread.historyCursor = page.historyCursor;
    return older.length > 0;
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
    this.remoteWorkspaceReady = true;
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

  clearAttachments(): void {
    this.activeThread.attachments = [];
  }

  enqueueTurn(text: string): FdQueuedTurn {
    const turn: FdQueuedTurn = {
      id: createClientId('queued'),
      messageId: createClientId('message'),
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

  restoreQueuedTurn(turn: FdQueuedTurn): void {
    if (!this.queuedTurns.some((item: FdQueuedTurn) => item.id === turn.id)) {
      this.queuedTurns = [turn, ...this.queuedTurns];
    }
    this.activeThread.state = 'queued';
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

  async startTurn(turn: FdQueuedTurn, onEvent?: (event: FdStreamEvent) => void): Promise<string> {
    if (this.client.isAuthenticated && !this.remoteWorkspaceReady) {
      throw new FdRuntimeError('workspace_unavailable', '远端任务列表尚未就绪，请刷新后重试');
    }
    const userMessage: FdMessage = {
      id: turn.messageId,
      role: 'user',
      text: turn.text,
      createdAt: isoNow(),
      updatedAt: isoNow(),
      streaming: false,
      attachments: turn.attachments.slice()
    };
    const existing = this.activeThread.messages.find((message: FdMessage) => message.id === turn.messageId);
    if (existing === undefined) {
      this.activeThread.messages.push(userMessage);
    } else {
      existing.text = turn.text;
      existing.attachments = turn.attachments.slice();
      existing.updatedAt = userMessage.updatedAt;
    }
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
    let terminalEvent = false;
    const receipt = await this.client.startTurn(
      this.activeThread.id,
      turn.text,
      turn.attachments,
      turn.model,
      turn.skillVersionId,
      (event: FdStreamEvent): void => {
        if (event.type === 'turn.started') this.activeTurnId = event.turnId;
        this.applyEvent(event);
        if (event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'turn.interrupted') {
          terminalEvent = true;
        }
        if (onEvent !== undefined) onEvent(event);
      }
    );
    if (!terminalEvent) this.activeTurnId = receipt.turnId;
    if (receipt.events.length === 0) {
      throw new FdRuntimeError('empty_stream', 'FD Runtime 没有返回任务事件');
    }
    const failed = receipt.events.find((event: FdStreamEvent) => event.type === 'turn.failed');
    if (failed !== undefined && failed.type === 'turn.failed') {
      throw new FdRuntimeError('turn_failed', failed.message);
    }
    return receipt.streamUrl;
  }

  applyEvent(event: FdStreamEvent): void {
    if (event.sequence <= this.activeThread.sequence) return;
    this.activeThread.sequence = event.sequence;
    switch (event.type) {
      case 'thread.snapshot':
        this.activeThread = event.detail;
        this.remoteWorkspaceReady = this.client.isAuthenticated;
        if (event.resumeToken !== undefined) this.activeThread.resumeToken = event.resumeToken;
        this.selectedModel = this.activeThread.model;
        this.selectedSkillVersionId = this.activeThread.skillVersionId ?? 0;
        break;
      case 'thread.message-sent': {
        const existing = this.activeThread.messages.find((item: FdMessage) => item.id === event.message.id);
        if (existing === undefined) this.activeThread.messages.push(event.message);
        else {
          existing.text = event.message.text;
          existing.attachments = event.message.attachments;
          existing.updatedAt = event.message.updatedAt;
        }
        this.activeThread.latestMessage = event.message.text;
        break;
      }
      case 'turn.started':
        this.activeThread.state = 'working';
        this.activeThread.activities.push({
          id: createClientId('activity'), kind: 'turn.started', summary: `模型 ${event.model} 已开始处理`, tone: 'info', createdAt: isoNow()
        });
        break;
      case 'turn.progress':
        this.activeThread.state = 'working';
        this.activeThread.activities.push({
          id: createClientId('activity'), kind: event.phase, summary: event.message, tone: 'info', createdAt: isoNow()
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
        // Older gateways put the durable message id only inside the completed
        // payload, while their delta events have no message_id. Reconcile the
        // terminal event with the current streaming assistant before creating
        // a second message.
        const message = this.activeThread.messages.find((item: FdMessage) => item.id === event.messageId) ??
          [...this.activeThread.messages].reverse().find((item: FdMessage) => item.role === 'assistant' && item.streaming);
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
        const item = this.findAttachment(event.attachmentId);
        if (item !== undefined) {
          item.state = 'processing';
          item.progress = event.progress;
        }
        break;
      }
      case 'attachment.ready': {
        const item = this.findAttachment(event.attachmentId);
        if (item !== undefined) {
          item.state = 'ready';
          item.progress = 100;
          item.previewUrl = event.previewUrl;
        }
        break;
      }
      case 'attachment.failed': {
        const item = this.findAttachment(event.attachmentId);
        if (item !== undefined) {
          item.state = 'failed';
          item.errorMessage = event.message;
        }
        break;
      }
      case 'assistant.reasoning':
        // Reasoning is a volatile stream overlay. It is intentionally not
        // copied into the durable activity list or message history.
        break;
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

  private findAttachment(attachmentId: string): FdAttachment | undefined {
    const pending = this.activeThread.attachments.find(
      (attachment: FdAttachment) => attachment.attachmentId === attachmentId
    );
    if (pending !== undefined) return pending;
    for (const message of this.activeThread.messages) {
      const attached = message.attachments.find(
        (attachment: FdAttachment) => attachment.attachmentId === attachmentId
      );
      if (attached !== undefined) return attached;
    }
    return undefined;
  }
}
