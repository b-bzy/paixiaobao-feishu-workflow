import { beforeEach, describe, expect, it, vi } from "vitest";
import { testInstance, testTemplate } from "./test-fixtures";

vi.mock("./client", () => ({ sendFeishuCard: vi.fn() }));
vi.mock("./coupon-oa/draft-store", () => ({
  getCouponOaDraft: vi.fn(),
  listActiveCouponOaDrafts: vi.fn(),
  saveCouponOaDraft: vi.fn(),
  updateCouponOaDraft: vi.fn(),
}));
vi.mock("./coupon-oa/draft-service", () => ({
  attachCouponOaFile: vi.fn(),
  classifyCouponOaAttachment: vi.fn(),
  missingCouponOaAttachments: vi.fn(() => []),
  parseCouponApplicationDraftForm: vi.fn(),
  validateCouponApplicationDraft: vi.fn(),
}));
vi.mock("./coupon-oa/submit-service", () => ({
  confirmCouponOaDraft: vi.fn(),
  submitConfirmedCouponOaDraft: vi.fn(),
}));
vi.mock("./coupon-oa/approval-client", () => ({
  downloadFeishuMessageResource: vi.fn(),
  getFeishuMessageBody: vi.fn(),
  uploadCouponApprovalFile: vi.fn(),
}));
vi.mock("./base-store", () => ({
  getPublishedExpenseTemplate: vi.fn(),
  getTemplateByRecordId: vi.fn(),
  createWorkflowInstance: vi.fn(),
  decideWorkflowInstance: vi.fn(),
}));

import {
  createWorkflowInstance,
  decideWorkflowInstance,
  getPublishedExpenseTemplate,
  getTemplateByRecordId,
} from "./base-store";
import { sendFeishuCard } from "./client";
import {
  downloadFeishuMessageResource,
  getFeishuMessageBody,
  uploadCouponApprovalFile,
} from "./coupon-oa/approval-client";
import {
  attachCouponOaFile,
  classifyCouponOaAttachment,
  missingCouponOaAttachments,
  parseCouponApplicationDraftForm,
  validateCouponApplicationDraft,
} from "./coupon-oa/draft-service";
import {
  getCouponOaDraft,
  listActiveCouponOaDrafts,
  saveCouponOaDraft,
  updateCouponOaDraft,
} from "./coupon-oa/draft-store";
import { submitConfirmedCouponOaDraft } from "./coupon-oa/submit-service";
import { handleFeishuPocEvent, isExpenseInvocation } from "./events";

function couponOaEvent(
  text: string,
  eventId = "event-coupon-oa",
): Record<string, unknown> {
  return {
    header: {
      event_id: eventId,
      event_type: "im.message.receive_v1",
      token: "verify-me",
    },
    event: {
      sender: { sender_id: { open_id: "ou_submitter" } },
      message: { message_type: "text", content: JSON.stringify({ text }) },
    },
  };
}

const couponDraft = {
  recordId: "rec-coupon-draft",
  draftId: "COA-draft",
  ownerOpenId: "ou_submitter",
  status: "Draft" as const,
  schemaVersion: "coupon-oa-submit-schema-v1",
  values: {
    applicationType: "优惠券申请" as const,
    businessMode: "寄卖" as const,
    activityName: "测试活动",
    activityBackground: "测试背景",
    overDeduction: "否" as const,
    overDeductionReason: "",
    estimatedGmvYuan: 10_000,
    estimatedCostYuan: 100,
    channels: ["京东渠道"],
    activityStartAt: "2030-01-01",
    activityEndAt: "2030-01-01",
  },
  attachments: [],
  validationIssues: [],
};

describe("isExpenseInvocation", () => {
  it.each(["发起报销", "我要报销", "帮我报销", "申请报销", "报销申请"])(
    "recognizes %s",
    (text) => {
      expect(isExpenseInvocation(text)).toBe(true);
    },
  );

  it("does not open a form for a status question", () => {
    expect(isExpenseInvocation("我的报销审批到哪了？")).toBe(false);
  });
});

describe("handleFeishuPocEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateCouponApplicationDraft).mockReset();
    process.env.FEISHU_RUNTIME_STAGE = "local";
    process.env.FEISHU_LEGACY_POC_ENABLED = "false";
    process.env.FEISHU_COUPON_OA_MODE = "native-submit";
    process.env.FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED = "true";
    process.env.FEISHU_COUPON_OA_NATIVE_SUBMIT_ALLOWED_OPEN_IDS =
      "ou_submitter";
    process.env.FEISHU_COUPON_OA_ALLOWED_OPEN_IDS = "ou_submitter";
    process.env.FEISHU_VERIFICATION_TOKEN = "verify-me";
    process.env.FEISHU_COUPON_OA_INITIATE_URL =
      "https://applink.feishu.cn/client/mini_program/open?appId=cli_coupon";
    vi.mocked(getPublishedExpenseTemplate).mockResolvedValue(testTemplate);
    vi.mocked(getTemplateByRecordId).mockResolvedValue(testTemplate);
    vi.mocked(createWorkflowInstance).mockResolvedValue(testInstance);
    vi.mocked(parseCouponApplicationDraftForm).mockReturnValue(
      couponDraft.values,
    );
    vi.mocked(saveCouponOaDraft).mockResolvedValue(couponDraft);
    vi.mocked(listActiveCouponOaDrafts).mockResolvedValue([]);
    vi.mocked(missingCouponOaAttachments).mockReturnValue([
      "具体满减测算图片",
      "配券信息表（.xlsx）",
      "商品明细白名单（.xlsx）",
    ]);
  });

  it("opens the configured coupon OA form with the event ID as idempotency key", async () => {
    await handleFeishuPocEvent(
      couponOaEvent("OA优惠券审批", "event-coupon-oa"),
    );

    expect(getPublishedExpenseTemplate).not.toHaveBeenCalled();
    expect(sendFeishuCard).toHaveBeenCalledWith(
      "ou_submitter",
      expect.objectContaining({ schema: "2.0" }),
      "event-coupon-oa",
    );
    expect(
      JSON.stringify(vi.mocked(sendFeishuCard).mock.calls[0]?.[1]),
    ).toContain(process.env.FEISHU_COUPON_OA_INITIATE_URL);
  });

  it("normalizes whitespace in the coupon OA invocation", async () => {
    await handleFeishuPocEvent(couponOaEvent(" OA 优惠券 审批 "));

    expect(sendFeishuCard).toHaveBeenCalledOnce();
  });

  it("opens the system-side coupon draft form", async () => {
    await handleFeishuPocEvent(couponOaEvent(" OA 优 惠 券 填 报 "));

    expect(sendFeishuCard).toHaveBeenCalledWith(
      "ou_submitter",
      expect.objectContaining({ schema: "2.0" }),
      "event-coupon-oa",
    );
    expect(
      JSON.stringify(vi.mocked(sendFeishuCard).mock.calls[0]?.[1]),
    ).toContain("保存草稿并上传材料");
  });

  it("handles the disabled three-source command before legacy workflow lookup", async () => {
    const result = await handleFeishuPocEvent(
      couponOaEvent("/OA优惠券提报", "event-three-source"),
    );

    expect(result).toEqual({
      kind: "handled",
      message: "Coupon three-source pilot is unavailable",
    });
    expect(listActiveCouponOaDrafts).not.toHaveBeenCalled();
    expect(
      JSON.stringify(vi.mocked(sendFeishuCard).mock.calls[0]?.[1]),
    ).toContain("暂未开放");
    expect(sendFeishuCard).toHaveBeenCalledWith(
      "ou_submitter",
      expect.objectContaining({ schema: "2.0" }),
      "event-three-source",
    );
  });

  it("does not execute a legacy synchronous route in a durable runtime stage", async () => {
    process.env.FEISHU_RUNTIME_STAGE = "r2-draft-only";

    await expect(
      handleFeishuPocEvent(couponOaEvent("OA优惠券填报")),
    ).resolves.toEqual({
      kind: "ignored",
      reason:
        "Legacy synchronous Feishu POC routes are disabled outside local runtime",
    });
    expect(listActiveCouponOaDrafts).not.toHaveBeenCalled();
    expect(sendFeishuCard).not.toHaveBeenCalled();
  });

  it("does not start a coupon workflow when the mode is omitted", async () => {
    delete process.env.FEISHU_COUPON_OA_MODE;

    await handleFeishuPocEvent(couponOaEvent("OA优惠券填报"));

    expect(saveCouponOaDraft).not.toHaveBeenCalled();
    expect(
      JSON.stringify(vi.mocked(sendFeishuCard).mock.calls[0]?.[1]),
    ).toContain("当前环境未开放优惠券 OA 工作流");
  });

  it("rejects an unverified public ingress before any side effect", async () => {
    delete process.env.FEISHU_VERIFICATION_TOKEN;

    await expect(
      handleFeishuPocEvent(couponOaEvent("OA优惠券填报")),
    ).rejects.toThrow("FEISHU_VERIFICATION_TOKEN is not configured");
    expect(sendFeishuCard).not.toHaveBeenCalled();
    expect(saveCouponOaDraft).not.toHaveBeenCalled();
  });

  it("accepts an explicitly trusted bridge ingress without a public token", async () => {
    delete process.env.FEISHU_VERIFICATION_TOKEN;

    await handleFeishuPocEvent(couponOaEvent("OA优惠券填报"), {
      trustedIngress: "bridge",
    });

    expect(sendFeishuCard).toHaveBeenCalledOnce();
  });

  it("persists entered fields as a system draft and requests attachments", async () => {
    await handleFeishuPocEvent({
      header: { token: "verify-me" },
      operator: { open_id: "ou_submitter" },
      action: {
        name: "coupon_oa_draft_save",
        form_value: { activityName: "测试活动" },
      },
    });

    expect(parseCouponApplicationDraftForm).toHaveBeenCalledWith({
      activityName: "测试活动",
    });
    expect(saveCouponOaDraft).toHaveBeenCalledWith({
      ownerOpenId: "ou_submitter",
      schemaVersion: "coupon-oa-submit-schema-v1",
      values: couponDraft.values,
    });
    expect(
      JSON.stringify(vi.mocked(sendFeishuCard).mock.calls[0]?.[1]),
    ).toContain("待补材料");
  });

  it("allows the draft owner to end an active coupon OA draft", async () => {
    vi.mocked(getCouponOaDraft).mockResolvedValue(couponDraft);
    vi.mocked(updateCouponOaDraft).mockResolvedValue({
      ...couponDraft,
      status: "Canceled",
    });

    await handleFeishuPocEvent({
      header: { token: "verify-me" },
      operator: { open_id: "ou_submitter" },
      action: {
        value: {
          action: "coupon_oa_cancel",
          draftRecordId: "rec-coupon-draft",
        },
      },
    });

    expect(updateCouponOaDraft).toHaveBeenCalledWith(couponDraft, {
      status: "Canceled",
    });
    expect(
      JSON.stringify(vi.mocked(sendFeishuCard).mock.calls[0]?.[1]),
    ).toContain("OA 草稿已结束");
  });

  it("opens a Base-only form in draft-demo mode", async () => {
    process.env.FEISHU_COUPON_OA_MODE = "draft-demo";

    await handleFeishuPocEvent(couponOaEvent("OA优惠券填报"));

    const card = JSON.stringify(vi.mocked(sendFeishuCard).mock.calls[0]?.[1]);
    expect(card).toContain("保存本地草稿");
    expect(card).toContain("不会接收附件");
    expect(card).not.toContain("保存草稿并上传材料");
  });

  it("saves fixed fields to Base and stops in draft-demo mode", async () => {
    process.env.FEISHU_COUPON_OA_MODE = "draft-demo";

    await handleFeishuPocEvent({
      header: { token: "verify-me" },
      operator: { open_id: "ou_submitter" },
      action: {
        name: "coupon_oa_draft_save",
        form_value: { activityName: "测试活动" },
      },
    });

    expect(saveCouponOaDraft).toHaveBeenCalledWith({
      ownerOpenId: "ou_submitter",
      schemaVersion: "coupon-oa-submit-schema-v1",
      values: couponDraft.values,
    });
    expect(missingCouponOaAttachments).not.toHaveBeenCalled();
    expect(
      JSON.stringify(vi.mocked(sendFeishuCard).mock.calls[0]?.[1]),
    ).toContain("已自动写入 Base 草稿表");
  });

  it("returns a validation card instead of silently failing a local draft save", async () => {
    process.env.FEISHU_COUPON_OA_MODE = "draft-demo";
    vi.mocked(validateCouponApplicationDraft).mockImplementation(() => {
      throw new Error("活动结束日期不能早于开始日期");
    });

    const result = await handleFeishuPocEvent({
      header: { token: "verify-me" },
      operator: { open_id: "ou_submitter" },
      action: {
        name: "coupon_oa_draft_save",
        form_value: { activityName: "测试活动" },
      },
    });

    expect(saveCouponOaDraft).not.toHaveBeenCalled();
    expect(
      JSON.stringify(vi.mocked(sendFeishuCard).mock.calls[0]?.[1]),
    ).toContain("活动结束日期不能早于开始日期");
    expect(result).toEqual({
      kind: "handled",
      message: "Coupon OA draft save failed: 活动结束日期不能早于开始日期",
    });
  });

  it("does not call attachment or approval APIs in draft-demo mode", async () => {
    process.env.FEISHU_COUPON_OA_MODE = "draft-demo";

    await handleFeishuPocEvent({
      header: { event_type: "im.message.receive_v1", token: "verify-me" },
      event: {
        sender: { sender_id: { open_id: "ou_submitter" } },
        message: {
          message_id: "om_attachment",
          message_type: "file",
          content: "配券信息表.xlsx",
        },
      },
    });

    expect(getFeishuMessageBody).not.toHaveBeenCalled();
    expect(downloadFeishuMessageResource).not.toHaveBeenCalled();
    expect(uploadCouponApprovalFile).not.toHaveBeenCalled();
    expect(
      JSON.stringify(vi.mocked(sendFeishuCard).mock.calls[0]?.[1]),
    ).toContain("附件处理、人工确认和正式 OA 提交");
  });

  it("does not look up or submit an approval action in draft-demo mode", async () => {
    process.env.FEISHU_COUPON_OA_MODE = "draft-demo";

    await handleFeishuPocEvent({
      header: { token: "verify-me" },
      operator: { open_id: "ou_submitter" },
      action: {
        value: {
          action: "coupon_oa_submit",
          draftRecordId: "rec-coupon-draft",
        },
      },
    });

    expect(getCouponOaDraft).not.toHaveBeenCalled();
    expect(
      JSON.stringify(vi.mocked(sendFeishuCard).mock.calls[0]?.[1]),
    ).toContain("当前模式仅验证固定字段自动写入 Base");
  });

  it("does not promote source files from the legacy OA workflow", async () => {
    vi.mocked(listActiveCouponOaDrafts).mockResolvedValue([couponDraft]);

    await expect(
      handleFeishuPocEvent({
        header: { event_type: "im.message.receive_v1", token: "verify-me" },
        event: {
          sender: { sender_id: { open_id: "ou_submitter" } },
          message: {
            message_id: "om_attachment",
            message_type: "file",
            content: "配券信息表.xlsx",
          },
        },
      }),
    ).resolves.toEqual({
      kind: "handled",
      message: "Coupon OA source attachment promotion is disabled",
    });

    expect(getFeishuMessageBody).not.toHaveBeenCalled();
    expect(downloadFeishuMessageResource).not.toHaveBeenCalled();
    expect(uploadCouponApprovalFile).not.toHaveBeenCalled();
    expect(attachCouponOaFile).not.toHaveBeenCalled();
    expect(classifyCouponOaAttachment).not.toHaveBeenCalled();
    expect(
      JSON.stringify(vi.mocked(sendFeishuCard).mock.calls[0]?.[1]),
    ).toContain("原始附件直传审批已禁用");
  });

  it("expires a stale OA draft before processing an attachment", async () => {
    const staleDraft = {
      ...couponDraft,
      updatedAt: "2026-09-30T00:00:00.000Z",
    };
    vi.mocked(listActiveCouponOaDrafts).mockResolvedValue([staleDraft]);
    vi.mocked(updateCouponOaDraft).mockResolvedValue({
      ...staleDraft,
      status: "Canceled",
    });

    await handleFeishuPocEvent({
      header: { event_type: "im.message.receive_v1", token: "verify-me" },
      event: {
        sender: { sender_id: { open_id: "ou_submitter" } },
        message: {
          message_id: "om-stale-attachment",
          message_type: "file",
          content: "配券信息表.xlsx",
        },
      },
    });

    expect(updateCouponOaDraft).toHaveBeenCalledWith(staleDraft, {
      status: "Canceled",
    });
    expect(getFeishuMessageBody).not.toHaveBeenCalled();
    expect(downloadFeishuMessageResource).not.toHaveBeenCalled();
    expect(uploadCouponApprovalFile).not.toHaveBeenCalled();
  });

  it("sends a failure card when native OA submission fails", async () => {
    vi.mocked(getCouponOaDraft).mockResolvedValue({
      ...couponDraft,
      status: "Confirmed",
      definitionHash: "definition-hash",
    });
    vi.mocked(submitConfirmedCouponOaDraft).mockRejectedValue(
      new Error("活动开始日期不能早于今天（2026-09-29）"),
    );

    const result = await handleFeishuPocEvent({
      header: { token: "verify-me" },
      operator: { open_id: "ou_submitter" },
      action: {
        value: {
          action: "coupon_oa_submit",
          draftRecordId: "rec-coupon-draft",
        },
      },
    });

    expect(
      JSON.stringify(vi.mocked(sendFeishuCard).mock.calls[0]?.[1]),
    ).toContain("正式 OA 未创建");
    expect(result).toEqual({
      kind: "handled",
      message:
        "Coupon OA submission failed: 活动开始日期不能早于今天（2026-09-29）",
    });
  });

  it("does not open a form for a coupon OA status question", async () => {
    const result = await handleFeishuPocEvent(
      couponOaEvent("我的 OA优惠券审批到哪了？"),
    );

    expect(result).toEqual({
      kind: "ignored",
      reason: "Not a supported invocation",
    });
    expect(sendFeishuCard).not.toHaveBeenCalled();
  });

  it("returns an unavailable card without a link when the OA URL is absent", async () => {
    delete process.env.FEISHU_COUPON_OA_INITIATE_URL;

    await handleFeishuPocEvent(couponOaEvent("OA优惠券审批"));

    const card = JSON.stringify(vi.mocked(sendFeishuCard).mock.calls[0]?.[1]);
    expect(card).toContain("暂不可用");
    expect(card).not.toContain("open_url");
  });

  it("opens the administrator-published expense template", async () => {
    await handleFeishuPocEvent({
      header: {
        event_id: "event-expense-request",
        event_type: "im.message.receive_v1",
        token: "verify-me",
      },
      event: {
        sender: { sender_id: { open_id: "ou_submitter" } },
        message: { message_type: "text", content: '{"text":"发起报销"}' },
      },
    });
    expect(getPublishedExpenseTemplate).toHaveBeenCalledOnce();
    expect(sendFeishuCard).toHaveBeenCalledWith(
      "ou_submitter",
      expect.objectContaining({ schema: "2.0" }),
      "event-expense-request",
    );
  });

  it("falls back to the message ID for idempotent expense delivery", async () => {
    await handleFeishuPocEvent({
      header: { event_type: "im.message.receive_v1", token: "verify-me" },
      event: {
        sender: { sender_id: { open_id: "ou_submitter" } },
        message: {
          message_id: "message-expense-request",
          message_type: "text",
          content: '{"text":"发起报销"}',
        },
      },
    });

    expect(sendFeishuCard).toHaveBeenCalledWith(
      "ou_submitter",
      expect.objectContaining({ schema: "2.0" }),
      "message-expense-request",
    );
  });

  it("creates a versioned workflow instance", async () => {
    await handleFeishuPocEvent({
      header: { token: "verify-me" },
      operator: { open_id: "ou_submitter" },
      action: {
        name: "expense_submit:rec-template:3",
        form_value: {
          title: "客户拜访",
          amount: "150",
          category: "交通",
          description: "打车",
        },
      },
    });
    expect(createWorkflowInstance).toHaveBeenCalledWith({
      template: testTemplate,
      submitterOpenId: "ou_submitter",
      data: testInstance.data,
    });
    expect(sendFeishuCard).toHaveBeenCalledWith(
      "ou_approver",
      expect.objectContaining({ schema: "2.0" }),
    );
  });

  it("tracks approval and notifies the submitter", async () => {
    vi.mocked(decideWorkflowInstance).mockResolvedValue({
      ...testInstance,
      status: "Approved",
    });
    await handleFeishuPocEvent({
      header: { token: "verify-me" },
      operator: { open_id: "ou_approver" },
      action: {
        value: { action: "expense_approve", instanceRecordId: "rec-instance" },
      },
    });
    expect(decideWorkflowInstance).toHaveBeenCalledWith({
      recordId: "rec-instance",
      decision: "Approved",
      operatorOpenId: "ou_approver",
    });
    expect(sendFeishuCard).toHaveBeenCalledWith(
      "ou_submitter",
      expect.objectContaining({ schema: "2.0" }),
    );
  });
});
