// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
import * as NodeWorkerThreads from "node:worker_threads";
import * as NodeFSP from "node:fs/promises";
import type { AttachmentWork, ProcessedAttachment } from "./VisualAttachments.ts";
import { convertLegacyOffice } from "./LegacyOffice.ts";

export async function runAttachmentWorker(
  work: AttachmentWork,
  signal: AbortSignal,
  platform: NodeJS.Platform,
): Promise<ProcessedAttachment> {
  signal.throwIfAborted();
  const extension = work.attachment.name.split(".").at(-1)?.toLowerCase();
  if (work.attachment.type === "document" && (extension === "doc" || extension === "ppt")) {
    const attachment = work.attachment;
    const bytes = await NodeFSP.readFile(work.path);
    if (
      bytes.length !== attachment.sizeBytes ||
      bytes.length > 25 * 1024 * 1024 ||
      !bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    )
      throw new Error("旧版 Office 文件校验失败。");
    return convertLegacyOffice(
      bytes,
      extension,
      async (path, target) => {
        const result = await runAttachmentWorker(
          {
            ...work,
            path,
            attachment: {
              ...attachment,
              name: `converted.${target}`,
              sizeBytes: (await NodeFSP.stat(path)).size,
            },
          },
          signal,
          platform,
        );
        return {
          ...result,
          ...(result.context
            ? {
                context: {
                  ...result.context,
                  attachment,
                  parser: `libreoffice/${result.context.parser}`,
                },
              }
            : {}),
        };
      },
      platform,
      signal,
    );
  }
  const source = import.meta.url.endsWith(".ts");
  const url = source
    ? new URL("../attachmentWorker.ts", import.meta.url)
    : new URL("./attachmentWorker.mjs", import.meta.url);
  const worker = new NodeWorkerThreads.Worker(url, {
    workerData: work,
    resourceLimits: { maxOldGenerationSizeMb: 512 },
  });
  try {
    return await new Promise<ProcessedAttachment>((resolve, reject) => {
      const abort = () => reject(new Error("附件处理已取消。"));
      const timer = setTimeout(
        () => reject(new Error("附件解析超过 90 秒，请缩小文件后重试。")),
        90_000,
      );
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      };
      signal.addEventListener("abort", abort, { once: true });
      worker.once(
        "message",
        (message: { ok: boolean; result: ProcessedAttachment; message: string }) => {
          cleanup();
          if (message.ok) resolve(message.result);
          else reject(new Error(message.message));
        },
      );
      worker.once("error", (error) => {
        cleanup();
        reject(error);
      });
      worker.once("exit", (code) => {
        cleanup();
        reject(new Error(`附件解析进程意外退出 (${code})。`));
      });
      if (signal.aborted) abort();
    });
  } finally {
    await worker.terminate();
  }
}
