import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../drive-client", () => ({ downloadFeishuDriveFile: vi.fn() }));
vi.mock("./approval-client", () => ({ uploadCouponApprovalFile: vi.fn() }));
vi.mock("./draft-store", () => ({
  createCouponOaDraft: vi.fn(),
  getCouponOaDraft: vi.fn(),
  listActiveCouponOaDrafts: vi.fn(),
}));
vi.mock("./excel-pilot-store", () => ({
  updateCouponExcelPilotDraft: vi.fn(),
}));

import { downloadFeishuDriveFile } from "../drive-client";
import { uploadCouponApprovalFile } from "./approval-client";
import { createCouponOaDraft, listActiveCouponOaDrafts } from "./draft-store";
import {
  handoffCouponPilotToOaDraft,
  mapCouponPilotToOaValues,
} from "./excel-pilot-oa-handoff";
import { updateCouponExcelPilotDraft } from "./excel-pilot-store";

const couponBytes = new Uint8Array([1, 2, 3]);
const whitelistBytes = new Uint8Array([4, 5, 6]);
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const pilot = {
  recordId: "rec-pilot",
  pilotId: "CEP-test",
  ownerOpenId: "ou_test",
  status: "HandingOffToOa" as const,
  revision: 3,
  schemaVersion: "coupon-excel-pilot-v1",
  input: {
    activityName: "国庆满减",
    activityBackground: "测试背景",
    businessMode: "寄卖" as const,
    applicantName: "不作为 OA 申请人",
    activityStartAt: "2030-10-01",
    activityEndAt: "2030-10-07",
    channels: ["JD", "PAIPAI"] as ("JD" | "PAIPAI")[],
    thresholdYuan: 100,
    discountAmountYuan: 20,
    totalQuantity: 100,
    grantQuantityPerClaim: 1,
    dailyClaimLimit: 1,
    claimWindow: "2030-10-01 00:00 至 2030-10-07 23:59",
    useWindow: "2030-10-01 00:00 至 2030-10-07 23:59",
    expectedClaimRate: 0.5,
    expectedUseRate: 0.5,
    platformBearingRatio: 0.25,
    estimatedGmvYuan: 10_000,
    couponType: "东券" as const,
    productLimitType: "限SKU" as const,
    claimRiskControl: "0级以下用户可领" as const,
    claimRule: "活动期间仅可领一次" as const,
    allowGift: "允许" as const,
    promotionMode: "非公开推广" as const,
    publicPromotionChannels: [],
    overDeduction: "否" as const,
    overDeductionReason: "",
  },
  artifacts: [
    {
      role: "couponTable" as const,
      fileName: "配券信息表.xlsx",
      fileToken: "coupon-token",
      bytes: couponBytes.byteLength,
      sha256: sha256(couponBytes),
      templateId: "coupon-template",
      templateVersion: "v1",
    },
    {
      role: "productWhitelist" as const,
      fileName: "商品明细白名单.xlsx",
      fileToken: "whitelist-token",
      bytes: whitelistBytes.byteLength,
      sha256: sha256(whitelistBytes),
      templateId: "whitelist-template",
      templateVersion: "v1",
    },
  ],
  validationIssues: [],
  processedMessageIds: [],
};

describe("coupon Excel pilot OA handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listActiveCouponOaDrafts).mockResolvedValue([]);
    vi.mocked(downloadFeishuDriveFile).mockImplementation(async (token) =>
      token === "coupon-token" ? couponBytes : whitelistBytes,
    );
    vi.mocked(uploadCouponApprovalFile)
      .mockResolvedValueOnce("coupon-file-code")
      .mockResolvedValueOnce("whitelist-file-code");
    vi.mocked(updateCouponExcelPilotDraft).mockImplementation(
      async (draft, updates) => ({
        ...draft,
        ...updates,
        revision: draft.revision + 1,
      }),
    );
    vi.mocked(createCouponOaDraft).mockImplementation(async (input) => ({
      recordId: "rec-oa",
      draftId: "COA-test",
      ownerOpenId: input.ownerOpenId,
      status: "Draft",
      schemaVersion: input.schemaVersion,
      values: input.values,
      attachments: input.attachments ?? [],
      validationIssues: [],
    }));
  });

  it("maps only the frozen P1-1 fields into the OA system draft", () => {
    expect(
      mapCouponPilotToOaValues(pilot.input, [
        {
          role: "couponTable",
          fileName: "配券信息表.xlsx",
          fileCode: "coupon-file-code",
          sha256: "coupon-hash",
          bytes: 1,
        },
        {
          role: "productWhitelist",
          fileName: "商品明细白名单.xlsx",
          fileCode: "whitelist-file-code",
          sha256: "whitelist-hash",
          bytes: 1,
        },
      ]),
    ).toMatchObject({
      applicationType: "优惠券申请",
      businessMode: "寄卖",
      estimatedCostYuan: 250,
      activityPointPercent: 20,
      platformBearingPercent: 25,
      channels: ["京东渠道", "严选APP及小程序"],
      couponTableFileCodes: ["coupon-file-code"],
      productWhitelistFileCodes: ["whitelist-file-code"],
    });
  });

  it("promotes exactly the two verified generated files without submitting OA", async () => {
    const result = await handoffCouponPilotToOaDraft(pilot);

    expect(uploadCouponApprovalFile).toHaveBeenCalledTimes(2);
    expect(uploadCouponApprovalFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: "配券信息表.xlsx", type: "attachment" }),
    );
    expect(createCouponOaDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerOpenId: "ou_test",
        values: expect.objectContaining({
          couponTableFileCodes: ["coupon-file-code"],
          productWhitelistFileCodes: ["whitelist-file-code"],
        }),
        attachments: [
          expect.objectContaining({ role: "couponTable" }),
          expect.objectContaining({ role: "productWhitelist" }),
        ],
      }),
    );
    expect(result.pilot.status).toBe("GeneratedConfirmed");
    expect(result.oaDraft.status).toBe("Draft");
    const createdInput = vi.mocked(createCouponOaDraft).mock.calls[0]?.[0];
    expect(createdInput?.values.calcImageFileCodes).toBeUndefined();
  });

  it("rejects a modified Drive artifact before approval-file upload", async () => {
    vi.mocked(downloadFeishuDriveFile).mockResolvedValue(new Uint8Array([9]));

    await expect(handoffCouponPilotToOaDraft(pilot)).rejects.toThrow(
      "已变更，不能自动填写 OA",
    );
    expect(uploadCouponApprovalFile).not.toHaveBeenCalled();
    expect(createCouponOaDraft).not.toHaveBeenCalled();
  });

  it("refuses to overwrite an unrelated active OA draft", async () => {
    vi.mocked(listActiveCouponOaDrafts).mockResolvedValue([
      { recordId: "other" } as never,
    ]);

    await expect(handoffCouponPilotToOaDraft(pilot)).rejects.toThrow(
      "已有未完成的优惠券 OA 草稿",
    );
    expect(downloadFeishuDriveFile).not.toHaveBeenCalled();
    expect(createCouponOaDraft).not.toHaveBeenCalled();
  });
});
