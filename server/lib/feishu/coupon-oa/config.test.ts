import { afterEach, describe, expect, it } from "vitest";
import {
  assertCouponOaNativeSubmitAllowed,
  assertCouponOaUserAllowed,
  couponOaDraftInvocation,
  couponOaInvocation,
  getCouponOaApprovalCode,
  getCouponOaDraftTableId,
  getCouponOaInitiateUrl,
  getCouponOaMode,
  isCouponOaDraftInvocation,
  isCouponOaDraftStoreConfigured,
  isCouponOaEnabled,
  isCouponOaInvocation,
} from "./config";

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("coupon OA configuration", () => {
  const originalMode = process.env.FEISHU_COUPON_OA_MODE;
  const originalUrl = process.env.FEISHU_COUPON_OA_INITIATE_URL;
  const originalNativeSubmitEnabled =
    process.env.FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED;
  const originalNativeSubmitAllowedOpenIds =
    process.env.FEISHU_COUPON_OA_NATIVE_SUBMIT_ALLOWED_OPEN_IDS;
  const originalCouponOaAllowedOpenIds =
    process.env.FEISHU_COUPON_OA_ALLOWED_OPEN_IDS;
  const originalBaseAppToken = process.env.FEISHU_BASE_APP_TOKEN;
  const originalDraftTableId = process.env.FEISHU_COUPON_DRAFT_TABLE_ID;

  afterEach(() => {
    restoreEnvironment("FEISHU_COUPON_OA_MODE", originalMode);
    restoreEnvironment("FEISHU_COUPON_OA_INITIATE_URL", originalUrl);
    restoreEnvironment(
      "FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED",
      originalNativeSubmitEnabled,
    );
    restoreEnvironment(
      "FEISHU_COUPON_OA_NATIVE_SUBMIT_ALLOWED_OPEN_IDS",
      originalNativeSubmitAllowedOpenIds,
    );
    restoreEnvironment(
      "FEISHU_COUPON_OA_ALLOWED_OPEN_IDS",
      originalCouponOaAllowedOpenIds,
    );
    restoreEnvironment("FEISHU_BASE_APP_TOKEN", originalBaseAppToken);
    restoreEnvironment("FEISHU_COUPON_DRAFT_TABLE_ID", originalDraftTableId);
  });

  it("checks legacy draft conflicts only when its Base store is configured", () => {
    delete process.env.FEISHU_BASE_APP_TOKEN;
    delete process.env.FEISHU_COUPON_DRAFT_TABLE_ID;
    expect(isCouponOaDraftStoreConfigured()).toBe(false);

    process.env.FEISHU_BASE_APP_TOKEN = "bas-test";
    process.env.FEISHU_COUPON_DRAFT_TABLE_ID = "not-a-table";
    expect(isCouponOaDraftStoreConfigured()).toBe(false);

    process.env.FEISHU_COUPON_DRAFT_TABLE_ID = "tblCouponDraft";
    expect(isCouponOaDraftStoreConfigured()).toBe(true);
  });

  it("defaults to disabled mode and only enables supported explicit modes", () => {
    delete process.env.FEISHU_COUPON_OA_MODE;
    expect(getCouponOaMode()).toBe("disabled");
    expect(isCouponOaEnabled()).toBe(false);

    process.env.FEISHU_COUPON_OA_MODE = "draft-demo";
    expect(getCouponOaMode()).toBe("draft-demo");

    process.env.FEISHU_COUPON_OA_MODE = "native-submit";
    expect(getCouponOaMode()).toBe("native-submit");

    process.env.FEISHU_COUPON_OA_MODE = "production";
    expect(getCouponOaMode()).toBe("native-submit");
  });

  it("rejects an unknown coupon OA mode", () => {
    process.env.FEISHU_COUPON_OA_MODE = "local";
    expect(() => getCouponOaMode()).toThrow(
      "FEISHU_COUPON_OA_MODE must be disabled, native-submit, draft-demo, or the legacy production value",
    );
  });

  it("requires an explicit kill-switch override and allowlist for native submit", () => {
    process.env.FEISHU_COUPON_OA_MODE = "native-submit";
    delete process.env.FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED;
    delete process.env.FEISHU_COUPON_OA_NATIVE_SUBMIT_ALLOWED_OPEN_IDS;
    expect(() => assertCouponOaNativeSubmitAllowed("ou_submitter")).toThrow(
      "kill switch is closed",
    );

    process.env.FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED = "true";
    process.env.FEISHU_COUPON_OA_ALLOWED_OPEN_IDS = "ou_allowed, ou_other";
    expect(() => assertCouponOaNativeSubmitAllowed("ou_submitter")).toThrow(
      "not allowed for this user",
    );

    process.env.FEISHU_COUPON_OA_NATIVE_SUBMIT_ALLOWED_OPEN_IDS =
      "ou_allowed, ou_other";
    expect(() => assertCouponOaNativeSubmitAllowed("ou_submitter")).toThrow(
      "not allowed for this user",
    );
    expect(() => assertCouponOaNativeSubmitAllowed("ou_allowed")).not.toThrow();
  });

  it("denies stateful coupon operations without a general tester allowlist", () => {
    delete process.env.FEISHU_COUPON_OA_ALLOWED_OPEN_IDS;
    expect(() => assertCouponOaUserAllowed("ou_submitter")).toThrow(
      "Coupon OA is not allowed for this user",
    );

    process.env.FEISHU_COUPON_OA_ALLOWED_OPEN_IDS = "ou_allowed";
    expect(() => assertCouponOaUserAllowed("ou_submitter")).toThrow(
      "Coupon OA is not allowed for this user",
    );
    expect(() => assertCouponOaUserAllowed("ou_allowed")).not.toThrow();
  });

  it("rejects malformed native submit configuration", () => {
    process.env.FEISHU_COUPON_OA_MODE = "native-submit";
    process.env.FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED = "yes";
    expect(() => assertCouponOaNativeSubmitAllowed("ou_submitter")).toThrow(
      "must be true or false",
    );

    process.env.FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED = "true";
    process.env.FEISHU_COUPON_OA_ALLOWED_OPEN_IDS = "ou_submitter";
    process.env.FEISHU_COUPON_OA_NATIVE_SUBMIT_ALLOWED_OPEN_IDS = "user-id";
    expect(() => assertCouponOaNativeSubmitAllowed("ou_submitter")).toThrow(
      "must be a comma-separated list",
    );
  });

  it("never allows native submit outside native-submit mode", () => {
    process.env.FEISHU_COUPON_OA_MODE = "draft-demo";
    process.env.FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED = "true";
    process.env.FEISHU_COUPON_OA_NATIVE_SUBMIT_ALLOWED_OPEN_IDS =
      "ou_submitter";
    expect(() => assertCouponOaNativeSubmitAllowed("ou_submitter")).toThrow(
      "not enabled for this stage",
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
