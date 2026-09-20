import { fileIo } from '@kit.CoreFileKit';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';

import { FdAttachment } from '../data/FdModels';
import { FdRuntimeClient, FdRuntimeError } from './FdRuntimeClient';

export interface AttachmentTransferProgress {
  state: FdAttachment['state'];
  progress: number;
  sizeBytes?: number;
  errorMessage?: string;
}

/**
 * Reads a picker URI incrementally. The whole file is never kept in memory;
 * only one server-sized part is materialized at a time.
 *
 * SHA-256 is calculated incrementally with the platform crypto provider. The
 * whole digest and each part digest are sent to the Runtime for verification.
 */
export async function uploadPickedAttachment(
  client: FdRuntimeClient,
  threadId: string,
  attachment: FdAttachment,
  onProgress: (progress: AttachmentTransferProgress) => void
): Promise<FdAttachment> {
  const sourceUri = attachment.sourceUri;
  if (sourceUri === undefined || sourceUri.length === 0) {
    throw new FdRuntimeError('attachment_source_missing', '附件本地 URI 已失效，请重新选择文件');
  }

  let descriptor: fileIo.File | undefined;
  try {
    descriptor = fileIo.openSync(sourceUri, fileIo.OpenMode.READ_ONLY);
    const stat = fileIo.statSync(descriptor.fd);
    const sizeBytes = Number(stat.size);
    if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
      throw new FdRuntimeError('attachment_size_unavailable', '无法读取附件大小');
    }
    onProgress({ state: 'uploading', progress: 0, sizeBytes });

    const upload = await client.createAttachmentUpload(
      threadId,
      attachment.name,
      attachment.mimeType,
      sizeBytes,
      ''
    );
    if (upload.attachmentId.length === 0 || upload.uploadUrl.length === 0) {
      throw new FdRuntimeError('attachment_upload_invalid', 'FD Runtime 没有返回有效的上传会话');
    }

    const chunkSize = Math.max(64 * 1024, upload.chunkSize);
    const totalParts = Math.max(1, Math.ceil(sizeBytes / chunkSize));
    let uploadedBytes = 0;
    const wholeDigest = cryptoFramework.createMd('SHA256');
    for (let partIndex = 0; partIndex < totalParts; partIndex += 1) {
      const remaining = sizeBytes - uploadedBytes;
      const requestedLength = Math.min(chunkSize, Math.max(0, remaining));
      const buffer = new ArrayBuffer(requestedLength);
      const readLength = fileIo.readSync(descriptor.fd, buffer, {
        offset: 0,
        length: requestedLength
      });
      if (readLength !== requestedLength) {
        throw new FdRuntimeError('attachment_read_failed', `附件读取不完整（第 ${partIndex + 1} 片）`);
      }
      const bytes = new Uint8Array(buffer);
      await wholeDigest.update({ data: bytes });
      const partDigest = cryptoFramework.createMd('SHA256');
      await partDigest.update({ data: bytes });
      const partChecksum = toHex((await partDigest.digest()).data);
      await uploadPartWithRetry(client, upload.uploadUrl, partIndex, totalParts, buffer, partChecksum);
      uploadedBytes += readLength;
      onProgress({
        state: 'uploading',
        progress: sizeBytes === 0 ? 100 : Math.round((uploadedBytes / sizeBytes) * 100),
        sizeBytes
      });
    }

    const checksum = toHex((await wholeDigest.digest()).data);
    const completed = await client.completeAttachmentUpload(upload.attachmentId, totalParts, checksum);
    const result: FdAttachment = {
      ...attachment,
      ...completed,
      attachmentId: upload.attachmentId,
      name: completed.name.length > 0 ? completed.name : attachment.name,
      mimeType: completed.mimeType.length > 0 ? completed.mimeType : attachment.mimeType,
      sizeBytes: completed.sizeBytes > 0 ? completed.sizeBytes : sizeBytes,
      sourceUri,
      // The transfer API and the parser API deliberately have separate states.
      // Preserve the server result: images/text are ready immediately today,
      // while a future parser may legitimately return processing here.
      state: completed.state,
      progress: completed.progress
    };
    onProgress({ state: result.state, progress: result.progress, sizeBytes: result.sizeBytes });
    return result;
  } catch (error) {
    const message = error instanceof FdRuntimeError ? error.message : '附件上传失败';
    onProgress({ state: 'failed', progress: attachment.progress, errorMessage: message });
    throw error;
  } finally {
    if (descriptor !== undefined) fileIo.closeSync(descriptor.fd);
  }
}

function toHex(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result;
}

const MAX_PART_UPLOAD_ATTEMPTS = 4;

async function uploadPartWithRetry(
  client: FdRuntimeClient,
  uploadUrl: string,
  partIndex: number,
  totalParts: number,
  data: ArrayBuffer,
  checksum: string
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_PART_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      await client.uploadAttachmentPart(uploadUrl, partIndex, totalParts, data, checksum);
      return;
    } catch (error) {
      if (attempt === MAX_PART_UPLOAD_ATTEMPTS || !isRetryablePartError(error)) throw error;
      await delay(500 * Math.pow(2, attempt - 1));
    }
  }
  throw new FdRuntimeError('attachment_upload_failed', '附件分片上传失败');
}

function isRetryablePartError(error: Object): boolean {
  if (!(error instanceof FdRuntimeError)) return true;
  return error.code === 'network_error' ||
    error.code === 'http_408' ||
    error.code === 'http_425' ||
    error.code === 'http_429' ||
    error.code.startsWith('http_5');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, milliseconds);
  });
}
