import { afterEach, describe, expect, it } from "vitest";
import {
  couponOaDraftInvocation,
  couponOaInvocation,
  getCouponOaApprovalCode,
  getCouponOaDraftTableId,
  getCouponOaInitiateUrl,
  getCouponOaMode,
  isCouponOaDraftInvocation,
  isCouponOaInvocation,
} from "./config";

describe("coupon OA configuration", () => {
  const originalMode = process.env.FEISHU_COUPON_OA_MODE;
  const originalUrl = process.env.FEISHU_COUPON_OA_INITIATE_URL;

  afterEach(() => {
    if (originalMode === undefined) {
      delete process.env.FEISHU_COUPON_OA_MODE;
    } else {
      process.env.FEISHU_COUPON_OA_MODE = originalMode;
    }
    if (originalUrl === undefined) {
      delete process.env.FEISHU_COUPON_OA_INITIATE_URL;
    } else {
      process.env.FEISHU_COUPON_OA_INITIATE_URL = originalUrl;
    }
  });

  it("defaults to production mode and accepts draft-demo only when explicit", () => {
    delete process.env.FEISHU_COUPON_OA_MODE;
    expect(getCouponOaMode()).toBe("production");

    process.env.FEISHU_COUPON_OA_MODE = "draft-demo";
    expect(getCouponOaMode()).toBe("draft-demo");
  });

  it("rejects an unknown coupon OA mode", () => {
    process.env.FEISHU_COUPON_OA_MODE = "local";
    expect(() => getCouponOaMode()).toThrow(
      "FEISHU_COUPON_OA_MODE must be production or draft-demo",
    );
  });

  it("only recognizes the exact configured invocation after whitespace normalization", () => {
    expect(isCouponOaInvocation(couponOaInvocation)).toBe(true);
    expect(isCouponOaInvocation(" OA 优惠券 审批 ")).toBe(true);
    expect(isCouponOaInvocation("我的 OA优惠券审批到哪了？")).toBe(false);
    expect(isCouponOaInvocation("OA优惠券")).toBe(false);
  });

  it("accepts a configured HTTPS initiation URL", () => {
    process.env.FEISHU_COUPON_OA_INITIATE_URL =
      "https://applink.feishu.cn/client/mini_program/open?appId=cli_coupon";

    expect(getCouponOaInitiateUrl()).toBe(
      "https://applink.feishu.cn/client/mini_program/open?appId=cli_coupon",
    );
  });

  it.each([
    [undefined, "not configured"],
    ["not a URL", "invalid"],
    ["http://example.com/approval", "must use HTTPS"],
  ])("rejects an unsafe initiation URL", (value, message) => {
    if (value === undefined) {
      delete process.env.FEISHU_COUPON_OA_INITIATE_URL;
    } else {
      process.env.FEISHU_COUPON_OA_INITIATE_URL = value;
    }

    expect(() => getCouponOaInitiateUrl()).toThrow(message);
  });

  it("recognizes the separate draft invocation and its aliases", () => {
    expect(isCouponOaDraftInvocation(couponOaDraftInvocation)).toBe(true);
    expect(isCouponOaDraftInvocation(" OA 优 惠 券 填 报 ")).toBe(true);
    expect(isCouponOaDraftInvocation("/OA优惠券填报")).toBe(true);
    expect(isCouponOaDraftInvocation("优惠券提单草稿")).toBe(true);
    expect(isCouponOaDraftInvocation("！优惠券提单草稿")).toBe(true);
    expect(isCouponOaDraftInvocation("OA优惠券审批")).toBe(false);
  });

  it("validates approval and draft table configuration", () => {
    process.env.FEISHU_COUPON_OA_APPROVAL_CODE =
      "34f3f8e4-90d9-4a3c-8c61-f05d97fd0941";
    process.env.FEISHU_COUPON_DRAFT_TABLE_ID = "tblCouponDraft";

    expect(getCouponOaApprovalCode()).toBe(
      "34F3F8E4-90D9-4A3C-8C61-F05D97FD0941",
    );
    expect(getCouponOaDraftTableId()).toBe("tblCouponDraft");
  });
});
