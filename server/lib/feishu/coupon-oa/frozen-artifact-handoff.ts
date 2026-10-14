import { createHash } from "node:crypto";
import { downloadFeishuDriveFile } from "../drive-client";
import { uploadCouponApprovalFile } from "./approval-client";
import type { CouponOaAttachment } from "./draft-store";

const xlsxContentType =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface FrozenCouponOaArtifact {
  artifactId?: string;
  order?: number;
  role: Extract<
    CouponOaAttachment["role"],
    "couponTable" | "productWhitelist" | "productBlacklist" | "calcImage"
  >;
  fileName: string;
  fileToken: string;
  bytes: number;
  sha256: string;
  contentType?: "image/png" | "image/jpeg";
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function uploadVerifiedCouponOaArtifacts(input: {
  artifacts: FrozenCouponOaArtifact[];
}): Promise<CouponOaAttachment[]> {
  const nonImageRoles = input.artifacts
    .filter((artifact) => artifact.role !== "calcImage")
    .map((artifact) => artifact.role);
  if (new Set(nonImageRoles).size !== nonImageRoles.length) {
    throw new Error("冻结 OA 附件不能包含重复角色");
  }
  const images = input.artifacts.filter(
    (artifact) => artifact.role === "calcImage",
  );
  const imageIds = new Set(images.map((artifact) => artifact.artifactId));
  if (
    imageIds.has(undefined) ||
    imageIds.size !== images.length ||
    images.some(
      (artifact, index) => artifact.order !== index || !artifact.contentType,
    )
  ) {
    throw new Error("冻结测算图片的 ID、顺序或 MIME 无效");
  }

  const verified = await Promise.all(
    input.artifacts.map(async (artifact) => {
      const bytes = await downloadFeishuDriveFile(artifact.fileToken);
      if (
        bytes.byteLength !== artifact.bytes ||
        sha256(bytes) !== artifact.sha256
      ) {
        throw new Error(
          `已确认的 ${artifact.fileName} 已变更，不能自动填写 OA`,
        );
      }
      return { artifact, bytes };
    }),
  );
  return Promise.all(
    verified.map(async ({ artifact, bytes }) => {
      const fileCode = await uploadCouponApprovalFile({
        name: artifact.fileName,
        type: artifact.role === "calcImage" ? "image" : "attachment",
        contentType:
          artifact.role === "calcImage"
            ? (artifact.contentType ?? "image/png")
            : xlsxContentType,
        bytes,
      });
      return {
        artifactId: artifact.artifactId,
        order: artifact.order,
        role: artifact.role,
        fileName: artifact.fileName,
        fileCode,
        fileToken: artifact.fileToken,
        sha256: artifact.sha256,
        bytes: artifact.bytes,
        contentType: artifact.contentType,
      };
    }),
  );
}
