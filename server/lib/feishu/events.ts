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
import { couponApprovalSchemaVersion } from "./coupon-oa/approval-schema";
import {
  buildCouponOaAttachmentRequestCard,
  buildCouponOaDraftDemoUnavailableCard,
  buildCouponOaDraftErrorCard,
  buildCouponOaDraftFormCard,
  buildCouponOaDraftSavedCard,
  buildCouponOaEntryCard,
  buildCouponOaPreviewCard,
  buildCouponOaSubmissionResultCard,
  buildCouponOaSubmitCard,
  buildCouponOaUnavailableCard,
} from "./coupon-oa/cards";
import {
  getCouponOaInitiateUrl,
  isCouponOaDraftDemo,
  isCouponOaDraftInvocation,
  isCouponOaInvocation,
} from "./coupon-oa/config";
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
import {
  confirmCouponOaDraft,
  submitConfirmedCouponOaDraft,
} from "./coupon-oa/submit-service";
import {
  buildExpenseApprovalCard,
  buildExpenseFormCard,
  buildExpenseResultCard,
  parseExpenseFormValue,
} from "./expense-poc";

export interface Envelope {
  challenge?: string;
  token?: string;
  header?: { event_id?: string; event_type?: string; token?: string };
  event?: {
    sender?: { sender_id?: { open_id?: string } };
    message?: { message_id?: string; message_type?: string; content?: string };
  };
  action?: { name?: string; value?: unknown; form_value?: unknown };
  operator?: { open_id?: string; operator_id?: { open_id?: string } };
}
export type FeishuPocResult =
  | { kind: "challenge"; challenge: string }
  | { kind: "ignored"; reason: string }
  | { kind: "handled"; message: string };

const operatorId = (p: Envelope) =>
  p.operator?.open_id ?? p.operator?.operator_id?.open_id;

const eventId = (p: Envelope) =>
  p.header?.event_id ?? p.event?.message?.message_id;

const EXPENSE_INVOCATION_PATTERNS = [
  "发起报销",
  "申请报销",
  "我要报销",
  "帮我报销",
  "报销申请",
];

export function isExpenseInvocation(text: string): boolean {
  const normalized = text.replace(/\s+/g, "");
  return EXPENSE_INVOCATION_PATTERNS.some((pattern) =>
    normalized.includes(pattern),
  );
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object")
    return value as Record<string, unknown>;
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function draftPreviewCard(draft: Awaited<ReturnType<typeof getCouponOaDraft>>) {
  return buildCouponOaPreviewCard({
    draftRecordId: draft.recordId,
    values: draft.values,
    attachments: draft.attachments,
    missing: missingCouponOaAttachments(draft),
  });
}

async function handleCouponOaAttachment(input: {
  openId: string;
  messageId: string;
  messageType: "image" | "file";
}): Promise<string> {
  const message = await getFeishuMessageBody({ messageId: input.messageId });
  if (message.messageType !== input.messageType) {
    throw new Error("Feishu attachment message type changed before processing");
  }
  const content = objectValue(message.content);
  const fileKey = String(
    input.messageType === "image"
      ? (content?.image_key ?? "")
      : (content?.file_key ?? ""),
  );
  if (!fileKey) return "Coupon OA attachment did not include a file key";
  const drafts = await listActiveCouponOaDrafts(input.openId);
  const draft = drafts[0];
  if (!draft) {
    await sendFeishuCard(
      input.openId,
      buildCouponOaAttachmentRequestCard({
        draftId: "未找到草稿",
        missing: ["请先发送 OA优惠券填报，再填写并保存申请信息"],
      }),
    );
    return "Coupon OA attachment received without a draft";
  }

  const name = String(
    input.messageType === "image"
      ? (content?.image_name ?? "满减测算图片.png")
      : (content?.file_name ?? "未命名附件"),
  );
  const bytes = await downloadFeishuMessageResource({
    messageId: input.messageId,
    fileKey,
    type: input.messageType,
  });
  const attachment = classifyCouponOaAttachment({
    messageType: input.messageType,
    name,
    fileCode: await uploadCouponApprovalFile({
      name,
      type: input.messageType === "image" ? "image" : "attachment",
      contentType:
        input.messageType === "image"
          ? "image/png"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes,
    }),
    bytes,
  });
  const next = await updateCouponOaDraft(
    draft,
    attachCouponOaFile(draft, attachment),
  );
  const missing = missingCouponOaAttachments(next);
  if (missing.length) {
    await sendFeishuCard(
      input.openId,
      buildCouponOaAttachmentRequestCard({ draftId: next.draftId, missing }),
    );
  } else {
    await sendFeishuCard(input.openId, draftPreviewCard(next));
  }
  return `Coupon OA attachment saved to ${next.draftId}`;
}

export async function handleFeishuPocEvent(
  payload: Envelope,
): Promise<FeishuPocResult> {
  const expected = process.env.FEISHU_VERIFICATION_TOKEN;
  if (expected && (payload.token ?? payload.header?.token) !== expected)
    throw new Error("Invalid Feishu verification token");
  if (payload.challenge)
    return { kind: "challenge", challenge: payload.challenge };

  const draftDemo = isCouponOaDraftDemo();

  if (payload.header?.event_type === "im.message.receive_v1") {
    const openId = payload.event?.sender?.sender_id?.open_id;
    const message = payload.event?.message;
    if (!openId || !message?.message_type || !message.content)
      return { kind: "ignored", reason: "Unsupported message" };
    const idempotencyKey = eventId(payload);

    if (["image", "file"].includes(message.message_type)) {
      if (draftDemo) {
        await sendFeishuCard(
          openId,
          buildCouponOaDraftDemoUnavailableCard(),
          idempotencyKey,
        );
        return {
          kind: "handled",
          message: "Coupon OA draft demo ignored an attachment",
        };
      }
      if (!message.message_id) {
        return { kind: "ignored", reason: "Attachment message ID is missing" };
      }
      const result = await handleCouponOaAttachment({
        openId,
        messageId: message.message_id,
        messageType: message.message_type as "image" | "file",
      });
      return { kind: "handled", message: result };
    }

    if (message.message_type !== "text")
      return { kind: "ignored", reason: "Unsupported message" };
    const text =
      (objectValue(message.content)?.text as string | undefined) ?? "";

    if (isCouponOaDraftInvocation(text)) {
      await sendFeishuCard(
        openId,
        buildCouponOaDraftFormCard({ draftDemo }),
        idempotencyKey,
      );
      return { kind: "handled", message: "Coupon OA draft form opened" };
    }

    if (isCouponOaInvocation(text)) {
      let initiateUrl: string;
      try {
        initiateUrl = getCouponOaInitiateUrl();
      } catch (error) {
        console.error("Coupon OA entry is unavailable:", error);
        await sendFeishuCard(
          openId,
          buildCouponOaUnavailableCard(),
          idempotencyKey,
        );
        return { kind: "handled", message: "Coupon OA entry is unavailable" };
      }

      await sendFeishuCard(
        openId,
        buildCouponOaEntryCard(initiateUrl),
        idempotencyKey,
      );
      return { kind: "handled", message: "Coupon OA entry opened" };
    }

    if (!isExpenseInvocation(text))
      return { kind: "ignored", reason: "Not a supported invocation" };
    const template = await getPublishedExpenseTemplate();
    if (idempotencyKey) {
      await sendFeishuCard(
        openId,
        buildExpenseFormCard(template),
        idempotencyKey,
      );
    } else {
      await sendFeishuCard(openId, buildExpenseFormCard(template));
    }
    return { kind: "handled", message: "Published expense template opened" };
  }

  const openId = operatorId(payload);
  if (!openId) return { kind: "ignored", reason: "Missing operator" };
  const form = objectValue(payload.action?.form_value);
  const name = payload.action?.name ?? "";
  if (form && name === "coupon_oa_draft_save") {
    let draft: Awaited<ReturnType<typeof saveCouponOaDraft>>;
    try {
      const values = parseCouponApplicationDraftForm(form);
      validateCouponApplicationDraft(values);
      draft = await saveCouponOaDraft({
        ownerOpenId: openId,
        schemaVersion: couponApprovalSchemaVersion,
        values,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "无法保存本地草稿，请稍后重试";
      await sendFeishuCard(openId, buildCouponOaDraftErrorCard({ message }));
      return {
        kind: "handled",
        message: `Coupon OA draft save failed: ${message}`,
      };
    }

    if (draftDemo) {
      await sendFeishuCard(
        openId,
        buildCouponOaDraftSavedCard({ draftId: draft.draftId }),
      );
      return {
        kind: "handled",
        message: `Saved coupon OA draft ${draft.draftId}`,
      };
    }
    await sendFeishuCard(
      openId,
      buildCouponOaAttachmentRequestCard({
        draftId: draft.draftId,
        missing: missingCouponOaAttachments(draft),
      }),
    );
    return {
      kind: "handled",
      message: `Saved coupon OA draft ${draft.draftId}`,
    };
  }

  if (form && name.startsWith("expense_submit:")) {
    const [, recordId, version] = name.split(":");
    const template = await getTemplateByRecordId(recordId);
    if (template.version !== Number(version))
      throw new Error("Template version changed; reopen the form");
    const instance = await createWorkflowInstance({
      template,
      submitterOpenId: openId,
      data: parseExpenseFormValue(form),
    });
    await sendFeishuCard(
      instance.approverOpenId,
      buildExpenseApprovalCard(instance),
    );
    return { kind: "handled", message: `Created ${instance.instanceId}` };
  }

  const value = objectValue(payload.action?.value);
  const action = String(value?.action ?? "");
  const couponDraftRecordId = String(value?.draftRecordId ?? "");
  if (
    couponDraftRecordId &&
    ["coupon_oa_confirm", "coupon_oa_submit"].includes(action)
  ) {
    if (draftDemo) {
      await sendFeishuCard(openId, buildCouponOaDraftDemoUnavailableCard());
      return {
        kind: "handled",
        message: "Coupon OA draft demo ignored an approval action",
      };
    }
    const draft = await getCouponOaDraft(couponDraftRecordId);
    if (draft.ownerOpenId !== openId) {
      throw new Error(
        "Only the coupon OA draft owner can confirm or submit it",
      );
    }
    if (action === "coupon_oa_confirm") {
      const missing = missingCouponOaAttachments(draft);
      if (missing.length) {
        await sendFeishuCard(
          openId,
          buildCouponOaAttachmentRequestCard({
            draftId: draft.draftId,
            missing,
          }),
        );
        return {
          kind: "handled",
          message: "Coupon OA draft is missing attachments",
        };
      }
      const confirmed = await confirmCouponOaDraft(draft);
      await sendFeishuCard(
        openId,
        buildCouponOaSubmitCard({
          draftRecordId: confirmed.recordId,
          values: confirmed.values,
          attachments: confirmed.attachments,
        }),
      );
      return {
        kind: "handled",
        message: `Confirmed coupon OA draft ${confirmed.draftId}`,
      };
    }

    const result = await submitConfirmedCouponOaDraft(draft);
    await sendFeishuCard(
      openId,
      buildCouponOaSubmissionResultCard({
        instanceLink: result.draft.approvalInstanceLink,
        verificationIssues: result.verificationIssues,
      }),
    );
    return {
      kind: "handled",
      message: `Submitted coupon OA ${result.draft.approvalInstanceCode ?? ""}`,
    };
  }

  const expenseRecordId = String(value?.instanceRecordId ?? "");
  if (
    !expenseRecordId ||
    !["expense_approve", "expense_reject"].includes(action)
  )
    return { kind: "ignored", reason: "Unsupported callback" };
  const instance = await decideWorkflowInstance({
    recordId: expenseRecordId,
    decision: action === "expense_approve" ? "Approved" : "Rejected",
    operatorOpenId: openId,
  });
  await sendFeishuCard(
    instance.submitterOpenId,
    buildExpenseResultCard(instance),
  );
  return {
    kind: "handled",
    message: `${instance.instanceId} ${instance.status}`,
  };
}
