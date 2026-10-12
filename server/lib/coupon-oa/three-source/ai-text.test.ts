import { describe, expect, it } from "vitest";
import {
  buildCouponSupplementTextAiRequest,
  validateCouponSupplementTextProposal,
} from "./ai-text";

describe("coupon supplement text AI contract", () => {
  it("keeps only registered and valid field candidates", () => {
    const result = validateCouponSupplementTextProposal({
      fields: {
        businessMode: "POP",
        activityStartAt: "2030-01-01",
        activityEndAt: "明天",
      },
      warnings: [],
    });
    expect(result.fields).toEqual({
      businessMode: "pop",
      activityStartAt: "2030-01-01",
    });
    expect(result.warnings).toContain("AI 返回的结束日期无效");
  });

  it("normalizes colloquial POP and no-over-deduction candidates", () => {
    const result = validateCouponSupplementTextProposal({
      fields: {
        businessMode: "泡泡",
        activityPointPercent: "5%",
        overDeduction: false,
      },
      warnings: [],
    });

    expect(result.fields).toMatchObject({
      businessMode: "pop",
      activityPointPercent: 5,
      overDeduction: "否",
    });
  });

  it("rejects unsupported keys and malformed structures", () => {
    const result = validateCouponSupplementTextProposal({
      fields: { createNativeOa: true },
    });
    expect(result.fields).toEqual({});
    expect(result.warnings).toContain("AI 返回结构不符合补充字段格式");
  });

  it("sends only the reviewed text and candidate-only instructions", () => {
    const request = buildCouponSupplementTextAiRequest(
      "业务模式是严选，活动从2030-01-01开始",
    );
    expect(request.user).toContain("业务模式是严选");
    expect(request.system).toContain("不补猜");
    expect(request.system).toContain("泡泡");
    expect(request.system).toContain("未提供年份");
    expect(request.system).not.toContain("创建审批");
  });
});
