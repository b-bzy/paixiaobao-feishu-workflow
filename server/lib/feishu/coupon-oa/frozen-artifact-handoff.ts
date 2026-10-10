import { createHash } from "node:crypto";
import { downloadFeishuDriveFile } from "../drive-client";
import { uploadCouponApprovalFile } from "./approval-client";
import type { CouponOaAttachment } from "./draft-store";

const xlsxContentType =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface FrozenCouponOaArtifact {
  role: Extract<
    CouponOaAttachment["role"],
    "couponTable" | "productWhitelist" | "productBlacklist"
  >;
  fileName: string;
  fileToken: string;
  bytes: number;
  sha256: string;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function uploadVerifiedCouponOaArtifacts(input: {
  artifacts: FrozenCouponOaArtifact[];
}): Promise<CouponOaAttachment[]> {
  const roles = new Set(input.artifacts.map((artifact) => artifact.role));
  if (roles.size !== input.artifacts.length) {
    throw new Error("冻结 OA 附件不能包含重复角色");
  }

  return Promise.all(
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
      const fileCode = await uploadCouponApprovalFile({
        name: artifact.fileName,
        type: "attachment",
        contentType: xlsxContentType,
        bytes,
      });
      return {
        role: artifact.role,
        fileName: artifact.fileName,
        fileCode,
        sha256: artifact.sha256,
        bytes: artifact.bytes,
      };
    }),
  );
}
