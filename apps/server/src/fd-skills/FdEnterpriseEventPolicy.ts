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
          ...(event.payload.errorMessage ? { errorMessage: "FD Skill execution failed." } : {}),
        },
      };
    case "turn.aborted":
      return { ...event, payload: { reason: "FD Skill execution stopped." } };
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
