import { describe, expect, it } from "vitest";
import {
  buildActivityCopyAiRequest,
  buildActivityCopyFacts,
  isPlaceholderActivityName,
  validateActivityCopyProposal,
} from "./activity-copy";

function facts() {
  return buildActivityCopyFacts({
    sourceHashes: { coupon: "coupon-hash", whitelist: "list-hash" },
    period: "9.30-10.10",
    businessMode: "寄卖",
    productLabel: "苹果手机",
    campaignTheme: "国庆促销",
    sourceActivityNames: ["正常活动"],
    tiers: [
      {
        display: "100-1",
        thresholdYuan: 100,
        discountAmountYuan: 1,
        evidenceCells: ["配券!H2", "配券!I2"],
      },
      {
        display: "2000-20",
        thresholdYuan: 2000,
        discountAmountYuan: 20,
        evidenceCells: ["配券!H3", "配券!I3"],
      },
    ],
  });
}

describe("coupon activity copy runtime contract", () => {
  it.each([
    "正常活动",
    "测试活动",
    "促销活动",
    "优惠券活动",
    "默认活动",
    "活动名称",
    "未命名活动",
    "待补充",
    "配券表9.30-10.10.xlsx",
  ])("rejects placeholder activity name %s", (name) => {
    expect(isPlaceholderActivityName(name)).toBe(true);
  });

  it("builds a stable fact snapshot and a constrained prompt", () => {
    const first = facts();
    const second = facts();
    expect(first.factsHash).toBe(second.factsHash);
    expect(first.sourceActivityNames).toEqual([]);
    const request = buildActivityCopyAiRequest(first);
    expect(request.system).toContain("必须覆盖全部券档");
    expect(request.user).toContain(first.factsHash);
    expect(request.user).not.toContain("open_id");
  });

  it("accepts specific copy that covers every verified tier", () => {
    const result = validateActivityCopyProposal({
      facts: facts(),
      proposal: {
        activityName: "9.30-10.10寄卖苹果手机国庆优惠券申请",
        activityBackground:
          "本期申请9.30-10.10寄卖苹果手机国庆优惠券，本期配置二档优惠券：100-1、2000-20；配合国庆促销。",
        coveredTierIds: ["tier-1", "tier-2"],
        usedFactIds: [
          "period",
          "businessMode",
          "productLabel",
          "campaignTheme",
          "tier-1",
          "tier-2",
        ],
      },
    });
    expect(result.status).toBe("valid");
    expect(result.issues).toEqual([]);
  });

  it("rejects placeholders, missing tiers and invented business facts", () => {
    const result = validateActivityCopyProposal({
      facts: facts(),
      proposal: {
        activityName: "正常活动",
        activityBackground: "本期配置100-1，预计GMV一亿元。",
        coveredTierIds: ["tier-1"],
        usedFactIds: ["tier-1", "budget"],
      },
    });
    expect(result.status).toBe("invalid");
    expect(result.issues).toContain("活动名称仍是无业务含义的占位文字");
    expect(result.issues).toContain("活动背景遗漏券档 tier-2");
    expect(result.issues).toContain("活动文案包含未授权事实：GMV");
    expect(result.issues).toContain("活动文案引用未知事实 budget");
  });
});
