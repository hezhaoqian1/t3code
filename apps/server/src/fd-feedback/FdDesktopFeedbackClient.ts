import type { DesktopMessageFeedbackInput, DesktopMessageFeedbackResult } from "@t3tools/contracts";
import { DesktopMessageFeedbackError } from "@t3tools/contracts";
import type { FdServerRuntimeCredentialProjection } from "@t3tools/contracts/fd/runtime-credentials";

type CredentialReader = () => Promise<FdServerRuntimeCredentialProjection | undefined>;
type FdFetch = (input: URL, init?: RequestInit) => Promise<Response>;

interface GatewayEnvelope {
  readonly success?: unknown;
  readonly message?: unknown;
  readonly data?: unknown;
}

export class FdDesktopFeedbackClient {
  readonly #credentials: CredentialReader;
  readonly #fetch: FdFetch;

  constructor(options: { readonly credentials: CredentialReader; readonly fetch?: FdFetch }) {
    this.#credentials = options.credentials;
    this.#fetch = options.fetch ?? fetch;
  }

  async submit(input: DesktopMessageFeedbackInput): Promise<DesktopMessageFeedbackResult> {
    const credentials = await this.#credentials();
    if (!credentials) {
      throw new DesktopMessageFeedbackError({
        code: "credentials_unavailable",
        message: "请先登录方德 AI 后再提交反馈。",
      });
    }

    let response: Response;
    try {
      response = await this.#fetch(
        new URL("/api/agent/desktop/feedback", credentials.newApiOrigin),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${credentials.accessToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_thread_id: input.clientThreadId,
            client_message_id: input.clientMessageId,
            rating: input.rating ?? "",
            user_input: input.userInput,
            assistant_output: input.assistantOutput,
            model: input.model,
            request_id: input.requestId,
            ...(input.enterpriseConversationId === undefined
              ? {}
              : { enterprise_conversation_id: input.enterpriseConversationId }),
            ...(input.enterpriseMessageId === undefined
              ? {}
              : { enterprise_message_id: input.enterpriseMessageId }),
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch {
      throw new DesktopMessageFeedbackError({
        code: "gateway_unavailable",
        message: "反馈服务暂时无法连接，请稍后重试。",
      });
    }

    let envelope: GatewayEnvelope;
    try {
      envelope = (await response.json()) as GatewayEnvelope;
    } catch {
      throw new DesktopMessageFeedbackError({
        code: "invalid_response",
        message: "反馈服务返回了无法识别的结果。",
      });
    }
    if (!response.ok || envelope.success !== true) {
      throw new DesktopMessageFeedbackError({
        code: response.status === 400 ? "invalid_request" : "gateway_rejected",
        message:
          typeof envelope.message === "string" && envelope.message.trim()
            ? envelope.message
            : "反馈暂时无法保存，请稍后重试。",
      });
    }

    const data = envelope.data as
      | { readonly conversation_id?: unknown; readonly message_id?: unknown }
      | undefined;
    if (
      !data ||
      !Number.isSafeInteger(data.conversation_id) ||
      !Number.isSafeInteger(data.message_id) ||
      Number(data.conversation_id) < 0 ||
      Number(data.message_id) < 0
    ) {
      throw new DesktopMessageFeedbackError({
        code: "invalid_response",
        message: "反馈服务返回了不完整的结果。",
      });
    }
    return {
      conversationId: Number(data.conversation_id),
      messageId: Number(data.message_id),
      rating: input.rating,
    };
  }
}
