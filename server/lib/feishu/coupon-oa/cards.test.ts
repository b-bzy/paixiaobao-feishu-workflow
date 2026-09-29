import { describe, expect, it } from "vitest";
import { buildCouponOaPreviewCard, buildCouponOaSubmitCard } from "./cards";
import type { CouponOaDraft } from "./draft-store";

const values: CouponOaDraft["values"] = {
  applicationType: "优惠券申请",
  businessMode: "寄卖",
  activityName: "国庆优惠券活动",
  activityBackground: "用于验证完整字段展示，避免提交前产生误会。",
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
});
