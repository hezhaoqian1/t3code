import { isTransportConnectionErrorMessage } from "@t3tools/client-runtime/errors";

export {
  isTransportConnectionErrorMessage,
  sanitizeThreadErrorMessage,
} from "@t3tools/client-runtime/errors";

/**
 * The description for an action that failed. A dropped or not-yet-open
 * connection to the local service reads as a retry hint instead of a raw
 * transport message such as "bird is not connected.".
 */
export function describeActionError(error: unknown): string {
  const message = error instanceof Error ? error.message : null;
  if (isTransportConnectionErrorMessage(message)) return "本地服务正在连接，请稍后再试。";
  return message && message.trim().length > 0 ? message : "发生未知错误。";
}
