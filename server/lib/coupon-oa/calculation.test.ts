import { describe, expect, it } from "vitest";
import {
  computeRegularFullReductionValues,
  roundYuanToCents,
} from "./calculation";

type ComputeInput = Parameters<typeof computeRegularFullReductionValues>[0];

function input(overrides: Partial<ComputeInput> = {}): ComputeInput {
  return {
    activityName: "3.24-3.26平板SKU优惠券申请",
    activityBackground:
      "本期申请3.24-3.26平板SKU优惠券，本期配置一档优惠券：满999减70。",
    businessMode: "寄卖",
    applicantName: "李海洋",
    activityStartAt: "2026-03-24",
    activityEndAt: "2026-03-26",
    channels: ["JD"],
    thresholdYuan: 999,
    discountAmountYuan: 70,
    totalQuantity: 900_000,
    grantQuantityPerClaim: 3,
    dailyClaimLimit: 100_000,
    claimWindow: "3.24 00:00-3.26 23:59",
    useWindow: "3.24 00:00-3.26 23:59",
    expectedClaimRate: 0.098,
    expectedUseRate: 0.002,
    platformBearingRatio: 0.3,
    estimatedGmvYuan: 35_240.8,
    claimRule: "活动期间每天可领一次",
    allowGift: "允许",
    promotionMode: "公开自动推广",
    publicPromotionChannels: ["单品页购物车、领券中心"],
    ...overrides,
  } as ComputeInput;
}

describe("regular full reduction computation", () => {
  it("finalizes cost and ROI at cent precision without float tails", () => {
    // Long multiplication chains can produce sub-cent tails (e.g.
    // 450000.00000000006) or more than two decimals; the confirmed snapshot
    // must finalize them to Feishu amount-control precision.
    const computed = computeRegularFullReductionValues(
      input({ totalQuantity: 1568 }),
    );
    // 1568 * 70 * 0.002 * 0.3 = 65.856 raw; the snapshot finalizes to cents.
    expect(computed.estimatedCostYuan).toBe(65.86);
    expect(computed.estimatedRoi).toBe(roundYuanToCents(35_240.8 / 65.86));
    expect(Number.isInteger(Math.round(computed.estimatedCostYuan * 100))).toBe(
      true,
    );
  });

  it("rounds yuan values to cents", () => {
    expect(roundYuanToCents(450000.00000000006)).toBe(450000);
    expect(roundYuanToCents(1904761.8999999999)).toBe(1904761.9);
    expect(roundYuanToCents(26137.945)).toBe(26137.95);
    expect(roundYuanToCents(Number.NaN)).toBe(NaN);
  });
});
