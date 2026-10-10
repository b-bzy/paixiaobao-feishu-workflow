import { describe, expect, it } from "vitest";
import {
  parseCouponApplicationDraftForm,
  validateCouponApplicationDraft,
} from "./draft-service";

const strictDraft = {
  applicationType: "优惠券申请" as const,
  businessMode: "严选" as const,
  activityName: "本地测试活动",
  activityBackground: "固定字段写入 Base",
  overDeduction: "否" as const,
  overDeductionReason: "",
  channels: ["京东渠道"],
  activityStartAt: "2030-01-01",
  activityEndAt: "2030-01-02",
};

describe("parseCouponApplicationDraftForm", () => {
  it("preserves explicitly confirmed OA point and platform percentages", () => {
    expect(
      parseCouponApplicationDraftForm({
        businessMode: "寄卖",
        activityName: "活动",
        activityBackground: "背景",
        activityPointPercent: "12.5",
        platformBearingPercent: "50%",
        overDeduction: "否",
        estimatedGmvYuan: "10,000",
        estimatedCostYuan: "500",
        channels: "京东渠道；严选APP及小程序",
        activityStartAt: "2030-01-01",
        activityEndAt: "2030-01-02",
      }),
    ).toMatchObject({
      activityPointPercent: 12.5,
      platformBearingPercent: 50,
      estimatedGmvYuan: 10_000,
      estimatedCostYuan: 500,
    });
  });

  it("rejects an invalid explicitly supplied platform percentage", () => {
    expect(() =>
      parseCouponApplicationDraftForm({
        businessMode: "寄卖",
        overDeduction: "否",
        channels: "京东渠道",
        platformBearingPercent: "101",
      }),
    ).toThrow("平台承担比例必须为 0 到 100 之间的数值");
  });
});

describe("validateCouponApplicationDraft", () => {
  it("accepts a complete strict-mode Base draft without approval attachments", () => {
    expect(() => validateCouponApplicationDraft(strictDraft)).not.toThrow();
  });

  it("rejects an invalid calendar date before Base persistence", () => {
    expect(() =>
      validateCouponApplicationDraft({
        ...strictDraft,
        activityStartAt: "2030-02-30",
      }),
    ).toThrow("活动开始日期必须为有效的 YYYY-MM-DD 日期");
  });

  it("rejects a reversed date interval before Base persistence", () => {
    expect(() =>
      validateCouponApplicationDraft({
        ...strictDraft,
        activityStartAt: "2030-01-03",
      }),
    ).toThrow("活动结束日期不能早于开始日期");
  });

  it("rejects an activity start date before today", () => {
    expect(() =>
      validateCouponApplicationDraft(
        {
          ...strictDraft,
          activityStartAt: "2029-12-31",
          activityEndAt: "2030-01-02",
        },
        { today: "2030-01-01" },
      ),
    ).toThrow("活动开始日期不能早于今天（2030-01-01）");
  });

  it("requires financial fields for consign and pop drafts", () => {
    expect(() =>
      validateCouponApplicationDraft({
        ...strictDraft,
        businessMode: "寄卖",
      }),
    ).toThrow("寄卖和 pop 申请必须填写预估 GMV");
  });
});
