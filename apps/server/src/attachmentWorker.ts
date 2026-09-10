// @effect-diagnostics nodeBuiltinImport:off
import * as NodeWorkerThreads from "node:worker_threads";
import { processAttachment, type AttachmentWork } from "./fileAnalysis/VisualAttachments.ts";

try {
  const result = await processAttachment(NodeWorkerThreads.workerData as AttachmentWork);
  NodeWorkerThreads.parentPort?.postMessage({ ok: true, result }, []);
} catch (error) {
  NodeWorkerThreads.parentPort?.postMessage(
    {
      ok: false,
      message: error instanceof Error ? error.message : "附件解析失败。",
    },
    [],
  );
}
