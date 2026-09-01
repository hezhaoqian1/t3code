import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const DesktopMessageFeedbackRating = Schema.NullOr(Schema.Literals(["like", "dislike"]));
export type DesktopMessageFeedbackRating = typeof DesktopMessageFeedbackRating.Type;

export const DesktopMessageFeedbackInput = Schema.Struct({
  clientThreadId: TrimmedNonEmptyString,
  clientMessageId: TrimmedNonEmptyString,
  rating: DesktopMessageFeedbackRating,
  userInput: Schema.String,
  assistantOutput: Schema.String,
  model: Schema.String,
  requestId: Schema.String,
  enterpriseConversationId: Schema.optional(NonNegativeInt),
  enterpriseMessageId: Schema.optional(NonNegativeInt),
});
export type DesktopMessageFeedbackInput = typeof DesktopMessageFeedbackInput.Type;

export const DesktopMessageFeedbackResult = Schema.Struct({
  conversationId: NonNegativeInt,
  messageId: NonNegativeInt,
  rating: DesktopMessageFeedbackRating,
});
export type DesktopMessageFeedbackResult = typeof DesktopMessageFeedbackResult.Type;

export class DesktopMessageFeedbackError extends Schema.TaggedErrorClass<DesktopMessageFeedbackError>()(
  "DesktopMessageFeedbackError",
  {
    code: Schema.Literals([
      "credentials_unavailable",
      "invalid_request",
      "gateway_unavailable",
      "gateway_rejected",
      "invalid_response",
    ]),
    message: Schema.String,
  },
) {}
