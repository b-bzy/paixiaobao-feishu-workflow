import { describe, expect, it } from "vitest";
import {
  buildActivityCopyAiRequest,
  buildActivityCopyFacts,
  composeOaActivityName,
  isPlaceholderActivityName,
  oaActivityNameStructureIssue,
  validateActivityCopyProposal,
} from "./activity-copy";

function facts() {
  return buildActivityCopyFacts({
    sourceHashes: { coupon: "coupon-hash", whitelist: "list-hash" },
    period: "2026-09-30至2026-10-10",
    businessMode: "寄卖",
    productLabel: "苹果手机",
    campaignTheme: "国庆促销",
    nameHints: [
      "平板优惠券申请3.24-3.26",
      "满减券",
      "电脑整机优惠券",
      "限SKU",
      "东券",
    ],
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

  it("composes the OA name as month-day dates plus components without a year", () => {
    expect(
      composeOaActivityName({
        period: "2026-03-24至2026-03-26",
        category: "平板",
        idType: "SKU",
      }),
    ).toBe("3.24-3.26平板SKU优惠券申请");
    expect(composeOaActivityName({ period: "2026-09-30至2026-10-10" })).toBe(
      "9.30-10.10优惠券申请",
    );
    expect(composeOaActivityName({ period: "2026-12-31" })).toBe(
      "12.31优惠券申请",
    );
  });

  it("flags year-bearing or duplicated activity names structurally", () => {
    expect(oaActivityNameStructureIssue("3.24-3.26平板SKU优惠券申请")).toBe(
      undefined,
    );
    expect(
      oaActivityNameStructureIssue("2026-03-24至2026-03-26京东商城优惠券申请"),
    ).toBe("活动名称不能包含年份");
    expect(
      oaActivityNameStructureIssue("3.24-3.26平板SKU优惠券申请优惠券申请"),
    ).toBe("活动名称重复拼接了优惠券申请");
    expect(oaActivityNameStructureIssue("3.24-3.26平板SKU申请")).toBe(
      "活动名称不符合优惠券申请文案结构",
    );
  });

  it("builds a stable fact snapshot and a constrained prompt", () => {
    const first = facts();
    const second = facts();
    expect(first.factsHash).toBe(second.factsHash);
    expect(first.sourceActivityNames).toEqual([]);
    const request = buildActivityCopyAiRequest(first);
    expect(request.system).toContain("必须覆盖全部券档");
    expect(request.system).toContain("日期+品类+ID类型+优惠券申请");
    expect(request.system).toContain("不带年份");
    expect(request.system).toContain("京东商城");
    expect(request.user).toContain(first.factsHash);
    expect(request.user).toContain("nameHints");
    expect(request.user).not.toContain("open_id");
  });

  it("accepts grounded components and composes the template name", () => {
    const result = validateActivityCopyProposal({
      facts: facts(),
      proposal: {
        nameComponents: { category: "电脑整机", idType: "SKU" },
        activityBackground:
          "本期申请9.30-10.10电脑整机SKU优惠券，本期配置二档优惠券：100-1、2000-20；配合国庆促销。",
        coveredTierIds: ["tier-1", "tier-2"],
        usedFactIds: [
          "period",
          "nameHints",
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
    expect(result.warnings).toEqual([]);
    expect(result.activityName).toBe("9.30-10.10电脑整机SKU优惠券申请");
  });

  it("drops ungrounded or forbidden name components as warnings, not failures", () => {
    const result = validateActivityCopyProposal({
      facts: facts(),
      proposal: {
        nameComponents: {
          category: "京东商城",
          idType: "满1000减100SKU",
        },
        activityBackground:
          "本期申请9.30-10.10优惠券，本期配置二档优惠券：100-1、2000-20。",
        coveredTierIds: ["tier-1", "tier-2"],
        usedFactIds: ["period"],
      },
    });
    expect(result.status).toBe("valid");
    expect(result.activityName).toBe("9.30-10.10优惠券申请");
    expect(result.warnings).toEqual([
      "活动名称品类无法在来源线索中回溯，已忽略：京东商城",
      "活动名称ID类型包含日期或金额数字，已忽略：满1000减100SKU",
    ]);
  });

  it("rejects placeholders, missing period, missing tiers and invented facts", () => {
    const missingPeriod = buildActivityCopyFacts({
      sourceHashes: { coupon: "coupon-hash" },
      nameHints: ["平板"],
      tiers: [
        {
          display: "100-1",
          thresholdYuan: 100,
          discountAmountYuan: 1,
          evidenceCells: ["配券!H2"],
        },
      ],
    });
    expect(
      validateActivityCopyProposal({
        facts: missingPeriod,
        proposal: {
          nameComponents: { category: "平板" },
          activityBackground: "本期申请平板优惠券，本期配置一档优惠券：100-1。",
          coveredTierIds: ["tier-1"],
        },
      }),
    ).toMatchObject({
      status: "invalid",
      issues: ["活动文案事实缺少可格式化的活动周期"],
    });

    const result = validateActivityCopyProposal({
      facts: facts(),
      proposal: {
        nameComponents: {},
        activityBackground: "本期配置100-1，预计GMV一亿元。",
        coveredTierIds: ["tier-1"],
        usedFactIds: ["tier-1", "budget"],
      },
    });
    expect(result.status).toBe("invalid");
    expect(result.issues).toContain("活动背景遗漏券档 tier-2");
    expect(result.issues).toContain("活动文案包含未授权事实：GMV");
    expect(result.issues).toContain("活动文案引用未知事实 budget");
  });
});
