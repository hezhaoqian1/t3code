// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

/**
 * A file derived from an attachment (parsed pages, a sheet's CSV export, a
 * page's recognition), stored beside it as `<attachment id>.<suffix>`. The
 * suffix must not contain dots: the projection's attachment cleanup parses
 * the id up to the last dot, so these files are deleted with their thread.
 */
export function attachmentSiblingPath(attachmentPath: string, suffix: string): string {
  if (suffix.includes(".") || suffix.includes("/") || suffix.includes("\\"))
    throw new Error("Attachment sibling suffix must be a single dot-free segment.");
  const parsed = NodePath.parse(attachmentPath);
  return NodePath.join(parsed.dir, `${parsed.name}.${suffix}`);
}
