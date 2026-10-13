export const couponOaInvocation = "OA优惠券审批";
export const couponOaDraftInvocation = "OA优惠券填报";
export const couponOaDraftAliases = ["优惠券提单草稿"] as const;

export type CouponOaMode = "disabled" | "native-submit" | "draft-demo";

export function getCouponOaMode(): CouponOaMode {
  const value = process.env.FEISHU_COUPON_OA_MODE?.trim();
  if (!value || value === "disabled") return "disabled";
  if (value === "draft-demo") return "draft-demo";
  if (value === "native-submit" || value === "production") {
    return "native-submit";
  }
  throw new Error(
    "FEISHU_COUPON_OA_MODE must be disabled, native-submit, draft-demo, or the legacy production value",
  );
}

export function isCouponOaEnabled(): boolean {
  return getCouponOaMode() !== "disabled";
}

export function isCouponOaDraftDemo(): boolean {
  return getCouponOaMode() === "draft-demo";
}

export function getCouponOaDraftStoreConfigurationIssue(
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!environment.FEISHU_BASE_APP_TOKEN?.trim()) {
    return "OA 测试稿 Base 未配置：缺少 FEISHU_BASE_APP_TOKEN";
  }
  const tableId = environment.FEISHU_COUPON_DRAFT_TABLE_ID?.trim();
  if (!tableId) {
    return "OA 测试稿 Base 未配置：缺少 FEISHU_COUPON_DRAFT_TABLE_ID";
  }
  if (!/^tbl[a-zA-Z0-9]+$/.test(tableId)) {
    return "OA 测试稿 Base 配置无效：FEISHU_COUPON_DRAFT_TABLE_ID 格式错误";
  }
  return undefined;
}

export function isCouponOaDraftStoreConfigured(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return !getCouponOaDraftStoreConfigurationIssue(environment);
}

export function assertCouponOaDraftStoreConfigured(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const issue = getCouponOaDraftStoreConfigurationIssue(environment);
  if (issue) throw new Error(issue);
}

function nativeSubmitEnabled(): boolean {
  const value = process.env.FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED?.trim();
  if (!value || value === "false") return false;
  if (value === "true") return true;
  throw new Error(
    "FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED must be true or false",
  );
}

function configuredOpenIds(name: string): Set<string> {
  const value = process.env[name]?.trim() ?? "";
  if (!value) return new Set();
  const openIds = value
    .split(",")
    .map((openId) => openId.trim())
    .filter(Boolean);
  if (
    !openIds.length ||
    openIds.some((openId) => !/^ou_[a-zA-Z0-9]+$/.test(openId))
  ) {
    throw new Error(`${name} must be a comma-separated list of open IDs`);
  }
  return new Set(openIds);
}

/** Applies to all coupon-OA stateful operations, including draft-only. */
export function assertCouponOaUserAllowed(openId: string): void {
  if (!configuredOpenIds("FEISHU_COUPON_OA_ALLOWED_OPEN_IDS").has(openId)) {
    throw new Error("Coupon OA is not allowed for this user");
  }
}

/**
 * Native approval creation is intentionally gated independently from the
 * broader coupon OA mode. A production mode alone never authorizes a write.
 */
export function assertCouponOaNativeSubmitAllowed(openId: string): void {
  if (getCouponOaMode() !== "native-submit") {
    throw new Error("Coupon OA native submit is not enabled for this stage");
  }
  if (!nativeSubmitEnabled()) {
    throw new Error("Coupon OA native submit kill switch is closed");
  }
  assertCouponOaUserAllowed(openId);
  if (
    !configuredOpenIds("FEISHU_COUPON_OA_NATIVE_SUBMIT_ALLOWED_OPEN_IDS").has(
      openId,
    )
  ) {
    throw new Error("Coupon OA native submit is not allowed for this user");
  }
}

function normalizeInvocation(text: string) {
  return text.replace(/\s+/g, "").replace(/^[/*!！]+/, "");
}

export function isCouponOaInvocation(text: string): boolean {
  return normalizeInvocation(text) === couponOaInvocation;
}

export function isCouponOaDraftInvocation(text: string): boolean {
  const normalized = normalizeInvocation(text);
  return (
    normalized === couponOaDraftInvocation ||
    couponOaDraftAliases.includes(
      normalized as (typeof couponOaDraftAliases)[number],
    )
  );
}

export function getCouponOaInitiateUrl(): string {
  const value = process.env.FEISHU_COUPON_OA_INITIATE_URL?.trim();
  if (!value) {
    throw new Error("Coupon OA initiate URL is not configured");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Coupon OA initiate URL is invalid");
  }
  if (url.protocol !== "https:") {
    throw new Error("Coupon OA initiate URL must use HTTPS");
  }
  return url.toString();
}

export function getCouponOaApprovalCode(): string {
  const value = process.env.FEISHU_COUPON_OA_APPROVAL_CODE?.trim();
  if (!value) {
    throw new Error("Coupon OA approval code is not configured");
  }
  if (!/^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/i.test(value)) {
    throw new Error("Coupon OA approval code is invalid");
  }
  return value.toUpperCase();
}

export function getCouponOaDraftTableId(): string {
  const value = process.env.FEISHU_COUPON_DRAFT_TABLE_ID?.trim();
  if (!value) {
    throw new Error("Coupon OA draft table is not configured");
  }
  if (!/^tbl[a-zA-Z0-9]+$/.test(value)) {
    throw new Error("Coupon OA draft table is invalid");
  }
  return value;
}
