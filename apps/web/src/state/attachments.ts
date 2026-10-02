import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

/** Signed upload URLs and cleanup for composer attachments uploaded ahead of a send. */
export const attachmentEnvironment = {
  createUploadUrl: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "上传附件",
    tag: WS_METHODS.attachmentsCreateUploadUrl,
  }),
  remove: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "移除已上传的附件",
    tag: WS_METHODS.attachmentsDelete,
  }),
};
