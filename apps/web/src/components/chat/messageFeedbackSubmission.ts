import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";

import type { MessageFeedback } from "../../messageFeedbackStore";

export interface MessageFeedbackSubmissionOptions<Input, Output, Error> {
  currentFeedback: MessageFeedback | null;
  requestedFeedback: MessageFeedback;
  input: (feedback: MessageFeedback | null) => Input;
  submit: (input: Input) => Promise<AtomCommandResult<Output, Error>>;
  onPendingFeedbackChange: (feedback: MessageFeedback | null | undefined) => void;
  onConfirmed: (feedback: MessageFeedback | null) => void;
  onSuccess: (feedback: MessageFeedback | null) => void;
}

export async function submitMessageFeedback<Input, Output, Error>(
  options: MessageFeedbackSubmissionOptions<Input, Output, Error>,
): Promise<void> {
  const nextFeedback =
    options.currentFeedback === options.requestedFeedback ? null : options.requestedFeedback;

  options.onPendingFeedbackChange(nextFeedback);
  let result: AtomCommandResult<Output, Error>;
  try {
    result = await options.submit(options.input(nextFeedback));
  } catch {
    options.onPendingFeedbackChange(undefined);
    return;
  }

  if (result._tag === "Failure") {
    options.onPendingFeedbackChange(undefined);
    return;
  }

  options.onConfirmed(nextFeedback);
  options.onPendingFeedbackChange(undefined);
  options.onSuccess(nextFeedback);
}
