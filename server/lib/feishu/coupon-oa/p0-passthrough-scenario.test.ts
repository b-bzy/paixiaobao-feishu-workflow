import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({
  sendFeishuCard: vi.fn(),
  sendFeishuCardWithReceipt: vi.fn(async () => ({ messageId: "om-card" })),
  updateFeishuCard: vi.fn(),
  uploadFeishuMessageFile: vi.fn(async () => "file-key"),
  uploadFeishuMessageImage: vi.fn(async () => "image-key"),
  sendFeishuFileMessage: vi.fn(),
  sendFeishuImageMessage: vi.fn(),
}));
vi.mock("../coupon-oa/draft-store", () => ({
  COUPON_OA_THREE_SOURCE_PILOT_SCHEMA_VERSION: "coupon-three-source-pilot-v1",
  getCouponOaDraft: vi.fn(),
  listActiveCouponOaDrafts: vi.fn(),
  saveCouponOaDraft: vi.fn(),
  updateCouponOaDraft: vi.fn(),
}));
vi.mock("../coupon-oa/draft-service", () => ({
  attachCouponOaFile: vi.fn(),
  classifyCouponOaAttachment: vi.fn(),
  missingCouponOaAttachments: vi.fn(() => []),
  parseCouponApplicationDraftForm: vi.fn(),
  validateCouponApplicationDraft: vi.fn(),
}));
vi.mock("../coupon-oa/submit-service", () => ({
  confirmCouponOaDraft: vi.fn(),
  submitConfirmedCouponOaDraft: vi.fn(),
}));

import { sendFeishuCard } from "../client";
import type { CouponOaDraftValues } from "../coupon-oa/approval-schema";
import { missingCouponOaAttachments } from "../coupon-oa/draft-service";
import type { CouponOaDraft } from "../coupon-oa/draft-store";
import {
  getCouponOaDraft,
  updateCouponOaDraft,
} from "../coupon-oa/draft-store";
import {
  confirmCouponOaDraft,
  submitConfirmedCouponOaDraft,
} from "../coupon-oa/submit-service";
import { handleFeishuPocEvent } from "../events";

const confirmedValues: CouponOaDraftValues = {
  applicationType: "优惠券申请",
  businessMode: "寄卖",
  activityName: "本地场景测试活动",
  activityBackground: "本地场景测试背景",
  overDeduction: "否",
  estimatedGmvYuan: 10_000,
  estimatedCostYuan: 100,
  channels: ["京东渠道"],
  activityStartAt: "2030-01-01",
  activityEndAt: "2030-01-01",
  identitySnapshot: {
    openId: "ou_submitter",
    userId: "user_submitter",
    displayName: "本地场景测试",
    departmentOpenId: "od_primary",
    resolvedAt: "2030-01-01T00:00:00.000Z",
  },
};

function cardClick(action: string, sequence: number) {
  return {
    header: { event_id: `event-round-${sequence}`, token: "verify-me" },
    operator: { open_id: "ou_submitter" },
    action: { value: { action, draftRecordId: "rec-round-draft" } },
  };
}

function sentCards(): string[] {
  return vi
    .mocked(sendFeishuCard)
    .mock.calls.map((call) => JSON.stringify(call[1]));
}

describe("three-source P0 passthrough full-round scenario", () => {
  let draft: CouponOaDraft;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FEISHU_RUNTIME_STAGE = "local";
    process.env.FEISHU_LEGACY_POC_ENABLED = "false";
    process.env.FEISHU_COUPON_OA_MODE = "native-submit";
    process.env.FEISHU_COUPON_OA_ALLOWED_OPEN_IDS = "ou_submitter";
    process.env.FEISHU_VERIFICATION_TOKEN = "verify-me";
    vi.mocked(missingCouponOaAttachments).mockReturnValue([]);

    draft = {
      recordId: "rec-round-draft",
      draftId: "COA-round",
      ownerOpenId: "ou_submitter",
      status: "Draft",
      schemaVersion: "coupon-three-source-pilot-v1",
      values: confirmedValues,
      attachments: [],
      validationIssues: [],
    };

    vi.mocked(getCouponOaDraft).mockImplementation(async () => draft);
    vi.mocked(updateCouponOaDraft).mockImplementation(async (_, updates) => {
      draft = { ...draft, ...updates };
      return draft;
    });
    vi.mocked(confirmCouponOaDraft).mockImplementation(async () => {
      if (!["Draft", "Validated", "Failed"].includes(draft.status)) {
        throw new Error(
          "Coupon OA draft cannot be confirmed in its current status",
        );
      }
      draft = { ...draft, status: "Confirmed" };
      return draft;
    });
  });

  it("walks confirm → blocked submit (kill switch closed) → repeat confirm → abandon", async () => {
    process.env.FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED = "false";
    vi.mocked(submitConfirmedCouponOaDraft).mockImplementation(async () => {
      throw new Error("Coupon OA native submit kill switch is closed");
    });

    const ingress = {
      trustedIngress: "bridge",
      threeSourceOnly: true,
    } as const;

    // Step 1: the pilot preview card's button enters the submit page.
    const confirmed = await handleFeishuPocEvent(
      cardClick("coupon_oa_confirm", 1),
      ingress,
    );
    expect(confirmed).toMatchObject({ kind: "handled" });
    expect(draft.status).toBe("Confirmed");
    expect(sentCards()[0]).toContain("确认提交正式优惠券 OA");
    expect(sentCards()[0]).toContain("放弃本次提交");

    // Step 2: submitting with the kill switch closed fails visibly, and the
    // draft stays Confirmed so the attempt can be retried after the Gate.
    const blocked = await handleFeishuPocEvent(
      cardClick("coupon_oa_submit", 2),
      ingress,
    );
    expect(blocked).toMatchObject({ kind: "handled" });
    expect(sentCards()[1]).toContain("kill switch is closed");
    expect(draft.status).toBe("Confirmed");

    // Step 3: a repeated confirm click re-delivers the submit card.
    const repeat = await handleFeishuPocEvent(
      cardClick("coupon_oa_confirm", 3),
      ingress,
    );
    expect(repeat).toMatchObject({ kind: "handled" });
    expect(confirmCouponOaDraft).toHaveBeenCalledTimes(1);
    expect(sentCards()[2]).toContain("确认提交正式优惠券 OA");

    // Step 4: the owner abandons the confirmed draft from the submit card.
    const canceled = await handleFeishuPocEvent(
      cardClick("coupon_oa_cancel", 4),
      ingress,
    );
    expect(canceled).toMatchObject({ kind: "handled" });
    expect(draft.status).toBe("Canceled");
    expect(sentCards()[3]).toContain("已结束");

    // Step 5: clicks on the now-dead cards answer with an explicit card.
    const afterCancel = await handleFeishuPocEvent(
      cardClick("coupon_oa_confirm", 5),
      ingress,
    );
    expect(afterCancel).toMatchObject({ kind: "handled" });
    expect(sentCards()[4]).toContain("cannot be confirmed");
  });

  it("keeps a submit in flight converge-safe for impatient double clicks", async () => {
    process.env.FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED = "true";
    const ingress = {
      trustedIngress: "bridge",
      threeSourceOnly: true,
    } as const;

    // The pilot draft was already confirmed and a submit is executing.
    draft.status = "Confirmed";
    await handleFeishuPocEvent(cardClick("coupon_oa_confirm", 1), ingress);

    draft.status = "Submitting";
    vi.mocked(getCouponOaDraft).mockImplementation(async () => draft);

    const doubleClick = await handleFeishuPocEvent(
      cardClick("coupon_oa_submit", 2),
      ingress,
    );
    expect(doubleClick).toMatchObject({ kind: "handled" });
    expect(submitConfirmedCouponOaDraft).not.toHaveBeenCalled();
    expect(sentCards()[1]).toContain("正在提交");
    expect(sentCards()[1]).toContain("请勿重复点击");
  });
});
