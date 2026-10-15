import { createHash } from "node:crypto";
import {
  createCouponApprovalInstance,
  getCouponApprovalDefinition,
  getCouponApprovalInstance,
  getCouponOaApplicantProfile,
} from "./approval-client";
import {
  bindCouponApprovalSchema,
  type CouponOaDraftValues,
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
import {
  type CouponOaDraft,
  getCouponOaDraft,
  persistCouponOaSubmissionOutcome,
  updateCouponOaDraft,
} from "./draft-store";
import {
  type FrozenCouponOaArtifact,
  uploadVerifiedCouponOaArtifacts,
} from "./frozen-artifact-handoff";

function validateValues(draft: CouponOaDraft) {
  const schema =
    draft.values.applicationType === "优惠券申请"
      ? couponApplicationValuesSchema
      : couponModificationValuesSchema;
  const parsed = schema.parse(draft.values);
  if (parsed.applicationType === "优惠券申请") {
    const today = new Date().toISOString().slice(0, 10);
    if (parsed.activityStartAt && parsed.activityStartAt < today) {
      throw new Error(
        `活动开始日期不能早于今天（${today}）；请在「检查并补充活动信息」表单中修正日期后重新提交`,
      );
    }
  }
  return parsed;
}

/** A 4xx rejection from the create endpoint means nothing was created. */
function isDefinitiveCreateRejection(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number" &&
    (error as { status: number }).status >= 400 &&
    (error as { status: number }).status < 500 &&
    (error as { status: number }).status !== 429
  );
}

/**
 * Best-effort identity snapshot. The open ID alone is the stable confirmer
 * identity required for audit; userId / display name / department only
 * enrich the preview card and are omitted when the app lacks contact read
 * scopes (the native approval form auto-fills them from the instance's
 * open_id anyway). An ambiguous multi-department profile degrades the same
 * way instead of blocking confirmation.
 */
async function resolveFinalConfirmerIdentity(draft: CouponOaDraft) {
  const profile = await getCouponOaApplicantProfile(draft.ownerOpenId);
  const departmentOpenId = profile.primaryDepartmentOpenId
    ? profile.departmentOpenIds.includes(profile.primaryDepartmentOpenId)
      ? profile.primaryDepartmentOpenId
      : undefined
    : profile.departmentOpenIds.length === 1
      ? profile.departmentOpenIds[0]
      : undefined;
  return {
    openId: profile.openId,
    ...(profile.userId ? { userId: profile.userId } : {}),
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    ...(departmentOpenId ? { departmentOpenId } : {}),
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

function fileCodesByRole(
  attachments: CouponOaDraft["attachments"],
  role: CouponOaDraft["attachments"][number]["role"],
): string[] {
  return attachments
    .filter((attachment) => attachment.role === role)
    .map((attachment) => attachment.fileCode);
}

/**
 * Re-downloads the frozen Drive artifacts, verifies their bytes and SHA-256,
 * and re-uploads them to obtain fresh approval file codes. Approval file
 * codes minted at handoff time may go stale before the user submits, and a
 * stale code would otherwise only surface as an irrecoverable create
 * failure. Drafts without persisted Drive tokens (legacy message uploads)
 * keep their existing codes.
 */
function toFrozenCouponOaArtifact(
  attachment: CouponOaDraft["attachments"][number],
): FrozenCouponOaArtifact | undefined {
  if (!attachment.fileToken) return undefined;
  switch (attachment.role) {
    case "couponTable":
    case "productWhitelist":
    case "productBlacklist":
    case "calcImage":
      return {
        artifactId: attachment.artifactId,
        order: attachment.order,
        role: attachment.role,
        fileName: attachment.fileName,
        fileToken: attachment.fileToken,
        bytes: attachment.bytes,
        sha256: attachment.sha256,
        contentType: attachment.contentType,
      };
    default:
      return undefined;
  }
}

async function refreshFrozenCouponOaAttachments(
  draft: CouponOaDraft,
): Promise<CouponOaDraft> {
  if (!draft.attachments.length) return draft;
  const artifacts = draft.attachments.map(toFrozenCouponOaArtifact);
  if (artifacts.some((artifact) => !artifact)) return draft;
  const attachments = await uploadVerifiedCouponOaArtifacts({
    artifacts: artifacts.map((artifact) => artifact as FrozenCouponOaArtifact),
  });
  const blacklist = fileCodesByRole(attachments, "productBlacklist");
  const calcImages = fileCodesByRole(attachments, "calcImage");
  const values: CouponOaDraftValues = {
    ...draft.values,
    couponTableFileCodes: fileCodesByRole(attachments, "couponTable"),
    productWhitelistFileCodes: fileCodesByRole(attachments, "productWhitelist"),
    productBlacklistFileCodes: blacklist.length ? blacklist : undefined,
    calcImageFileCodes: calcImages.length ? calcImages : undefined,
  };
  return updateCouponOaDraft(draft, { values, attachments });
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

  validateValues(draft);
  const identity = confirmedIdentity(draft);
  // The guarded Submitting claim narrows the double-submit window to one
  // Base round trip: a concurrent click re-reads a draft that is no longer
  // Confirmed and stops before touching the approval API.
  const submitting = await updateCouponOaDraft(draft, {
    status: "Submitting",
    validationIssues: [],
  });
  const formSource = await refreshFrozenCouponOaAttachments(submitting);
  const form = encodeCouponOaForm(schema, validateValues(formSource), identity);

  let created:
    | Awaited<ReturnType<typeof createCouponApprovalInstance>>
    | undefined;
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
    const persisted = await persistCouponOaSubmissionOutcome(submitting, {
      status: "Submitting",
      approvalInstanceCode: created.instanceCode,
      approvalInstanceLink: created.instanceLink,
    });
    const instance = await getCouponApprovalInstance(created.instanceCode);
    const actual = parseApprovalFormValues(instance.form ?? "[]");
    const verification = diffSubmittedApprovalForm(schema, form, actual, {
      attachmentFileNames: new Map(
        formSource.attachments.map((attachment) => [
          attachment.fileCode,
          attachment.fileName,
        ]),
      ),
    });
    const verificationIssues = [
      ...verification.issues,
      ...verification.needsReview,
    ];
    const needsReview = verificationIssues.length > 0;
    const next = await persistCouponOaSubmissionOutcome(persisted, {
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
      const reviewDraft = await persistCouponOaSubmissionOutcome(submitting, {
        status: "CreatedNeedsReview",
        approvalInstanceCode: created.instanceCode,
        approvalInstanceLink: created.instanceLink,
        failureReason: `Created approval requires review: ${message}`,
        validationIssues: [message],
      });
      return { draft: reviewDraft, verificationIssues: [message] };
    }
    // A synchronous 4xx parameter rejection is definitive: nothing was
    // created, so the draft goes back to Confirmed with the reason instead
    // of being locked into SubmissionUnknown.
    if (isDefinitiveCreateRejection(error)) {
      const rejected = await persistCouponOaSubmissionOutcome(submitting, {
        status: "Confirmed",
        failureReason: `Coupon OA submission rejected: ${message}`,
        validationIssues: [message],
      });
      throw Object.assign(error instanceof Error ? error : new Error(message), {
        draft: rejected,
      });
    }
    // The create outcome is unknown here, but a concurrent attempt may have
    // already created and persisted an instance. Re-read first so its
    // instance code survives instead of being blanked by SubmissionUnknown.
    const reconciled = await getCouponOaDraft(submitting.recordId);
    if (reconciled.approvalInstanceCode) {
      const settled = await persistCouponOaSubmissionOutcome(reconciled, {
        status: "CreatedNeedsReview",
        failureReason: `Concurrent submission created an approval; review required: ${message}`,
        validationIssues: [message],
      });
      return { draft: settled, verificationIssues: [message] };
    }
    const unknown = await persistCouponOaSubmissionOutcome(submitting, {
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
