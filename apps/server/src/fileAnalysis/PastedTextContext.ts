/**
 * Clipboard text the desktop composer folded into a "粘贴内容.txt" attachment.
 * It is the employee's own message, kept out of the composer only for
 * readability, so it reaches the model as part of what the employee said —
 * not as untrusted document content.
 */
export interface PastedText {
  readonly name: string;
  readonly text: string;
  /** Where the full text is saved, for the part that does not fit. */
  readonly path: string;
}

/** Leaves room for the question and other attachments in the per-turn cap. */
export const PASTED_TEXT_CONTEXT_MAX_BYTES = 120_000;

const encoder = new TextEncoder();

/** The longest prefix of `text` within `maxBytes` UTF-8 bytes, never splitting a character. */
export function utf8Prefix(text: string, maxBytes: number): string {
  if (encoder.encode(text).byteLength <= maxBytes) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(text.slice(0, middle)).byteLength <= maxBytes) low = middle;
    else high = middle - 1;
  }
  // Do not end on the high half of a surrogate pair.
  const lastCode = text.charCodeAt(low - 1);
  const end = lastCode >= 0xd800 && lastCode <= 0xdbff ? low - 1 : low;
  return text.slice(0, end);
}

export function formatPastedTextContext(
  pasted: ReadonlyArray<PastedText>,
  maxBytes = PASTED_TEXT_CONTEXT_MAX_BYTES,
): string {
  if (pasted.length === 0) return "";
  let remaining = maxBytes;
  const sections = pasted.map((entry) => {
    const normalized = entry.text.replace(/\r\n?/g, "\n");
    const excerpt = utf8Prefix(normalized, Math.max(0, remaining));
    remaining -= encoder.encode(excerpt).byteLength;
    if (excerpt.length === normalized.length) {
      return `<pasted-text name="${entry.name}">\n${normalized}\n</pasted-text>`;
    }
    return [
      `<pasted-text name="${entry.name}" truncated="true">\n${excerpt}\n</pasted-text>`,
      `“${entry.name}”共 ${normalized.length.toLocaleString("en-US")} 个字符，上面只包含开头的 ${excerpt.length.toLocaleString("en-US")} 个字符。完整内容保存在 ${entry.path}，需要其余部分时请读取这个文件，不要猜测未显示的内容。`,
    ].join("\n");
  });
  return [
    "以下是用户在输入框中粘贴的内容。为了让消息简洁，桌面端把它作为附件发送；它属于用户本轮消息的一部分，按用户的原话对待。",
    ...sections,
  ].join("\n\n");
}
