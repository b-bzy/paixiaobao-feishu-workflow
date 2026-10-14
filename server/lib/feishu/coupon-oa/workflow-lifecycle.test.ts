import { describe, expect, it } from "vitest";
import type { CouponOaDraft } from "./draft-store";
import type { CouponExcelPilotDraft } from "./excel-pilot-store";
import {
  couponWorkflowIdleTimeoutMs,
  couponWorkflowLastActivityAt,
  isCouponWorkflowIdle,
  isExpiredCouponExcelPilot,
  isExpiredCouponOaDraft,
  isUserCancelableCouponOaDraft,
} from "./workflow-lifecycle";

const baseTime = Date.parse("2026-09-30T10:00:00.000Z");

const oaDraft: CouponOaDraft = {
  recordId: "rec-oa",
  draftId: "COA-test",
  ownerOpenId: "ou_test",
  status: "Draft",
  schemaVersion: "coupon-oa-submit-schema-v1",
  values: { applicationType: "优惠券申请" },
  attachments: [],
  validationIssues: [],
  createdAt: "2026-09-30T09:00:00.000Z",
  updatedAt: "2026-09-30T10:00:00.000Z",
};

const pilotDraft: CouponExcelPilotDraft = {
  recordId: "rec-pilot",
  pilotId: "CEP-test",
  ownerOpenId: "ou_test",
  status: "AwaitingWhitelistUpload",
  revision: 1,
  schemaVersion: "coupon-excel-pilot-v1",
  artifacts: [],
  validationIssues: [],
  processedMessageIds: [],
  createdAt: "2026-09-30T09:00:00.000Z",
  updatedAt: "2026-09-30T10:00:00.000Z",
};

describe("coupon workflow lifecycle", () => {
  it("uses the latest persisted activity time", () => {
    expect(couponWorkflowLastActivityAt(oaDraft)).toBe(baseTime);
  });

  it("falls back to creation time when a record has not been modified", () => {
    expect(
      couponWorkflowLastActivityAt({
        createdAt: "2026-09-30T10:00:00.000Z",
      }),
    ).toBe(baseTime);
  });

  it("does not expire a workflow before ten minutes", () => {
    expect(
      isCouponWorkflowIdle(
        pilotDraft,
        baseTime + couponWorkflowIdleTimeoutMs - 1,
      ),
    ).toBe(false);
  });

  it("expires cancelable drafts at ten minutes", () => {
    const now = baseTime + couponWorkflowIdleTimeoutMs;

    expect(isExpiredCouponOaDraft(oaDraft, now)).toBe(true);
    expect(isExpiredCouponExcelPilot(pilotDraft, now)).toBe(true);
  });

  it("does not expire terminal or submission-stage drafts", () => {
    const now = baseTime + couponWorkflowIdleTimeoutMs;

    expect(
      isExpiredCouponOaDraft({ ...oaDraft, status: "Confirmed" }, now),
    ).toBe(false);
    expect(
      isExpiredCouponExcelPilot(
        { ...pilotDraft, status: "GeneratedConfirmed" },
        now,
      ),
    ).toBe(false);
  });

  it("lets the owner abandon a confirmed draft but not in-flight or settled ones", () => {
    expect(isUserCancelableCouponOaDraft(oaDraft)).toBe(true);
    expect(
      isUserCancelableCouponOaDraft({ ...oaDraft, status: "Failed" }),
    ).toBe(true);
    expect(
      isUserCancelableCouponOaDraft({ ...oaDraft, status: "Confirmed" }),
    ).toBe(true);
    expect(
      isUserCancelableCouponOaDraft({ ...oaDraft, status: "Submitting" }),
    ).toBe(false);
    expect(
      isUserCancelableCouponOaDraft({ ...oaDraft, status: "Submitted" }),
    ).toBe(false);
    expect(
      isUserCancelableCouponOaDraft({
        ...oaDraft,
        status: "SubmissionUnknown",
      }),
    ).toBe(false);
    expect(
      isUserCancelableCouponOaDraft({
        ...oaDraft,
        status: "CreatedNeedsReview",
      }),
    ).toBe(false);
  });
});
