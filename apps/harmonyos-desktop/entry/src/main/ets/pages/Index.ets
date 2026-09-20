import { picker } from '@kit.CoreFileKit';
import { promptAction } from '@kit.ArkUI';
import { webview } from '@kit.ArkWeb';

import { FD_DEFAULT_MODEL, FD_RUNTIME_ORIGIN } from '../config/HarmonyConfig';
import {
  FdAttachment,
  FdActivity,
  FdMessage,
  FdQueuedTurn,
  FdSkill,
  FdStreamEvent,
  FdThreadShell,
  createClientId
} from '../data/FdModels';
import { FdRuntimeClient, FdRuntimeError, FdStreamHandle } from '../network/FdRuntimeClient';
import { uploadPickedAttachment } from '../network/AttachmentTransfer';
import { createHarmonySessionStorage } from '../runtime/HarmonySessionStorage';
import { FdStore } from '../state/FdStore';

@Entry
@Component
struct Index {
  private readonly store: FdStore = new FdStore(
    new FdRuntimeClient(FD_RUNTIME_ORIGIN, createHarmonySessionStorage())
  );
  private stream: FdStreamHandle | undefined;
  private previewController: webview.WebviewController = new webview.WebviewController();
  private pendingImmediateTurnId: string = '';

  @State private signedIn: boolean = false;
  @State private accountName: string = '';
  @State private username: string = '';
  @State private password: string = '';
  @State private loginBusy: boolean = false;
  @State private loginError: string = '';
  @State private threads: Array<FdThreadShell> = [];
  @State private messages: Array<FdMessage> = [];
  @State private activities: Array<FdActivity> = [];
  @State private attachments: Array<FdAttachment> = [];
  @State private skills: Array<FdSkill> = [];
  @State private models: Array<string> = [FD_DEFAULT_MODEL];
  @State private queuedTurns: Array<FdQueuedTurn> = [];
  @State private activeThreadId: string = '';
  @State private activeThreadTitle: string = '';
  @State private selectedSkillVersionId: number = 0;
  @State private selectedModel: string = FD_DEFAULT_MODEL;
  @State private draft: string = '';
  @State private statusText: string = '未连接 FD Runtime';
  @State private errorText: string = '';
  @State private showSkills: boolean = false;
  @State private showQueue: boolean = false;
  @State private showPreview: boolean = false;
  @State private previewUrl: string = '';
  @State private previewName: string = '';
  @State private previewMimeType: string = '';
  @State private historyBusy: boolean = false;

  aboutToAppear(): void {
    this.syncFromStore();
    void this.restoreSession();
  }

  private async restoreSession(): Promise<void> {
    try {
      const restored = await this.store.restoreSession();
      if (restored) {
        this.syncFromStore();
        if (this.store.activeThread.state === 'working') this.connectStream();
      }
    } catch (error) {
      this.errorText = error instanceof FdRuntimeError ? error.message : '会话恢复失败，请重新登录';
      this.syncFromStore();
    }
  }

  private syncFromStore(): void {
    this.signedIn = this.store.signedIn;
    this.accountName = this.store.accountName;
    this.threads = this.store.threads.slice();
    this.messages = this.store.activeThread.messages.slice();
    this.activities = this.store.activeThread.activities.slice(-12);
    this.attachments = this.store.activeThread.attachments.slice();
    this.skills = this.store.skills.slice();
    this.models = this.store.models.slice();
    this.queuedTurns = this.store.queuedTurns.slice();
    this.activeThreadId = this.store.activeThread.id;
    this.activeThreadTitle = this.store.activeThread.title;
    this.selectedSkillVersionId = this.store.selectedSkillVersionId;
    this.selectedModel = this.store.selectedModel;
    if (this.store.lastError.length > 0) this.errorText = this.store.lastError;
    const latestActivity = this.activities[this.activities.length - 1];
    if ((this.store.activeThread.state === 'working' || this.store.activeTurnId.length > 0) && latestActivity !== undefined && latestActivity.summary.length > 0) {
      this.statusText = latestActivity.summary;
    } else if (this.store.activeThread.state === 'working' || this.store.activeTurnId.length > 0) {
      this.statusText = '正在处理';
    }
    else if (this.store.activeThread.state === 'queued') this.statusText = `排队中 (${this.queuedTurns.length})`;
    else if (this.signedIn && !this.store.remoteWorkspaceReady) this.statusText = '任务列表暂不可用，请刷新';
    else this.statusText = this.signedIn ? '已连接 FD Runtime' : '离线演示模式';
  }

  private async login(): Promise<void> {
    if (this.username.trim().length === 0 || this.password.length === 0) {
      this.loginError = '请输入管理员账号和密码';
      return;
    }
    this.loginBusy = true;
    this.loginError = '';
    try {
      await this.store.login(this.username.trim(), this.password);
      this.loginError = '';
      this.password = '';
      this.syncFromStore();
      if (this.store.activeThread.state === 'working') this.connectStream();
      promptAction.showToast({ message: '已连接 FD Runtime' });
    } catch (error) {
      this.loginError = error instanceof FdRuntimeError ? error.message : '登录失败';
    } finally {
      this.loginBusy = false;
    }
  }

  private async logout(): Promise<void> {
    this.stream?.close();
    this.stream = undefined;
    this.pendingImmediateTurnId = '';
    await this.store.logout();
    this.syncFromStore();
  }

  private async openThread(threadId: string): Promise<void> {
    await this.store.openThread(threadId);
    this.syncFromStore();
    if (this.store.activeThread.state === 'working') this.connectStream();
  }

  private async loadOlderHistory(): Promise<void> {
    if (this.historyBusy || !this.store.activeThread.hasMoreHistory) return;
    this.historyBusy = true;
    this.errorText = '';
    try {
      await this.store.loadOlderHistory();
      this.syncFromStore();
    } catch (error) {
      this.errorText = error instanceof FdRuntimeError ? error.message : '更早历史加载失败';
      this.syncFromStore();
    } finally {
      this.historyBusy = false;
    }
  }

  private connectStream(): void {
    if (!this.store.client.isAuthenticated || !this.store.remoteWorkspaceReady || this.store.activeThread.id === 'local-demo-thread') return;
    this.stream?.close();
    this.stream = this.store.client.connectThreadStream(
      this.store.activeThread.id,
      this.store.activeThread.sequence,
      this.store.activeThread.resumeToken ?? '',
      (event: FdStreamEvent) => this.handleStreamEvent(event),
      (message: string) => {
        if (this.store.activeThread.state === 'working') {
          this.statusText = message;
          this.errorText = message;
        }
      }
    );
  }

  private handleStreamEvent(event: FdStreamEvent): void {
    this.store.applyEvent(event);
    this.syncFromStore();
    if (event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'turn.interrupted') {
      const immediateId = this.pendingImmediateTurnId;
      this.pendingImmediateTurnId = '';
      if (immediateId.length > 0) {
        const immediate = this.store.queuedTurns.find((turn: FdQueuedTurn) => turn.id === immediateId);
        if (immediate !== undefined) {
          this.startQueuedTurn(immediate);
          return;
        }
      }
      this.startNextQueuedTurn();
    }
  }

  private async sendDraft(): Promise<void> {
    const text = this.draft.trim();
    if (text.length === 0 && this.attachments.length === 0) return;
    if (this.store.client.isAuthenticated && !this.store.remoteWorkspaceReady) {
      this.errorText = '任务列表暂不可用，请先刷新后再发送';
      this.syncFromStore();
      return;
    }
    if (this.store.client.isAuthenticated && this.store.selectedSkillVersionId === 0) {
      this.errorText = '请选择一个 FD Skill 后再发送；取消选择后可继续编辑任务，但当前移动 Agent 不会绕过 Skill 权限。';
      this.syncFromStore();
      return;
    }
    if (this.attachments.some((item: FdAttachment) => item.state !== 'ready')) {
      this.errorText = '附件仍在上传或解析，请等待状态变为可用后再发送';
      this.syncFromStore();
      return;
    }
    const wasWorking = this.store.activeThread.state === 'working' || this.store.activeTurnId.length > 0;
    const queued = this.store.enqueueTurn(text.length === 0 ? '请分析附件。' : text);
    this.store.clearAttachments();
    this.draft = '';
    this.syncFromStore();
    if (!wasWorking) await this.startQueuedTurn(queued);
  }

  private async startQueuedTurn(turn: FdQueuedTurn): Promise<void> {
    this.store.removeQueued(turn.id);
    try {
      const streamUrl = await this.store.startTurn(turn, (_event: FdStreamEvent): void => {
        this.syncFromStore();
      });
      this.syncFromStore();
      if (streamUrl.length > 0) this.connectStream();
      else {
        const immediateId = this.pendingImmediateTurnId;
        this.pendingImmediateTurnId = '';
        if (immediateId.length > 0) {
          const immediate = this.store.queuedTurns.find((queued: FdQueuedTurn) => queued.id === immediateId);
          if (immediate !== undefined) {
            await this.startQueuedTurn(immediate);
            return;
          }
        }
        await this.startNextQueuedTurn();
      }
    } catch (error) {
      this.errorText = error instanceof FdRuntimeError ? error.message : '任务发送失败';
      this.store.restoreQueuedTurn(turn);
      this.syncFromStore();
    }
  }

  private async startNextQueuedTurn(): Promise<void> {
    if (!this.store.remoteWorkspaceReady && this.store.client.isAuthenticated) return;
    if (this.store.activeThread.state === 'working' || this.store.activeTurnId.length > 0) return;
    const next = this.store.queuedTurns[0];
    if (next === undefined) {
      this.syncFromStore();
      return;
    }
    await this.startQueuedTurn(next);
  }

  private async interruptCurrentTurn(): Promise<boolean> {
    if (this.store.activeTurnId.length === 0 || !this.store.client.isAuthenticated) {
      this.errorText = '当前任务只能在连接 FD Runtime 后中断';
      this.syncFromStore();
      return false;
    }
    try {
      const interrupted = await this.store.client.interruptTurn(this.store.activeThread.id, this.store.activeTurnId);
      if (!interrupted) {
        this.errorText = '当前任务已经结束，请重新发送排队消息';
        this.syncFromStore();
        return false;
      }
      this.statusText = '正在停止当前任务...';
      this.syncFromStore();
      return true;
    } catch (error) {
      this.errorText = error instanceof FdRuntimeError ? error.message : '中断失败';
      this.syncFromStore();
      return false;
    }
  }

  private async sendQueuedImmediately(turn: FdQueuedTurn): Promise<void> {
    if (this.store.activeThread.state !== 'working' && this.store.activeTurnId.length === 0) {
      await this.startQueuedTurn(turn);
      return;
    }
    this.pendingImmediateTurnId = turn.id;
    this.errorText = '正在停止当前任务，完成后立即发送所选消息';
    if (!(await this.interruptCurrentTurn())) this.pendingImmediateTurnId = '';
  }

  private editQueued(turn: FdQueuedTurn, value: string): void {
    this.store.editQueued(turn.id, value);
    this.syncFromStore();
  }

  private removeQueued(turn: FdQueuedTurn): void {
    this.store.removeQueued(turn.id);
    this.syncFromStore();
  }

  private moveQueued(turn: FdQueuedTurn, direction: number): void {
    this.store.moveQueued(turn.id, direction);
    this.syncFromStore();
  }

  private selectSkill(skill: FdSkill): void {
    this.store.selectSkill(skill.versionId);
    this.syncFromStore();
  }

  private async selectFiles(): Promise<void> {
    if (this.store.client.isAuthenticated && !this.store.remoteWorkspaceReady) {
      this.errorText = '任务列表暂不可用，请先刷新后再添加附件';
      this.syncFromStore();
      return;
    }
    const options = new picker.DocumentSelectOptions();
    options.maxSelectNumber = 8;
    const documentPicker = new picker.DocumentViewPicker();
    try {
      const uris = await documentPicker.select(options);
      for (const uri of uris) {
        const name = decodeURIComponent(uri.split('/').pop() ?? '附件');
        const attachment: FdAttachment = {
          attachmentId: createClientId('local-attachment'),
          name,
          mimeType: this.mimeTypeForName(name),
          sizeBytes: 0,
          state: 'selected',
          progress: 0,
          sourceUri: uri
        };
        this.store.addAttachment(attachment);
        this.syncFromStore();
        if (this.store.client.isAuthenticated) {
          await this.uploadAttachment(attachment);
        }
      }
      this.syncFromStore();
    } catch (error) {
      if (error instanceof FdRuntimeError) {
        this.errorText = error.message;
        this.syncFromStore();
      } else {
        promptAction.showToast({ message: '未选择文件' });
      }
    }
  }

  private async uploadAttachment(attachment: FdAttachment): Promise<void> {
    this.store.updateAttachment(attachment.attachmentId, { state: 'uploading', progress: 0 });
    this.syncFromStore();
    try {
      const uploaded = await uploadPickedAttachment(
        this.store.client,
        this.store.activeThread.id,
        attachment,
        (progress) => {
          this.store.updateAttachment(attachment.attachmentId, progress);
          this.syncFromStore();
        }
      );
      this.store.removeAttachment(attachment.attachmentId);
      this.store.addAttachment(uploaded);
      this.syncFromStore();
    } catch (error) {
      const message = error instanceof FdRuntimeError ? error.message : '附件上传失败';
      this.store.updateAttachment(attachment.attachmentId, { state: 'failed', errorMessage: message });
      this.errorText = message;
      this.syncFromStore();
    }
  }

  private mimeTypeForName(name: string): string {
    const lower = name.toLowerCase();
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    return 'text/plain';
  }

  private async previewAttachment(item: FdAttachment): Promise<void> {
    if (this.store.client.isAuthenticated && !this.store.remoteWorkspaceReady) {
      this.errorText = '任务列表暂不可用，请先刷新后再预览附件';
      this.syncFromStore();
      return;
    }
    if (item.previewUrl === undefined && this.store.client.isAuthenticated && item.attachmentId.length > 0) {
      try {
        item.previewUrl = await this.store.client.getPreviewUrl(item.attachmentId);
      } catch (error) {
        this.errorText = error instanceof FdRuntimeError ? error.message : '文件预览地址获取失败';
      }
    }
    if (item.previewUrl === undefined || item.previewUrl.length === 0) {
      this.errorText = '附件尚未完成服务端解析，暂时不能预览';
      return;
    }
    this.previewName = item.name;
    this.previewMimeType = item.mimeType;
    this.previewUrl = item.previewUrl;
    this.showPreview = true;
  }

  build() {
    Stack() {
      if (!this.signedIn) {
        this.buildLogin();
      } else {
        this.buildWorkspace();
      }
      if (this.showSkills) this.buildSkillSheet();
      if (this.showQueue) this.buildQueueSheet();
      if (this.showPreview) this.buildPreviewSheet();
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F5F7FA');
  }

  @Builder
  private buildLogin() {
    Column({ space: 18 }) {
      Text('方德 AI')
        .fontSize(32)
        .fontWeight(FontWeight.Bold)
        .fontColor('#123B4A');
      Text('鸿蒙原生客户端')
        .fontSize(18)
        .fontColor('#52717B');
      Text(`FD Runtime: ${FD_RUNTIME_ORIGIN}`)
        .fontSize(12)
        .fontColor('#80939A');
      TextInput({ placeholder: '管理员账号', text: this.username })
        .width(360)
        .height(48)
        .onChange((value: string) => this.username = value);
      TextInput({ placeholder: '管理员密码', text: this.password })
        .width(360)
        .height(48)
        .type(InputType.Password)
        .onChange((value: string) => this.password = value)
        .onSubmit(() => this.login());
      if (this.loginError.length > 0) Text(this.loginError).fontSize(13).fontColor('#C2414A');
      Button(this.loginBusy ? '连接中...' : '登录并连接 FD Runtime')
        .width(360)
        .height(48)
        .enabled(!this.loginBusy)
        .backgroundColor('#176B87')
        .fontColor(Color.White)
        .onClick(() => this.login());
      Text('登录后会加载任务、Skill、历史和服务端附件状态。密码不会写入本地缓存。')
        .width(360)
        .fontSize(12)
        .fontColor('#80939A');
    }
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
    .width('100%')
    .height('100%')
    .backgroundColor('#FFFFFF');
  }

  @Builder
  private buildWorkspace() {
    Row() {
      this.buildSidebar();
      this.buildThread();
    }
    .width('100%')
    .height('100%');
  }

  @Builder
  private buildSidebar() {
    Column() {
      Row() {
        Text('方德 AI').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#123B4A').layoutWeight(1);
        Text('退出').fontSize(13).fontColor('#52717B').onClick(() => { void this.logout(); });
      }
      .width('100%')
      .padding({ left: 18, right: 18, top: 18, bottom: 18 });
      Row() {
        Text(this.accountName).fontSize(13).fontColor('#52717B').layoutWeight(1);
        Text('刷新').fontSize(13).fontColor('#176B87').onClick(async () => { await this.store.refreshWorkspace(); this.syncFromStore(); });
      }
      .width('100%')
      .padding({ left: 18, right: 18, bottom: 16 });
      Button('新建任务')
        .width('calc(100% - 36vp)')
        .height(38)
        .margin({ left: 18, right: 18, bottom: 14 })
        .backgroundColor('#176B87')
        .fontColor(Color.White)
        .onClick(async () => {
          try {
            await this.store.createThread();
            this.syncFromStore();
          } catch (error) {
            this.errorText = error instanceof FdRuntimeError ? error.message : '新建任务失败';
            this.syncFromStore();
          }
        });
      Divider().color('#DFE7EA');
      Text('任务').fontSize(13).fontColor('#80939A').margin({ left: 18, top: 18, bottom: 8 });
      Scroll() {
        Column() {
          ForEach(this.threads, (thread: FdThreadShell) => {
            Row() {
              Column() {
                Text(thread.title).fontSize(14).fontColor(thread.id === this.activeThreadId ? '#123B4A' : '#355761').maxLines(1);
                Text(thread.latestMessage.length > 0 ? thread.latestMessage : thread.model).fontSize(11).fontColor('#80939A').maxLines(1).margin({ top: 4 });
              }.layoutWeight(1).alignItems(HorizontalAlign.Start);
              if (thread.state === 'working') LoadingProgress().width(16).height(16);
            }
            .padding({ left: 18, right: 14, top: 12, bottom: 12 })
            .backgroundColor(thread.id === this.activeThreadId ? '#E6F1F4' : '#FFFFFF')
            .borderRadius(8)
            .margin({ left: 10, right: 10, bottom: 6 })
            .onClick(() => this.openThread(thread.id));
          }, (thread: FdThreadShell) => thread.id);
        }
      }.layoutWeight(1).width('100%');
      Text('模型').fontSize(13).fontColor('#80939A').margin({ left: 18, bottom: 6 });
      Select(this.models.map((model: string) => ({ value: model })))
        .selected(this.models.indexOf(this.selectedModel))
        .value(this.selectedModel)
        .onSelect((index: number) => {
          const selected = this.models[index];
          if (selected !== undefined) this.store.selectedModel = selected;
          this.syncFromStore();
        });
      Text(this.statusText).fontSize(12).fontColor(this.errorText.length > 0 ? '#C2414A' : '#80939A').margin({ left: 18, right: 18, top: 14, bottom: 16 });
    }
    .width(280)
    .height('100%')
    .backgroundColor('#FFFFFF')
    .border({ width: { right: 1 }, color: '#DFE7EA' });
  }

  @Builder
  private buildThread() {
    Column() {
      Row() {
        Column() {
          Text(this.activeThreadTitle).fontSize(20).fontWeight(FontWeight.Medium).fontColor('#123B4A');
          Text(this.selectedSkillVersionId === 0 ? '未选择 FD Skill' : `Skill 版本 ${this.selectedSkillVersionId}`)
            .fontSize(12).fontColor('#80939A').margin({ top: 4 });
        }.alignItems(HorizontalAlign.Start).layoutWeight(1);
        Button('Skill').height(34).fontSize(13).onClick(() => this.showSkills = true);
        Button(this.store.activeThread.state === 'working' ? '停止' : '队列')
          .height(34).fontSize(13)
          .onClick(() => this.store.activeThread.state === 'working' ? this.interruptCurrentTurn() : this.showQueue = true);
      }
      .width('100%')
      .padding({ left: 24, right: 24, top: 18, bottom: 14 })
      .backgroundColor('#FFFFFF');
      Divider().color('#DFE7EA');
      Scroll() {
        Column() {
          if (this.activities.length > 0) {
            Column() {
              Text('运行进度').fontSize(12).fontColor('#80939A').margin({ bottom: 4 });
              ForEach(this.activities, (activity: FdActivity) => {
                Row() {
                  LoadingProgress()
                    .width(12)
                    .height(12)
                    .visibility(activity.kind === 'turn.started' || activity.kind === 'understanding' || activity.kind === 'answering' ? Visibility.Visible : Visibility.None)
                  Text(activity.summary)
                    .fontSize(12)
                    .fontColor(activity.tone === 'error' ? '#C2414A' : '#52717B')
                    .margin({ left: 6 })
                    .maxLines(2);
                }
                .width('100%')
                .padding({ top: 3, bottom: 3 });
              }, (activity: FdActivity) => activity.id);
            }
            .width('calc(100% - 48vp)')
            .padding(12)
            .margin({ left: 24, right: 24, top: 10, bottom: 4 })
            .backgroundColor('#F5F7FA')
            .borderRadius(8)
          }
          if (this.store.activeThread.hasMoreHistory) {
            Text(this.historyBusy ? '正在加载更早历史...' : '加载更早历史')
              .fontSize(12)
              .fontColor('#176B87')
              .padding({ top: 10, bottom: 10 })
              .onClick(() => this.loadOlderHistory());
          }
          ForEach(this.messages, (message: FdMessage) => {
            Row() {
              Column() {
                Text(message.role === 'user' ? '你' : '方德 AI').fontSize(12).fontColor('#80939A');
                Text(message.text).fontSize(15).fontColor('#20333A').margin({ top: 6 });
                if (message.attachments.length > 0) {
                  ForEach(message.attachments, (item: FdAttachment) => {
                    Text(`附件: ${item.name}`).fontSize(12).fontColor('#176B87').margin({ top: 6 }).onClick(() => this.previewAttachment(item));
                  }, (item: FdAttachment) => item.attachmentId);
                }
              }
              .alignItems(HorizontalAlign.Start)
              .padding(14)
              .backgroundColor(message.role === 'user' ? '#E6F1F4' : '#FFFFFF')
              .borderRadius(10)
              .layoutWeight(1);
            }
            .width('100%')
            .justifyContent(message.role === 'user' ? FlexAlign.End : FlexAlign.Start)
            .padding({ left: 24, right: 24, top: 8, bottom: 8 });
          }, (message: FdMessage) => message.id);
          ForEach(this.attachments, (item: FdAttachment) => {
            Row() {
              Text(item.name).fontSize(12).fontColor('#355761').layoutWeight(1).maxLines(1);
              Text(item.state === 'ready' ? '预览' : item.state === 'failed' ? '重试' : item.state === 'selected' ? '待上传' : `${item.state} ${item.progress}%`)
                .fontSize(12).fontColor('#176B87').onClick(() => {
                  if (item.state === 'ready') this.previewAttachment(item);
                  else if (item.state === 'failed') this.uploadAttachment(item);
                });
              Text('删除').fontSize(12).fontColor('#C2414A').margin({ left: 10 }).onClick(() => { this.store.removeAttachment(item.attachmentId); this.syncFromStore(); });
            }.padding({ left: 24, right: 24, top: 5, bottom: 5 });
          }, (item: FdAttachment) => item.attachmentId);
        }
      }.layoutWeight(1).width('100%');
      if (this.errorText.length > 0) Text(this.errorText).fontSize(12).fontColor('#C2414A').margin({ left: 24, right: 24, bottom: 6 });
      Row() {
        Button('附件').height(42).fontSize(13).onClick(() => this.selectFiles());
        TextInput({ placeholder: '输入任务，回车发送', text: this.draft })
          .layoutWeight(1)
          .height(42)
          .margin({ left: 8, right: 8 })
          .onChange((value: string) => this.draft = value)
          .onSubmit(() => this.sendDraft());
        Button('发送').height(42).fontSize(13).backgroundColor('#176B87').fontColor(Color.White).onClick(() => this.sendDraft());
      }
      .padding({ left: 20, right: 20, top: 12, bottom: 18 })
      .backgroundColor('#FFFFFF');
    }
    .layoutWeight(1)
    .height('100%');
  }

  @Builder
  private buildSkillSheet() {
    Column() {
      Row() {
        Text('选择 FD Skill').fontSize(18).fontWeight(FontWeight.Medium).layoutWeight(1);
        Text('关闭').fontSize(13).fontColor('#176B87').onClick(() => this.showSkills = false);
      }.width('100%').padding(18);
      Text('再次点击已选 Skill 可取消选择。').fontSize(12).fontColor('#80939A').margin({ left: 18, bottom: 12 });
      ForEach(this.skills, (skill: FdSkill) => {
        Column() {
          Row() {
            Text(skill.displayName).fontSize(15).fontColor('#20333A').layoutWeight(1);
            Text(this.selectedSkillVersionId === skill.versionId ? '已选' : '选择').fontSize(13).fontColor('#176B87');
          }
          Text(skill.description).fontSize(12).fontColor('#80939A').margin({ top: 5 });
          Text(`风险: ${skill.riskTier}  |  版本: ${skill.versionId}`).fontSize(11).fontColor('#80939A').margin({ top: 4 });
        }
        .alignItems(HorizontalAlign.Start)
        .padding(14)
        .margin({ left: 18, right: 18, bottom: 8 })
        .backgroundColor(this.selectedSkillVersionId === skill.versionId ? '#E6F1F4' : '#F5F7FA')
        .borderRadius(8)
        .onClick(() => this.selectSkill(skill));
      }, (skill: FdSkill) => String(skill.versionId));
    }
    .width('100%')
    .height('62%')
    .backgroundColor('#FFFFFF')
    .borderRadius({ topLeft: 16, topRight: 16 })
    .alignItems(HorizontalAlign.Start)
    .position({ x: 0, y: '38%' });
  }

  @Builder
  private buildQueueSheet() {
    Column() {
      Row() {
        Text('排队消息').fontSize(18).fontWeight(FontWeight.Medium).layoutWeight(1);
        Text('关闭').fontSize(13).fontColor('#176B87').onClick(() => this.showQueue = false);
      }.width('100%').padding(18);
      if (this.queuedTurns.length === 0) {
        Text('当前没有排队消息。发送中的任务不会被新消息打断。').fontSize(13).fontColor('#80939A').margin(18);
      }
      ForEach(this.queuedTurns, (turn: FdQueuedTurn) => {
        Row() {
          TextInput({ text: turn.text }).layoutWeight(1).height(40).onChange((value: string) => this.editQueued(turn, value));
          Text('上移').fontSize(12).fontColor('#176B87').margin({ left: 8 }).onClick(() => this.moveQueued(turn, -1));
          Text('下移').fontSize(12).fontColor('#176B87').margin({ left: 8 }).onClick(() => this.moveQueued(turn, 1));
          Text('删除').fontSize(12).fontColor('#C2414A').margin({ left: 8 }).onClick(() => this.removeQueued(turn));
          Text('立即').fontSize(12).fontColor('#176B87').margin({ left: 8 }).onClick(() => this.sendQueuedImmediately(turn));
        }
        .padding({ left: 18, right: 18, bottom: 8 });
      }, (turn: FdQueuedTurn) => turn.id);
    }
    .width('100%')
    .height('46%')
    .backgroundColor('#FFFFFF')
    .borderRadius({ topLeft: 16, topRight: 16 })
    .position({ x: 0, y: '54%' });
  }

  @Builder
  private buildPreviewSheet() {
    Column() {
      Row() {
        Text(this.previewName).fontSize(17).fontWeight(FontWeight.Medium).layoutWeight(1).maxLines(1);
        Text('关闭').fontSize(13).fontColor('#176B87').onClick(() => this.showPreview = false);
      }.width('100%').padding(18);
      if (this.previewMimeType.startsWith('image/')) {
        Image(this.previewUrl).width('90%').height('70%').objectFit(ImageFit.Contain);
      } else {
        Web({ src: this.previewUrl, controller: this.previewController })
          .javaScriptAccess(true)
          .domStorageAccess(true)
          .fileAccess(false)
          .layoutWeight(1)
          .width('100%');
      }
    }
    .width('100%')
    .height('82%')
    .backgroundColor('#FFFFFF')
    .borderRadius({ topLeft: 16, topRight: 16 })
    .position({ x: 0, y: '18%' });
  }
}
