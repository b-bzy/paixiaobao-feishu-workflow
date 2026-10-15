import { describe, expect, it } from "vitest";
import {
  couponOwnerRepairText,
  normalizeCouponOwnerInputs,
} from "./owner-input";

describe("coupon owner input normalization", () => {
  it("normalizes common date, mode, numeric and percentage input variants", () => {
    expect(
      normalizeCouponOwnerInputs({
        activityStartAt: "２０２６年９月３０日 00:00",
        activityEndAt: "2026/10/10 23:59",
        businessMode: "泡泡",
        thresholdYuan: "2,000元",
        expectedUseRate: "８０％",
      }),
    ).toEqual({
      values: {
        activityStartAt: "2026-09-30",
        activityEndAt: "2026-10-10",
        businessMode: "pop",
        thresholdYuan: 2000,
        expectedUseRate: 0.8,
      },
      issues: [],
    });
  });

  it("keeps ambiguous facts for AI repair and gives a Chinese example", () => {
    const result = normalizeCouponOwnerInputs({
      activityStartAt: "9月30日",
      businessMode: "不知道",
    });
    expect(result.values.activityStartAt).toBe("9月30日");
    expect(result.issues).toEqual([
      expect.objectContaining({
        key: "activityStartAt",
        message: "活动开始日期请输入完整日期，例如 2026-09-30",
      }),
      expect.objectContaining({ key: "businessMode" }),
    ]);
    expect(couponOwnerRepairText(result.issues)).toContain(
      "不补充未提供的业务事实",
    );
  });

  it("rejects structured values instead of leaking [object Object]", () => {
    const result = normalizeCouponOwnerInputs({
      totalQuantity: { value: 1000, unit: "张" },
      estimatedGmvYuan: { gmv: "10000" },
      activityName: "正常名称",
    });
    expect(result.values).toEqual({ activityName: "正常名称" });
    expect(result.issues).toEqual([
      expect.objectContaining({
        key: "totalQuantity",
        message: expect.stringContaining("取值格式无法识别"),
      }),
      expect.objectContaining({
        key: "estimatedGmvYuan",
        message: expect.stringContaining("取值格式无法识别"),
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("[object Object]");
  });
});
