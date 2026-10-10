import {
  type CouponOaDraftValues,
  couponApprovalSchemaVersion,
} from "./approval-schema";
import {
  type CouponOaAttachment,
  type CouponOaDraft,
  createCouponOaDraft,
  getCouponOaDraft,
  listActiveCouponOaDrafts,
} from "./draft-store";
import { computeCouponPilotValues } from "./excel-pilot-schema";
import {
  type CouponExcelPilotArtifact,
  type CouponExcelPilotDraft,
  updateCouponExcelPilotDraft,
} from "./excel-pilot-store";
import { uploadVerifiedCouponOaArtifacts } from "./frozen-artifact-handoff";

function artifactByRole(
  artifacts: CouponExcelPilotArtifact[],
  role: CouponExcelPilotArtifact["role"],
): CouponExcelPilotArtifact {
  const matches = artifacts.filter((artifact) => artifact.role === role);
  if (matches.length !== 1) {
    throw new Error(
      `已确认的 Excel 必须恰好包含一份${role === "couponTable" ? "配券表" : "白名单"}`,
    );
  }
  return matches[0];
}

export function mapCouponPilotToOaValues(
  input: CouponExcelPilotDraft["input"],
  inputAttachments: CouponOaAttachment[],
): CouponOaDraftValues {
  if (!input) throw new Error("Excel 试点草稿缺少已确认的优惠券字段");
  const couponTable = inputAttachments.filter(
    (attachment) => attachment.role === "couponTable",
  );
  const whitelist = inputAttachments.filter(
    (attachment) => attachment.role === "productWhitelist",
  );
  if (couponTable.length !== 1 || whitelist.length !== 1) {
    throw new Error("OA 草稿必须包含一份配券表和一份白名单");
  }
  const computed = computeCouponPilotValues(input);
  if (input.activityPointPercent === undefined) {
    throw new Error("请先明确确认 OA 活动点位，不能按优惠比例自动推断");
  }
  const channels = input.channels.map((channel) =>
    channel === "JD" ? "京东渠道" : "严选APP及小程序",
  );

  return {
    applicationType: "优惠券申请",
    businessMode: input.businessMode,
    activityName: input.activityName,
    activityBackground: input.activityBackground,
    activityPointPercent: input.activityPointPercent,
    platformBearingPercent: input.platformBearingRatio * 100,
    overDeduction: input.overDeduction,
    ...(input.overDeduction === "是"
      ? { overDeductionReason: input.overDeductionReason }
      : {}),
    estimatedGmvYuan: input.estimatedGmvYuan,
    estimatedCostYuan: computed.estimatedCostYuan,
    channels,
    activityStartAt: input.activityStartAt,
    activityEndAt: input.activityEndAt,
    couponTableFileCodes: [couponTable[0].fileCode],
    productWhitelistFileCodes: [whitelist[0].fileCode],
  };
}

function assertHandoffStartable(draft: CouponExcelPilotDraft): void {
  if (
    ![
      "AwaitingOutputConfirmation",
      "HandingOffToOa",
      "RetryableFailure",
    ].includes(draft.status)
  ) {
    throw new Error("当前 Excel 草稿不能自动填写 OA");
  }
  if (!draft.input || draft.artifacts.length !== 2) {
    throw new Error("请先确认包含两份 Excel 的生成结果");
  }
  artifactByRole(draft.artifacts, "couponTable");
  artifactByRole(draft.artifacts, "productWhitelist");
}

/**
 * Freezes the generated artifacts for OA handoff before any remote approval-file
 * upload. A repeated callback can therefore resume an interrupted handoff, but
 * never starts a second OA draft after one is recorded.
 */
export async function beginCouponPilotOaHandoff(
  draft: CouponExcelPilotDraft,
): Promise<CouponExcelPilotDraft> {
  assertHandoffStartable(draft);
  if (draft.oaHandoff?.oaDraftRecordId) return draft;
  if (draft.status === "HandingOffToOa") return draft;
  return updateCouponExcelPilotDraft(draft, {
    status: "HandingOffToOa",
    oaHandoff: draft.oaHandoff ?? {},
    validationIssues: [],
    failureReason: undefined,
  });
}

export interface CouponPilotOaHandoffResult {
  pilot: CouponExcelPilotDraft;
  oaDraft: CouponOaDraft;
}

/** Creates exactly one legacy system draft; it never creates a native approval. */
export async function handoffCouponPilotToOaDraft(
  draft: CouponExcelPilotDraft,
): Promise<CouponPilotOaHandoffResult> {
  assertHandoffStartable(draft);
  if (draft.oaHandoff?.oaDraftRecordId) {
    return {
      pilot: draft,
      oaDraft: await getCouponOaDraft(draft.oaHandoff.oaDraftRecordId),
    };
  }

  let progress = draft;
  try {
    const existing = await listActiveCouponOaDrafts(draft.ownerOpenId);
    if (existing.length) {
      throw new Error(
        "你已有未完成的优惠券 OA 草稿，请先完成或取消后再自动填写",
      );
    }

    let attachments = progress.oaHandoff?.approvalAttachments;
    if (!attachments?.length) {
      const couponArtifact = artifactByRole(progress.artifacts, "couponTable");
      const whitelistArtifact = artifactByRole(
        progress.artifacts,
        "productWhitelist",
      );
      attachments = await uploadVerifiedCouponOaArtifacts({
        artifacts: [couponArtifact, whitelistArtifact],
      });
      progress = await updateCouponExcelPilotDraft(progress, {
        status: "HandingOffToOa",
        oaHandoff: { approvalAttachments: attachments },
        validationIssues: [],
        failureReason: undefined,
      });
    }

    const concurrentDrafts = await listActiveCouponOaDrafts(draft.ownerOpenId);
    if (concurrentDrafts.length) {
      throw new Error(
        "自动填写期间产生了另一份优惠券 OA 草稿，已停止以避免覆盖",
      );
    }
    const oaDraft = await createCouponOaDraft({
      ownerOpenId: progress.ownerOpenId,
      schemaVersion: couponApprovalSchemaVersion,
      values: mapCouponPilotToOaValues(progress.input, attachments),
      attachments,
    });
    const pilot = await updateCouponExcelPilotDraft(progress, {
      status: "GeneratedConfirmed",
      oaHandoff: {
        approvalAttachments: attachments,
        oaDraftRecordId: oaDraft.recordId,
      },
      validationIssues: [],
      failureReason: undefined,
    });
    return { pilot, oaDraft };
  } catch (error) {
    if (progress.oaHandoff?.oaDraftRecordId) throw error;
    const message = error instanceof Error ? error.message : "自动填写 OA 失败";
    let retryDraft: CouponExcelPilotDraft | undefined;
    try {
      retryDraft = await updateCouponExcelPilotDraft(progress, {
        status: "RetryableFailure",
        failureReason: message,
      });
    } catch {
      // Preserve the primary handoff error when Base itself is unavailable.
    }
    throw Object.assign(error instanceof Error ? error : new Error(message), {
      pilot: retryDraft,
    });
  }
}
