import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../draft-store", () => ({
  COUPON_OA_THREE_SOURCE_PILOT_SCHEMA_VERSION: "coupon-three-source-pilot-v1",
  createCouponOaDraft: vi.fn(),
  getCouponOaDraft: vi.fn(),
  listActiveCouponOaDrafts: vi.fn(),
}));
vi.mock("../frozen-artifact-handoff", () => ({
  uploadVerifiedCouponOaArtifacts: vi.fn(),
}));

import type { OaPrefillSnapshot } from "../../../coupon-oa/three-source/types";
import { createCouponOaDraft, listActiveCouponOaDrafts } from "../draft-store";
import { uploadVerifiedCouponOaArtifacts } from "../frozen-artifact-handoff";
import {
  handoffThreeSourcePilotToOaDraft,
  mapThreeSourcePrefillToOaValues,
} from "./handoff";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const prefill: OaPrefillSnapshot = {
  ownerId: "ou_test",
  revision: 4,
  snapshotHash: sha256("prefill"),
  values: {
    applicant: {
      source: "feishuIdentity",
      status: "resolved_on_final_confirmation",
    },
    department: {
      source: "feishuIdentity",
      status: "resolved_on_final_confirmation",
    },
    applicationType: "优惠券申请",
    businessMode: "严选",
    activityName: "严选满减",
    activityBackground: "严选活动背景",
    activityPointPercent: 6,
    platformBearingPercent: 50,
    overDeduction: "否",
    estimatedGmvYuan: 10000,
    estimatedCostYuan: 1000,
    estimatedRoi: 10,
    channels: ["JD", "PAIPAI"],
    activityStartAt: "2030-01-01",
    activityEndAt: "2030-01-03",
    durationDays: 3,
  },
  attachments: [],
  blacklistStatus: "absent_confirmed",
  overlap: { ids: [], sha256: sha256("overlap") },
};

const frozenArtifacts = [
  {
    role: "couponTable" as const,
    fileName: "标准配券表.xlsx",
    fileToken: "coupon-token",
    bytes: 10,
    sha256: sha256("coupon"),
    templateId: "coupon-regular-full-reduction-v1",
    templateVersion: "v1",
  },
  {
    role: "productWhitelist" as const,
    fileName: "标准白名单.xlsx",
    fileToken: "whitelist-token",
    bytes: 20,
    sha256: sha256("whitelist"),
    templateId: "coupon-multi-tier-sku-whitelist-v1",
    templateVersion: "v1",
  },
];

const approvalAttachments = [
  {
    role: "couponTable" as const,
    fileName: "标准配券表.xlsx",
    fileCode: "coupon-code",
    bytes: 10,
    sha256: sha256("coupon"),
  },
  {
    role: "productWhitelist" as const,
    fileName: "标准白名单.xlsx",
    fileCode: "whitelist-code",
    bytes: 20,
    sha256: sha256("whitelist"),
  },
];

describe("three-source OA draft handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FEISHU_BASE_APP_TOKEN = "basCouponDraft";
    process.env.FEISHU_COUPON_DRAFT_TABLE_ID = "tblCouponDraft";
    vi.mocked(listActiveCouponOaDrafts).mockResolvedValue([]);
    vi.mocked(uploadVerifiedCouponOaArtifacts).mockResolvedValue(
      approvalAttachments,
    );
    vi.mocked(createCouponOaDraft).mockImplementation(async (input) => ({
      recordId: "rec-draft",
      draftId: "COA-three-source",
      ownerOpenId: input.ownerOpenId,
      status: "Draft",
      schemaVersion: input.schemaVersion,
      values: input.values,
      attachments: input.attachments ?? [],
      validationIssues: [],
    }));
  });

  it("fails before uploading artifacts when the OA test-draft Base is incomplete", async () => {
    delete process.env.FEISHU_BASE_APP_TOKEN;
    await expect(
      handoffThreeSourcePilotToOaDraft({
        ownerOpenId: "ou_test",
        prefill,
        artifacts: frozenArtifacts,
      }),
    ).rejects.toThrow("OA 测试稿 Base 未配置：缺少 FEISHU_BASE_APP_TOKEN");
    expect(uploadVerifiedCouponOaArtifacts).not.toHaveBeenCalled();
  });

  it("maps strict-only values and generated attachments into the existing OA draft shape", () => {
    expect(
      mapThreeSourcePrefillToOaValues({
        prefill,
        attachments: approvalAttachments,
      }),
    ).toMatchObject({
      businessMode: "严选",
      channels: ["京东渠道", "严选APP及小程序"],
      couponTableFileCodes: ["coupon-code"],
      productWhitelistFileCodes: ["whitelist-code"],
    });
  });

  it("maps ordered calculation images for POP", () => {
    const imageHash = sha256("image");
    const result = mapThreeSourcePrefillToOaValues({
      prefill: {
        ...prefill,
        values: { ...prefill.values, businessMode: "pop" },
        attachments: [
          {
            artifactId: "image-1",
            order: 0,
            role: "calcImage",
            fileName: "测算图.png",
            sha256: imageHash,
            bytes: 30,
            offlineReference: "offline://image-1",
            contentType: "image/png",
          },
        ],
      },
      attachments: [
        ...approvalAttachments,
        {
          artifactId: "image-1",
          order: 0,
          role: "calcImage",
          fileName: "测算图.png",
          fileCode: "image-code",
          bytes: 30,
          sha256: imageHash,
          contentType: "image/png",
        },
      ],
    });
    expect(result.calcImageFileCodes).toEqual(["image-code"]);
  });

  it("creates one system draft but never submits native OA", async () => {
    await expect(
      handoffThreeSourcePilotToOaDraft({
        ownerOpenId: "ou_test",
        prefill,
        artifacts: frozenArtifacts,
      }),
    ).resolves.toMatchObject({ status: "Draft", recordId: "rec-draft" });
    expect(uploadVerifiedCouponOaArtifacts).toHaveBeenCalledWith({
      artifacts: frozenArtifacts,
    });
    expect(createCouponOaDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerOpenId: "ou_test",
        attachments: approvalAttachments,
      }),
    );
  });

  it("rejects non-strict modes without images and existing unrelated drafts before a handoff", async () => {
    expect(() =>
      mapThreeSourcePrefillToOaValues({
        prefill: {
          ...prefill,
          values: { ...prefill.values, businessMode: "pop" },
        },
        attachments: approvalAttachments,
      }),
    ).toThrow("必须包含测算图片");

    vi.mocked(listActiveCouponOaDrafts).mockResolvedValue([
      { recordId: "other" } as never,
    ]);
    await expect(
      handoffThreeSourcePilotToOaDraft({
        ownerOpenId: "ou_test",
        prefill,
        artifacts: frozenArtifacts,
      }),
    ).rejects.toThrow("已有未完成");
    expect(uploadVerifiedCouponOaArtifacts).not.toHaveBeenCalled();
  });
});
