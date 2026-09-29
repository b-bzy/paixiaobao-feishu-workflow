import { randomUUID } from "node:crypto";
import {
  createCouponApprovalInstance,
  getCouponApprovalDefinition,
  getCouponApprovalInstance,
} from "./approval-client";
import {
  bindCouponApprovalSchema,
  couponApplicationValuesSchema,
  couponModificationValuesSchema,
  diffSubmittedApprovalForm,
  encodeCouponOaForm,
  parseApprovalFormValues,
} from "./approval-schema";
import { getCouponOaApprovalCode } from "./config";
import { type CouponOaDraft, updateCouponOaDraft } from "./draft-store";

function validateValues(draft: CouponOaDraft) {
  const schema =
    draft.values.applicationType === "优惠券申请"
      ? couponApplicationValuesSchema
      : couponModificationValuesSchema;
  return schema.parse(draft.values);
}

export interface CouponOaSubmissionResult {
  draft: CouponOaDraft;
  verificationIssues: string[];
}

/**
 * Creates a native approval only from a frozen confirmation snapshot. The
 * approval definition is fetched again immediately before the write; any
 * change since confirmation fails closed rather than risking a wrong control.
 */
export async function submitConfirmedCouponOaDraft(
  draft: CouponOaDraft,
): Promise<CouponOaSubmissionResult> {
  if (draft.status !== "Confirmed") {
    throw new Error("Only confirmed coupon OA drafts can be submitted");
  }
  if (!draft.definitionHash) {
    throw new Error("Confirmed coupon OA draft is missing a definition hash");
  }

  const approvalCode = getCouponOaApprovalCode();
  const definition = await getCouponApprovalDefinition(approvalCode);
  const schema = bindCouponApprovalSchema(definition);
  if (schema.definitionHash !== draft.definitionHash) {
    throw new Error(
      "Coupon approval definition changed after confirmation; reopen and confirm the draft",
    );
  }

  const values = validateValues(draft);
  const form = encodeCouponOaForm(schema, values, {
    openId: draft.ownerOpenId,
  });
  const submitting = await updateCouponOaDraft(draft, {
    status: "Submitting",
    validationIssues: [],
  });

  try {
    const created = await createCouponApprovalInstance({
      approvalCode,
      submitterOpenId: submitting.ownerOpenId,
      form,
      uuid: randomUUID(),
    });
    const instance = await getCouponApprovalInstance(created.instanceCode);
    const actual = parseApprovalFormValues(instance.form ?? "[]");
    const verificationIssues = diffSubmittedApprovalForm(form, actual);
    const status = verificationIssues.length ? "Failed" : "Submitted";
    const next = await updateCouponOaDraft(submitting, {
      status,
      approvalInstanceCode: created.instanceCode,
      approvalInstanceLink: created.instanceLink,
      failureReason: verificationIssues.length
        ? `Created approval requires review: ${verificationIssues.join("; ")}`
        : undefined,
      validationIssues: verificationIssues,
    });
    return { draft: next, verificationIssues };
  } catch (error) {
    const failed = await updateCouponOaDraft(submitting, {
      status: "Failed",
      failureReason:
        error instanceof Error ? error.message : "Unknown submission error",
    });
    throw Object.assign(
      error instanceof Error ? error : new Error("Coupon OA submission failed"),
      {
        draft: failed,
      },
    );
  }
}

/** Freezes a fully valid draft against the current native approval definition. */
export async function confirmCouponOaDraft(
  draft: CouponOaDraft,
): Promise<CouponOaDraft> {
  if (!["Draft", "Validated", "Failed"].includes(draft.status)) {
    throw new Error(
      "Coupon OA draft cannot be confirmed in its current status",
    );
  }
  validateValues(draft);
  const definition = await getCouponApprovalDefinition(
    getCouponOaApprovalCode(),
  );
  const schema = bindCouponApprovalSchema(definition);
  return updateCouponOaDraft(draft, {
    status: "Confirmed",
    definitionHash: schema.definitionHash,
    confirmedAt: new Date().toISOString(),
    validationIssues: [],
    failureReason: undefined,
  });
}
