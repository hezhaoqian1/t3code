import { DEFAULT_MODEL, ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

/**
 * Every new task starts on Flash (deepseek-flash), FD's default model,
 * whichever task or workspace it was opened from. Upstream carries the viewed
 * thread's model into a new draft, so switching one task to Pro used to make
 * the next "新建任务" start on Pro as well. An existing task keeps the model
 * chosen for it, and an unsent draft keeps the model picked in it.
 */
export const NEW_TASK_MODEL_SELECTION: ModelSelection = createModelSelection(
  ProviderInstanceId.make("fd-deepseek"),
  DEFAULT_MODEL,
);
