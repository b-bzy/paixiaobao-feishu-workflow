import { describe, expect, it } from "vitest";
import {
  buildCouponOaActiveWorkflowCard,
  buildCouponOaPreviewCard,
  buildCouponOaSubmissionFailureCard,
  buildCouponOaSubmissionResultCard,
  buildCouponOaSubmitCard,
} from "./cards";
import type { CouponOaDraft } from "./draft-store";
import {
  buildCouponExcelPilotActiveWorkflowCard,
  buildCouponExcelPilotAmbiguousCard,
} from "./excel-pilot-cards";
import type { CouponExcelPilotDraft } from "./excel-pilot-store";

const values: CouponOaDraft["values"] = {
  applicationType: "优惠券申请",
  businessMode: "寄卖",
  activityName: "国庆优惠券活动",
  activityBackground: "用于验证完整字段展示，避免提交前产生误会。",
  activityPointPercent: 12.5,
  platformBearingPercent: 50,
  identitySnapshot: {
    openId: "ou_test",
    userId: "user_test",
    displayName: "测试提报人",
    departmentOpenId: "od_test",
    departmentName: "测试部门",
    resolvedAt: "2026-10-01T00:00:00.000Z",
  },
  overDeduction: "是",
  overDeductionReason: "活动专项预算已审批",
  estimatedGmvYuan: 10000,
  estimatedCostYuan: 500,
  channels: ["京东渠道", "严选APP及小程序"],
  activityStartAt: "2026-10-01",
  activityEndAt: "2026-10-07",
  calcImageFileCodes: ["calc-code"],
  couponTableFileCodes: ["coupon-code"],
  productWhitelistFileCodes: ["whitelist-code"],
};

const attachments: CouponOaDraft["attachments"] = [
  {
    role: "calcImage",
    fileName: "满减测算图片.png",
    fileCode: "calc-code",
    sha256: "calc-sha",
    bytes: 100,
  },
  {
    role: "couponTable",
    fileName: "配券型号表.xlsx",
    fileCode: "coupon-code",
    sha256: "coupon-sha",
    bytes: 200,
  },
  {
    role: "productWhitelist",
    fileName: "商品明细白名单.xlsx",
    fileCode: "whitelist-code",
    sha256: "whitelist-sha",
    bytes: 300,
  },
];

function cardText(card: ReturnType<typeof buildCouponOaPreviewCard>): string {
  return JSON.stringify(card);
}

describe("coupon OA confirmation cards", () => {
  it("shows every user-entered field and uploaded filename in the preview", () => {
    const card = buildCouponOaPreviewCard({
      draftRecordId: "rec-test",
      values,
      attachments,
      missing: [],
    });
    const text = cardText(card);

    for (const expected of [
      "优惠券申请",
      "测试提报人",
      "测试部门",
      "12.5%",
      "50%",
      "寄卖",
      "国庆优惠券活动",
      "用于验证完整字段展示，避免提交前产生误会。",
      "是",
      "活动专项预算已审批",
      "10000",
      "500",
      "20.00",
      "京东渠道；严选APP及小程序",
      "2026-10-01 至 2026-10-07",
      "满减测算图片.png",
      "配券型号表.xlsx",
      "商品明细白名单.xlsx",
    ]) {
      expect(text).toContain(expected);
    }
  });

  it("repeats the complete review on the final submit card", () => {
    const card = buildCouponOaSubmitCard({
      draftRecordId: "rec-test",
      values,
      attachments,
    });
    const text = JSON.stringify(card);

    expect(text).toContain("活动专项预算已审批");
    expect(text).toContain("商品明细白名单.xlsx");
    expect(text).toContain("以上是即将提交的完整内容");
    expect(text).toContain("coupon_oa_submit");
  });

  it("explains a failed submission and makes clear no OA was created", () => {
    const text = JSON.stringify(
      buildCouponOaSubmissionFailureCard({
        message: "活动开始日期不能早于今天（2026-09-29）",
      }),
    );

    expect(text).toContain("优惠券 OA 提交失败");
    expect(text).toContain("正式 OA 未创建");
    expect(text).toContain("审批 → 已发起");
    expect(text).toContain("OA优惠券填报");
  });

  it("keeps a created submission green with readback findings as hints", () => {
    const card = buildCouponOaSubmissionResultCard({
      instanceLink: "https://example.test/approval",
      verificationIssues: ["预估费用：提交 26,137.9 / OA 实际 26,100，请核对"],
    });
    const text = JSON.stringify(card);

    expect(text).toContain("优惠券 OA 提报已完成");
    expect(text).toContain("提交内容自动核对：发现 1 项不一致");
    expect(text).toContain("已提报");
    expect(text).toContain('"green"');
    expect(text).not.toContain("需立即复核");
    expect(text).toContain("预估费用：提交 26,137.9 / OA 实际 26,100");
    expect(text).toContain("打开正式 OA");
  });

  it("shows the automatic readback pass line for a clean submission", () => {
    const text = JSON.stringify(
      buildCouponOaSubmissionResultCard({
        verificationIssues: [],
      }),
    );

    expect(text).toContain("优惠券 OA 提报已完成");
    expect(text).toContain("提交内容与确认快照一致");
    expect(text).not.toContain("自动核对：发现");
  });

  it("includes cancellation actions on active and conflicting workflows", () => {
    const pilot: CouponExcelPilotDraft = {
      recordId: "rec-pilot",
      pilotId: "CEP-test",
      ownerOpenId: "ou_test",
      status: "AwaitingWhitelistUpload",
      revision: 2,
      schemaVersion: "coupon-excel-pilot-v1",
      artifacts: [],
      validationIssues: [],
      processedMessageIds: [],
    };

    const oaText = JSON.stringify(
      buildCouponOaActiveWorkflowCard({
        draftId: "COA-test",
        draftRecordId: "rec-oa",
      }),
    );
    const pilotText = JSON.stringify(
      buildCouponExcelPilotActiveWorkflowCard(pilot),
    );
    const conflictText = JSON.stringify(
      buildCouponExcelPilotAmbiguousCard({
        pilot,
        oaDraft: { recordId: "rec-oa", draftId: "COA-test" },
      }),
    );

    expect(oaText).toContain("coupon_oa_cancel");
    expect(pilotText).toContain("coupon_excel_pilot_cancel");
    expect(conflictText).toContain("coupon_oa_cancel");
    expect(conflictText).toContain("coupon_excel_pilot_cancel");
  });
});
