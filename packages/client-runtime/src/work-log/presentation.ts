/**
 * Plain-text line for the latest thought in the live activity row. A
 * bold-only opening line (the Codex summary heading) wins; otherwise this is
 * the first sentence of the reasoning text.
 *
 * Ported from upstream t3code (95ccbf406). Chinese and mixed-language traces
 * also end a sentence at 。！？, which need no following space.
 */
export function liveThoughtLine(markdown: string): string {
  const heading = /^\s*\*\*([^*\r\n]+)\*\*[ \t]*\r?(?:\n|$)/.exec(markdown)?.[1];
  const text = (heading ?? markdown)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*(?:#{1,6}|[-*+]|\d+\.)[ \t]+/gm, "")
    .replace(/`+|\*\*|~~/g, "")
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?![\w*])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  if (heading !== undefined) return text;
  // Cut after the first . ? or ! (plus a closing quote or paren) that a space
  // follows, or after the first 。！？ (plus any closing quotes or brackets).
  const end = /[.?!]["'”’)]?(?=\s)|[。！？][”’」』）)]*/.exec(text);
  return end ? text.slice(0, end.index + end[0].length) : text;
}

/**
 * The live line for a thinking trace that is still growing. Text arrives a
 * paragraph at a time, so the newest paragraph is where the model is now; its
 * first sentence (or its bold heading) is the line. Earlier paragraphs are
 * used only when the newest one flattens to nothing.
 */
export function latestThoughtLine(markdown: string): string {
  const paragraphs = markdown.split(/\r?\n[ \t]*\r?\n/);
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    const line = liveThoughtLine(paragraphs[index]!);
    if (line.length > 0) return line;
  }
  return "";
}
