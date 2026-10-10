import { createHash } from "node:crypto";
import {
  createCouponApprovalInstance,
  getCouponApprovalDefinition,
  getCouponApprovalInstance,
  getCouponOaApplicantProfile,
} from "./approval-client";
import {
  bindCouponApprovalSchema,
  couponApplicationValuesSchema,
  couponModificationValuesSchema,
  diffSubmittedApprovalForm,
  encodeCouponOaForm,
  parseApprovalFormValues,
} from "./approval-schema";
import {
  assertCouponOaNativeSubmitAllowed,
  getCouponOaApprovalCode,
} from "./config";
import { type CouponOaDraft, updateCouponOaDraft } from "./draft-store";

function validateValues(draft: CouponOaDraft) {
  const schema =
    draft.values.applicationType === "优惠券申请"
      ? couponApplicationValuesSchema
      : couponModificationValuesSchema;
  return schema.parse(draft.values);
}

async function resolveFinalConfirmerIdentity(draft: CouponOaDraft) {
  const profile = await getCouponOaApplicantProfile(draft.ownerOpenId);
  const departmentOpenId = profile.primaryDepartmentOpenId
    ? profile.departmentOpenIds.includes(profile.primaryDepartmentOpenId)
      ? profile.primaryDepartmentOpenId
      : undefined
    : profile.departmentOpenIds.length === 1
      ? profile.departmentOpenIds[0]
      : undefined;
  if (!departmentOpenId) {
    throw new Error(
      "无法唯一确定申请部门；请在飞书中确认主部门后重新发起优惠券 OA",
    );
  }
  return {
    openId: profile.openId,
    userId: profile.userId,
    displayName: profile.displayName,
    departmentOpenId,
    resolvedAt: new Date().toISOString(),
  };
}

function confirmedIdentity(draft: CouponOaDraft) {
  const identity = draft.values.identitySnapshot;
  if (!identity || identity.openId !== draft.ownerOpenId) {
    throw new Error(
      "Confirmed coupon OA draft is missing the final confirmer identity",
    );
  }
  return identity;
}

function approvalRequestUuid(input: {
  draft: CouponOaDraft;
  form: unknown;
}): string {
  const bytes = createHash("sha256")
    .update(
      JSON.stringify({
        draftId: input.draft.draftId,
        definitionHash: input.draft.definitionHash,
        form: input.form,
      }),
    )
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

  assertCouponOaNativeSubmitAllowed(draft.ownerOpenId);
  const approvalCode = getCouponOaApprovalCode();
  const definition = await getCouponApprovalDefinition(approvalCode);
  const schema = bindCouponApprovalSchema(definition);
  if (schema.definitionHash !== draft.definitionHash) {
    throw new Error(
      "Coupon approval definition changed after confirmation; reopen and confirm the draft",
    );
  }

  const values = validateValues(draft);
  const identity = confirmedIdentity(draft);
  const form = encodeCouponOaForm(schema, values, identity);
  const submitting = await updateCouponOaDraft(draft, {
    status: "Submitting",
    validationIssues: [],
  });

  let created:
    | Awaited<ReturnType<typeof createCouponApprovalInstance>>
    | undefined;
  let createdDraft: CouponOaDraft | undefined;
  try {
    created = await createCouponApprovalInstance({
      approvalCode,
      submitterOpenId: submitting.ownerOpenId,
      form,
      uuid: approvalRequestUuid({ draft: submitting, form }),
    });
    // Persist the native instance before any best-effort GET verification. If
    // the readback fails, the draft must not become retryable and create a
    // duplicate approval.
    createdDraft = await updateCouponOaDraft(submitting, {
      status: "Submitting",
      approvalInstanceCode: created.instanceCode,
      approvalInstanceLink: created.instanceLink,
    });
    const instance = await getCouponApprovalInstance(created.instanceCode);
    const actual = parseApprovalFormValues(instance.form ?? "[]");
    const verification = diffSubmittedApprovalForm(schema, form, actual);
    const verificationIssues = [
      ...verification.issues,
      ...verification.needsReview,
    ];
    const needsReview = verificationIssues.length > 0;
    const next = await updateCouponOaDraft(createdDraft, {
      status: needsReview ? "CreatedNeedsReview" : "Submitted",
      failureReason: needsReview
        ? `Created approval requires review: ${verificationIssues.join("; ")}`
        : undefined,
      validationIssues: verificationIssues,
    });
    return { draft: next, verificationIssues };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown submission error";
    if (created) {
      const reviewDraft = await updateCouponOaDraft(
        createdDraft ?? submitting,
        {
          status: "CreatedNeedsReview",
          approvalInstanceCode: created.instanceCode,
          approvalInstanceLink: created.instanceLink,
          failureReason: `Created approval requires review: ${message}`,
          validationIssues: [message],
        },
      );
      return { draft: reviewDraft, verificationIssues: [message] };
    }
    const unknown = await updateCouponOaDraft(submitting, {
      status: "SubmissionUnknown",
      failureReason: `Coupon OA create outcome requires reconciliation: ${message}`,
      validationIssues: [message],
    });
    throw Object.assign(
      error instanceof Error
        ? error
        : new Error("Coupon OA submission outcome unknown"),
      { draft: unknown },
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
  const identitySnapshot = await resolveFinalConfirmerIdentity(draft);
  return updateCouponOaDraft(draft, {
    status: "Confirmed",
    definitionHash: schema.definitionHash,
    values: { ...draft.values, identitySnapshot },
    confirmedAt: new Date().toISOString(),
    validationIssues: [],
    failureReason: undefined,
  });
}
