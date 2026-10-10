import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../drive-client", () => ({ downloadFeishuDriveFile: vi.fn() }));
vi.mock("./approval-client", () => ({ uploadCouponApprovalFile: vi.fn() }));

import { downloadFeishuDriveFile } from "../drive-client";
import { uploadCouponApprovalFile } from "./approval-client";
import { uploadVerifiedCouponOaArtifacts } from "./frozen-artifact-handoff";

const couponBytes = new Uint8Array([1, 2, 3]);
const whitelistBytes = new Uint8Array([4, 5, 6]);
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const artifacts = [
  {
    role: "couponTable" as const,
    fileName: "标准配券表.xlsx",
    fileToken: "coupon-token",
    bytes: couponBytes.byteLength,
    sha256: sha256(couponBytes),
  },
  {
    role: "productWhitelist" as const,
    fileName: "标准白名单.xlsx",
    fileToken: "whitelist-token",
    bytes: whitelistBytes.byteLength,
    sha256: sha256(whitelistBytes),
  },
];

describe("frozen coupon OA artifact handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(downloadFeishuDriveFile).mockImplementation(async (token) =>
      token === "coupon-token" ? couponBytes : whitelistBytes,
    );
    vi.mocked(uploadCouponApprovalFile)
      .mockResolvedValueOnce("coupon-file-code")
      .mockResolvedValueOnce("whitelist-file-code");
  });

  it("re-downloads and hash-checks every frozen artifact before upload", async () => {
    await expect(
      uploadVerifiedCouponOaArtifacts({ artifacts }),
    ).resolves.toEqual([
      expect.objectContaining({
        role: "couponTable",
        fileCode: "coupon-file-code",
      }),
      expect.objectContaining({
        role: "productWhitelist",
        fileCode: "whitelist-file-code",
      }),
    ]);
    expect(uploadCouponApprovalFile).toHaveBeenCalledTimes(2);
  });

  it("does not upload any changed artifact", async () => {
    vi.mocked(downloadFeishuDriveFile).mockResolvedValue(new Uint8Array([9]));

    await expect(
      uploadVerifiedCouponOaArtifacts({ artifacts }),
    ).rejects.toThrow("已变更，不能自动填写 OA");
    expect(uploadCouponApprovalFile).not.toHaveBeenCalled();
  });

  it("rejects duplicate artifact roles before it reads Drive", async () => {
    await expect(
      uploadVerifiedCouponOaArtifacts({
        artifacts: [...artifacts, artifacts[0]],
      }),
    ).rejects.toThrow("重复角色");
    expect(downloadFeishuDriveFile).not.toHaveBeenCalled();
  });
});
