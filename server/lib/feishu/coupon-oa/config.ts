export const couponOaInvocation = "OA优惠券审批";
export const couponOaDraftInvocation = "OA优惠券填报";
export const couponOaDraftAliases = ["优惠券提单草稿"] as const;

export type CouponOaMode = "production" | "draft-demo";

export function getCouponOaMode(): CouponOaMode {
  const value = process.env.FEISHU_COUPON_OA_MODE?.trim();
  if (!value || value === "production") return "production";
  if (value === "draft-demo") return "draft-demo";
  throw new Error("FEISHU_COUPON_OA_MODE must be production or draft-demo");
}

export function isCouponOaDraftDemo(): boolean {
  return getCouponOaMode() === "draft-demo";
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
