import { describe, expect, it } from "vitest";

import {
  activityCopyContextSchemaVersion,
  buildActivityCopyAiPrompt,
  buildActivityCopyFacts,
  buildActivityNarrativeCandidate,
  buildSecondRoundDialogue,
  formatSecondRoundDialogue,
  selectActivityNarrativeCandidate,
  validateActivityCopyAiProposal,
  validateActivityCopyContext,
} from "./coupon-activity-copy.mjs";

function sourceFacts() {
  return buildActivityCopyFacts({
    sourceHashes: {
      coupon: "coupon-source-hash",
      whitelist: "whitelist-source-hash",
    },
    couponRecords: [
      {
        couponName: "满100减1",
        thresholdYuan: 100,
        discountAmountYuan: 1,
        discountRatio: 0.01,
        claimWindow: "9月30日00:00-10月10日23点59分",
        activityName: "正常活动",
      },
      {
        couponName: "满2000减20",
        thresholdYuan: 2000,
        discountAmountYuan: 20,
        discountRatio: 0.01,
        claimWindow: "9月30日00:00-10月10日23点59分",
        activityName: "正常活动",
      },
      {
        couponName: "满3000减30",
        thresholdYuan: 3000,
        discountAmountYuan: 30,
        discountRatio: 0.01,
        claimWindow: "9月30日00:00-10月10日23点59分",
        activityName: "正常活动",
      },
      {
        couponName: "满3000减60",
        thresholdYuan: 3000,
        discountAmountYuan: 60,
        discountRatio: 0.02,
        claimWindow: "9月30日00:00-10月10日23点59分",
        activityName: "正常活动",
      },
    ],
    whitelistTiers: [
      {
        name: "100减1",
        modelHeader: "型号",
        models: ["iPhone 13"],
        modelEvidence: [{ value: "iPhone 13", cell: "100减1!F2" }],
        categories: ["成色机"],
      },
      {
        name: "2000减20",
        modelHeader: "型号",
        models: ["iPhone 14 Pro"],
        modelEvidence: [{ value: "iPhone 14 Pro", cell: "2000减20!F2" }],
        categories: ["成色机"],
      },
      {
        name: "3000减30",
        modelHeader: "型号",
        models: ["iPhone 15 Pro"],
        modelEvidence: [{ value: "iPhone 15 Pro", cell: "3000减30!F2" }],
        categories: ["成色机"],
      },
      {
        name: "3000减60",
        modelHeader: "型号",
        models: ["iPhone 17 Pro Max"],
        modelEvidence: [{ value: "iPhone 17 Pro Max", cell: "3000减60!F2" }],
        categories: ["成色机"],
      },
    ],
  });
}

function completeContext() {
  return {
    schemaVersion: activityCopyContextSchemaVersion,
    businessLabel: "寄卖",
    productLabel: "苹果手机",
    campaignContext: "超品活动",
    couponRate: {
      text: "预计券率2%",
      confirmationStatus: "confirmed",
      source: "业务确认：预计券率口径",
    },
    modelStrategies: [
      { amountYuan: 60, modelAliases: ["17pm"], source: "业务确认的型号策略" },
      { amountYuan: 30, modelAliases: ["15p"], source: "业务确认的型号策略" },
      { amountYuan: 20, modelAliases: ["14p"], source: "业务确认的型号策略" },
    ],
    defaultAmountYuan: 1,
  };
}

describe("coupon activity copy", () => {
  it("renders a candidate from confirmed context and source coupon tiers", () => {
    const candidate = buildActivityNarrativeCandidate({
      context: completeContext(),
      facts: sourceFacts(),
    });

    expect(candidate.generatedCandidate.status).toBe("proposed");
    expect(candidate.generatedCandidate.activityName).toBe("9.30-10.10寄卖苹果手机优惠券申请");
    expect(candidate.generatedCandidate.activityBackground).toContain(
      "本期配置四档优惠券：100-1、2000-20、3000-30、3000-60",
    );
    expect(candidate.generatedCandidate.activityBackground).not.toContain("3000-20");
    expect(candidate.generatedCandidate.activityBackground).toContain("预计券率2%");
    expect(candidate.generatedCandidate.activityBackground).toContain("针对17pm设置60额度优惠");
  });

  it("shows an unconfigured source coupon tier as a non-blocking notice", () => {
    const context = completeContext();
    context.modelStrategies = context.modelStrategies.filter((strategy) => strategy.amountYuan !== 20);
    const candidate = buildActivityNarrativeCandidate({ context, facts: sourceFacts() });

    expect(candidate.generatedCandidate.status).toBe("proposed");
    expect(candidate.generatedCandidate.activityBackground).toContain("本期配置四档优惠券：100-1、2000-20、3000-30、3000-60");
    expect(candidate.generatedCandidate.unconfiguredCouponTiers).toEqual(["2000-20"]);
    expect(candidate.generatedCandidate.notices).toContainEqual(
      expect.objectContaining({
        code: "unconfigured_coupon_tier",
        field: "couponTierStrategies.2000-20",
      }),
    );
    expect(
      selectActivityNarrativeCandidate({
        candidate,
        candidateHash: candidate.candidateHash,
      }),
    ).toMatchObject({ status: "confirmed_for_local_practice" });
  });

  it("keeps unsupported configured strategies as blockers", () => {
    const context = completeContext();
    context.modelStrategies.push({
      amountYuan: 88,
      modelAliases: ["17pm"],
      source: "业务确认的错误策略",
    });

    const candidate = buildActivityNarrativeCandidate({ context, facts: sourceFacts() });

    expect(candidate.generatedCandidate.status).toBe("needs_confirmation");
    expect(candidate.generatedCandidate.blockers).toContain(
      "上下文声明 88 元型号策略，但配券表不存在该面额券档",
    );
  });

  it("requires an explicit business-confirmed coupon-rate meaning", () => {
    const context = completeContext();
    context.couponRate.confirmationStatus = "proposed";

    expect(() => validateActivityCopyContext(context)).toThrow("couponRate 必须由业务确认语义后才能用于活动背景");
  });

  it("verifies AI aliases against observed model values before using them", () => {
    const facts = sourceFacts();
    const prompt = buildActivityCopyAiPrompt({ context: completeContext(), facts });
    expect(prompt.facts.factsHash).toBe(facts.factsHash);

    const verified = validateActivityCopyAiProposal({
      facts,
      proposal: {
        modelAliasCandidates: [
          {
            alias: "17pm",
            sheetName: "3000减60",
            sourceModels: ["iPhone 17 Pro Max"],
            evidenceCells: ["F2"],
            confidence: 0.9,
          },
          {
            alias: "伪造型号",
            sheetName: "3000减30",
            sourceModels: ["iPhone 99 Pro"],
            confidence: 0.9,
          },
        ],
      },
    });

    expect(verified.status).toBe("needs_review");
    expect(verified.modelAliasCandidates).toHaveLength(1);
    expect(verified.issues).toHaveLength(1);
  });

  it("requires each AI alias to name its source cell", () => {
    const verified = validateActivityCopyAiProposal({
      facts: sourceFacts(),
      proposal: {
        modelAliasCandidates: [
          {
            alias: "17pm",
            sheetName: "3000减60",
            sourceModels: ["iPhone 17 Pro Max"],
            confidence: 0.9,
          },
        ],
      },
    });

    expect(verified.status).toBe("needs_review");
    expect(verified.modelAliasCandidates).toHaveLength(0);
    expect(verified.issues[0]).toContain("源型号坐标证据");
  });

  it("returns notices separately from fields requiring business input", () => {
    const context = completeContext();
    context.modelStrategies = context.modelStrategies.filter((strategy) => strategy.amountYuan !== 20);
    const candidate = buildActivityNarrativeCandidate({ context, facts: sourceFacts() });
    const dialogue = buildSecondRoundDialogue({
      activityCopy: { candidate },
      oaValues: {
        businessMode: { status: "unresolved" },
        activityDates: { status: "unresolved" },
        activityPointPercent: { status: "unresolved" },
        overDeduction: {
          value: "否",
          status: "defaulted_pending_unified_confirmation",
        },
      },
    });

    expect(dialogue.status).toBe("needs_business_response");
    expect(dialogue.exceptionDisplay).toContainEqual(
      expect.objectContaining({
        code: "unconfigured_coupon_tier",
        field: "couponTierStrategies.2000-20",
      }),
    );
    expect(dialogue.exceptionDisplay).toContainEqual(
      expect.objectContaining({
        code: "over_deduction_default_pending_unified_confirmation",
        field: "overDeduction",
      }),
    );
    expect(dialogue.missingFields).not.toContainEqual(
      expect.objectContaining({ key: "couponTierStrategies.2000-20" }),
    );
    expect(dialogue.missingFields).not.toContainEqual(
      expect.objectContaining({ key: "overDeduction" }),
    );
    expect(formatSecondRoundDialogue(dialogue)).toContain("请补充 / 确认");
  });

  it("binds local selection to the exact candidate hash", () => {
    const candidate = buildActivityNarrativeCandidate({
      context: completeContext(),
      facts: sourceFacts(),
    });
    const selected = selectActivityNarrativeCandidate({
      candidate,
      candidateHash: candidate.candidateHash,
    });

    expect(selected.status).toBe("confirmed_for_local_practice");
    expect(selected.activityName).toBe(candidate.generatedCandidate.activityName);
    expect(() =>
      selectActivityNarrativeCandidate({ candidate, candidateHash: "stale-candidate" }),
    ).toThrow("活动文案候选 hash 不匹配");
  });
});
