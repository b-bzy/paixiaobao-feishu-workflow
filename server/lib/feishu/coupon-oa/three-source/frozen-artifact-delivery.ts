import { createHash } from "node:crypto";
import {
  sendFeishuFileMessage,
  sendFeishuImageMessage,
  uploadFeishuMessageFile,
  uploadFeishuMessageImage,
} from "../../client";
import { downloadFeishuDriveFile } from "../../drive-client";
import type { CouponOaAttachment } from "../draft-store";

export interface FrozenArtifactMessageDependencies {
  downloadFile: typeof downloadFeishuDriveFile;
  uploadFile: typeof uploadFeishuMessageFile;
  uploadImage: typeof uploadFeishuMessageImage;
  sendFile: typeof sendFeishuFileMessage;
  sendImage: typeof sendFeishuImageMessage;
}

const defaults: FrozenArtifactMessageDependencies = {
  downloadFile: downloadFeishuDriveFile,
  uploadFile: uploadFeishuMessageFile,
  uploadImage: uploadFeishuMessageImage,
  sendFile: sendFeishuFileMessage,
  sendImage: sendFeishuImageMessage,
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function deliverOneArtifact(input: {
  openId: string;
  attachment: CouponOaAttachment;
  idempotencyKey?: string;
  dependencies: FrozenArtifactMessageDependencies;
}): Promise<void> {
  const { attachment } = input;
  if (!attachment.fileToken) {
    throw new Error(`${attachment.fileName} 缺少 Drive 文件引用`);
  }
  const bytes = await input.dependencies.downloadFile(attachment.fileToken);
  // Deliver only verified frozen bytes: a hash mismatch means the Drive file
  // drifted from the confirmed snapshot and must not be sent for review.
  if (sha256(bytes) !== attachment.sha256) {
    throw new Error(`${attachment.fileName} 的冻结校验不一致，已跳过发送`);
  }
  if (attachment.role === "calcImage") {
    const imageKey = await input.dependencies.uploadImage({ bytes });
    await input.dependencies.sendImage(
      input.openId,
      imageKey,
      input.idempotencyKey,
    );
    return;
  }
  const fileKey = await input.dependencies.uploadFile({
    fileName: attachment.fileName,
    bytes,
  });
  await input.dependencies.sendFile(
    input.openId,
    fileKey,
    input.idempotencyKey,
  );
}

/**
 * Best-effort delivery of the frozen review artifacts as real chat file and
 * image messages right after the step-4 send card, so the owner can inspect
 * the exact frozen bytes without opening Drive previews. Each artifact is
 * independent: one failure never blocks the others or the card flow.
 */
export async function deliverFrozenArtifactsAsMessages(
  input: {
    openId: string;
    attachments: CouponOaAttachment[];
    idempotencyKey?: string;
  },
  dependencies: FrozenArtifactMessageDependencies = defaults,
): Promise<{ delivered: string[]; failed: string[] }> {
  const ordered = [...input.attachments]
    .filter((attachment) => attachment.role !== "removeItems")
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  const results = await Promise.allSettled(
    ordered.map(async (attachment) => {
      await deliverOneArtifact({
        openId: input.openId,
        attachment,
        idempotencyKey: input.idempotencyKey
          ? `${input.idempotencyKey}:artifact:${attachment.artifactId ?? attachment.fileName}`
          : undefined,
        dependencies,
      });
      return attachment.fileName;
    }),
  );
  return {
    delivered: results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    ),
    failed: results.flatMap((result) =>
      result.status === "rejected" ? [String(result.reason)] : [],
    ),
  };
}
