import type { CouponOaDraft } from "./draft-store";
import type { CouponExcelPilotDraft } from "./excel-pilot-store";

export const couponWorkflowIdleTimeoutMs = 10 * 60 * 1000;

type TimestampedCouponWorkflow = {
  createdAt?: string;
  updatedAt?: string;
};

function timestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function couponWorkflowLastActivityAt(
  workflow: TimestampedCouponWorkflow,
): number | undefined {
  return timestamp(workflow.updatedAt) ?? timestamp(workflow.createdAt);
}

export function isCouponWorkflowIdle(
  workflow: TimestampedCouponWorkflow,
  now = Date.now(),
): boolean {
  const lastActivityAt = couponWorkflowLastActivityAt(workflow);
  return (
    lastActivityAt !== undefined &&
    now - lastActivityAt >= couponWorkflowIdleTimeoutMs
  );
}

export function isCancelableCouponOaDraft(draft: CouponOaDraft): boolean {
  return ["Draft", "Validated", "Failed"].includes(draft.status);
}

export function isCancelableCouponExcelPilot(
  draft: CouponExcelPilotDraft,
): boolean {
  return !["GeneratedConfirmed", "Canceled"].includes(draft.status);
}

export function isExpiredCouponOaDraft(
  draft: CouponOaDraft,
  now = Date.now(),
): boolean {
  return isCancelableCouponOaDraft(draft) && isCouponWorkflowIdle(draft, now);
}

export function isExpiredCouponExcelPilot(
  draft: CouponExcelPilotDraft,
  now = Date.now(),
): boolean {
  return (
    isCancelableCouponExcelPilot(draft) && isCouponWorkflowIdle(draft, now)
  );
}
