import type * as Schema from "effect/Schema";

/** A Codex dynamic tool that reads the calling thread's own attachments. */
export interface AttachmentToolSpec {
  readonly type: "function";
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Schema.Json;
}

export interface AttachmentToolResult {
  readonly success: boolean;
  readonly text: string;
  /** Page images for models with a native image route, as data URLs. */
  readonly images?: ReadonlyArray<{ readonly label: string; readonly dataUrl: string }>;
}

export interface AttachmentToolCall {
  readonly threadId: string;
  readonly tool: string;
  readonly arguments: unknown;
  readonly signal: AbortSignal;
}

export interface AttachmentToolSet {
  readonly specs: ReadonlyArray<AttachmentToolSpec>;
  readonly handles: (tool: string) => boolean;
  readonly execute: (call: AttachmentToolCall) => Promise<AttachmentToolResult>;
}

/** Offers several tool sets to a session as one, dispatching by tool name. */
export function combineAttachmentTools(
  ...sets: ReadonlyArray<AttachmentToolSet>
): AttachmentToolSet {
  return {
    specs: sets.flatMap((set) => set.specs),
    handles: (tool) => sets.some((set) => set.handles(tool)),
    execute: (call) => {
      const set = sets.find((candidate) => candidate.handles(call.tool));
      return set
        ? set.execute(call)
        : Promise.resolve({ success: false, text: `未知工具 ${call.tool}。` });
    },
  };
}
