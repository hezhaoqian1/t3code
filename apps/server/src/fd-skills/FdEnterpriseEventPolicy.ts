import type { ProviderRuntimeEvent } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  FD_MODEL_UNAVAILABLE_MESSAGE,
  isFdModelUnavailableError,
} from "../fd-agent/FdModelPolicy.ts";

const AssistantCompletion = Schema.Struct({
  item: Schema.Struct({
    type: Schema.Literal("agentMessage"),
    text: Schema.String,
    phase: Schema.optional(Schema.NullOr(Schema.String)),
  }),
});
const isAssistantCompletion = Schema.is(AssistantCompletion);

/** Return only fixed messages: provider errors can contain enterprise data. */
function enterpriseFailureMessage(message: string): string {
  if (isFdModelUnavailableError(message)) {
    return FD_MODEL_UNAVAILABLE_MESSAGE;
  }
  if (/insufficient_user_quota|用户额度不足|预扣费额度失败/i.test(message)) {
    return "你的 FD 个人可用额度不足以继续此任务。请联系管理员调整 FD 额度后继续。";
  }
  if (
    /arrearage|billoverdue|budgetlimitexceeded|insufficient balance|payment required/i.test(message)
  ) {
    return "模型服务的账务或预算限制阻止了调用。请联系管理员检查上游账户设置后继续。";
  }
  if (/\b(?:free|hour|week|month|usage) allocated quota exceeded/i.test(message)) {
    return "模型服务配额或调用速率已达上限。请联系管理员确认具体限制后继续。";
  }
  // Aliyun's token-limit wording describes TPS/TPM, not an empty wallet.
  if (
    /throttling\.allocationquota|allocated quota exceeded, please increase your quota limit|model-studio\/error-code#token-limit/i.test(
      message,
    )
  ) {
    return "模型服务触发 Token 吞吐限流。请等待约一分钟后在当前任务中继续；频繁发生时请联系管理员调整调用速率。";
  }
  if (
    /insufficient_quota|quota exceeded|quota limit/i.test(message) &&
    !/throttling\.|concurrency allocated quota/i.test(message)
  ) {
    return "模型服务配额或调用速率已达上限。请联系管理员确认具体限制后继续。";
  }
  if (
    /\b429\b|too many requests|rate[ _-]?limit|throttling\.|concurrency allocated quota/i.test(
      message,
    )
  ) {
    return "模型服务暂时繁忙（限流）。请稍后在当前任务中继续。";
  }
  if (/context (?:window|length).*exceed|context_length_exceeded/i.test(message)) {
    return "当前任务内容超出模型上下文上限。请压缩上下文，或新建任务后继续。";
  }
  if (/timed? out|timeout/i.test(message)) {
    return "模型响应超时。请稍后在当前任务中继续。";
  }
  if (/stream disconnected|connection (?:closed|reset)|unexpected eof/i.test(message)) {
    return "模型连接中断。请稍后在当前任务中继续。";
  }
  return "FD 技能执行失败。请重试；若仍失败，请联系管理员并提供任务名称和报错时间。";
}

/** Keep enterprise execution data out of T3's durable event stream. */
export function projectFdEnterpriseEvent(
  event: ProviderRuntimeEvent,
  generation: number,
): ProviderRuntimeEvent {
  const volatile = {
    ...event,
    persistence: "memory-only" as const,
    volatileGeneration: generation,
  };
  switch (event.type) {
    case "session.started":
    case "turn.started":
    case "thread.token-usage.updated":
      return event;
    case "thread.state.changed":
      return { ...event, payload: { state: event.payload.state } };
    case "turn.completed":
      return {
        ...event,
        payload: {
          state: event.payload.state,
          ...(event.payload.errorMessage
            ? { errorMessage: enterpriseFailureMessage(event.payload.errorMessage) }
            : {}),
        },
      };
    case "turn.aborted":
      return { ...event, payload: { reason: "FD 技能执行已停止。" } };
    case "request.opened":
      return { ...event, payload: { requestType: event.payload.requestType } };
    case "request.resolved":
      return {
        ...event,
        payload: {
          requestType: event.payload.requestType,
          ...(event.payload.decision ? { decision: event.payload.decision } : {}),
        },
      };
    case "item.completed": {
      if (event.payload.itemType !== "assistant_message") return volatile;
      const data = event.payload.data;
      if (!isAssistantCompletion(data) || data.item.phase === "commentary") return volatile;
      // The volatile runtime persists this final text through T3's message command.
      return {
        ...volatile,
        type: "item.completed",
        payload: {
          itemType: "assistant_message",
          status: event.payload.status,
          data: { finalText: data.item.text },
        },
      };
    }
    default:
      return volatile;
  }
}
