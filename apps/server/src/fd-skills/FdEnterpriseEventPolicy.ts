import type { ProviderRuntimeEvent } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

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
  if (/allocated quota exceeded|insufficient_quota|quota exceeded|quota limit/i.test(message)) {
    return "模型服务额度已达上限。请联系管理员检查上游额度，或切换可用模型后继续。";
  }
  if (/\b429\b|too many requests|rate[ _-]?limit/i.test(message)) {
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
