import { createHash } from "node:crypto";
import { PostgresCouponThreeSourceHandoffRepository } from "../../../control-plane/postgres-coupon-three-source-handoff-repository";
import { getControlPlaneDatabase } from "../../../control-plane/postgres-sql-database";
import type { OaPrefillSnapshot } from "../../../coupon-oa/three-source/types";
import {
  type CouponOaDraftValues,
  couponApplicationValuesSchema,
} from "../approval-schema";
import { assertCouponOaDraftStoreConfigured } from "../config";
import {
  COUPON_OA_THREE_SOURCE_PILOT_SCHEMA_VERSION,
  type CouponOaDraft,
  createCouponOaDraft,
  getCouponOaDraft,
  listActiveCouponOaDrafts,
} from "../draft-store";
import {
  type FrozenCouponOaArtifact,
  uploadVerifiedCouponOaArtifacts,
} from "../frozen-artifact-handoff";

export type FrozenThreeSourceArtifact = FrozenCouponOaArtifact & {
  templateId: string;
  templateVersion: string;
  /** Pilot owner who was granted Drive view permission for in-card preview. */
  previewGrantedFor?: string;
  /** Last preview grant failure reason; the preview entry stays hidden. */
  previewGrantError?: string;
};

export function buildThreeSourceOaDraftIdentity(input: {
  taskId: string;
  revision: number;
  confirmationSnapshotHash: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        taskId: input.taskId,
        revision: input.revision,
        confirmationSnapshotHash: input.confirmationSnapshotHash,
      }),
    )
    .digest("hex");
}

function draftIdForIdentity(sourceIdentity: string): string {
  return `COA-3S-${sourceIdentity}`;
}

function durableHandoffRepository():
  | PostgresCouponThreeSourceHandoffRepository
  | undefined {
  return /^postgres(?:ql)?:\/\//iu.test(process.env.DATABASE_URL?.trim() ?? "")
    ? new PostgresCouponThreeSourceHandoffRepository(getControlPlaneDatabase())
    : undefined;
}

function attachmentByRole(
  attachments: Awaited<ReturnType<typeof uploadVerifiedCouponOaArtifacts>>,
  role: FrozenCouponOaArtifact["role"],
) {
  return attachments.filter((attachment) => attachment.role === role);
}

export function mapThreeSourcePrefillToOaValues(input: {
  prefill: OaPrefillSnapshot;
  attachments: Awaited<ReturnType<typeof uploadVerifiedCouponOaArtifacts>>;
}): CouponOaDraftValues {
  const { values } = input.prefill;
  if (
    !Number.isFinite(values.activityPointPercent) ||
    values.activityPointPercent <= 0
  ) {
    throw new Error("请先明确确认 OA 活动点位");
  }
  const couponTable = attachmentByRole(input.attachments, "couponTable");
  const whitelist = attachmentByRole(input.attachments, "productWhitelist");
  const blacklist = attachmentByRole(input.attachments, "productBlacklist");
  const calcImages = attachmentByRole(input.attachments, "calcImage").sort(
    (left, right) => (left.order ?? 0) - (right.order ?? 0),
  );
  const prefillImages = input.prefill.attachments
    .filter((attachment) => attachment.role === "calcImage")
    .sort((left, right) => left.order - right.order);
  if (couponTable.length !== 1 || whitelist.length !== 1) {
    throw new Error("三源 OA 草稿必须包含一份标准配券表和一份标准白名单");
  }
  if (blacklist.length > 1) {
    throw new Error("三源 OA 草稿不能包含多份标准黑名单");
  }
  if (
    values.businessMode === "严选" &&
    (prefillImages.length || calcImages.length)
  ) {
    throw new Error("严选业务模式不能包含测算图片附件");
  }
  if (values.businessMode !== "严选" && !calcImages.length) {
    throw new Error("寄卖或 POP 业务模式必须包含测算图片附件");
  }
  if (
    prefillImages.length !== calcImages.length ||
    prefillImages.some(
      (image, index) =>
        image.artifactId !== calcImages[index]?.artifactId ||
        image.order !== calcImages[index]?.order ||
        image.sha256 !== calcImages[index]?.sha256,
    )
  ) {
    throw new Error("测算图片预填快照与审批上传结果不一致");
  }

  return couponApplicationValuesSchema.parse({
    applicationType: "优惠券申请",
    businessMode: values.businessMode,
    activityName: values.activityName,
    activityBackground: values.activityBackground,
    activityPointPercent: values.activityPointPercent,
    platformBearingPercent: values.platformBearingPercent,
    overDeduction: values.overDeduction,
    ...(values.overDeduction === "是"
      ? { overDeductionReason: values.overDeductionReason }
      : {}),
    estimatedGmvYuan: values.estimatedGmvYuan,
    estimatedCostYuan: values.estimatedCostYuan,
    channels: values.channels.map((channel) =>
      channel === "JD" ? "京东渠道" : "严选APP及小程序",
    ),
    activityStartAt: values.activityStartAt,
    activityEndAt: values.activityEndAt,
    couponTableFileCodes: [couponTable[0].fileCode],
    productWhitelistFileCodes: [whitelist[0].fileCode],
    ...(blacklist.length
      ? { productBlacklistFileCodes: [blacklist[0].fileCode] }
      : {}),
    ...(calcImages.length
      ? { calcImageFileCodes: calcImages.map((image) => image.fileCode) }
      : {}),
  });
}

export async function handoffThreeSourcePilotToOaDraft(input: {
  ownerOpenId: string;
  taskId: string;
  prefill: OaPrefillSnapshot;
  artifacts: FrozenThreeSourceArtifact[];
  oaDraftRecordId?: string;
}): Promise<CouponOaDraft> {
  assertCouponOaDraftStoreConfigured();
  const sourceIdentity = buildThreeSourceOaDraftIdentity({
    taskId: input.taskId,
    revision: input.prefill.revision,
    confirmationSnapshotHash: input.prefill.snapshotHash,
  });
  const identityDraftId = draftIdForIdentity(sourceIdentity);
  const handoffRepository = durableHandoffRepository();
  const intent = await handoffRepository?.prepare({
    sourceIdentity,
    taskId: input.taskId,
    revision: input.prefill.revision,
    confirmationSnapshotHash: input.prefill.snapshotHash,
  });
  if (intent?.state === "created" && intent.oaDraftRecordId) {
    return getCouponOaDraft(intent.oaDraftRecordId);
  }
  if (input.oaDraftRecordId) {
    const existing = await getCouponOaDraft(input.oaDraftRecordId);
    if (existing.draftId !== identityDraftId) {
      throw new Error(
        "已有 OA 测试稿不属于当前 revision，请重新生成最新测试稿",
      );
    }
    return existing;
  }

  const active = await listActiveCouponOaDrafts(input.ownerOpenId);
  const exact = active.find((draft) => draft.draftId === identityDraftId);
  if (exact) {
    await handoffRepository?.markCreated({
      sourceIdentity,
      oaDraftRecordId: exact.recordId,
    });
    return getCouponOaDraft(exact.recordId);
  }
  if (active.length) {
    throw new Error("你已有未完成的优惠券 OA 草稿，请先完成或取消后再自动填写");
  }
  const attachments = await uploadVerifiedCouponOaArtifacts({
    artifacts: input.artifacts,
  });
  const concurrent = await listActiveCouponOaDrafts(input.ownerOpenId);
  const reconciled = concurrent.find(
    (draft) => draft.draftId === identityDraftId,
  );
  if (reconciled) {
    await handoffRepository?.markCreated({
      sourceIdentity,
      oaDraftRecordId: reconciled.recordId,
    });
    return getCouponOaDraft(reconciled.recordId);
  }
  if (concurrent.length) {
    throw new Error("自动填写期间产生了另一份优惠券 OA 草稿，已停止以避免覆盖");
  }
  try {
    const created = await createCouponOaDraft({
      ownerOpenId: input.ownerOpenId,
      draftId: identityDraftId,
      schemaVersion: COUPON_OA_THREE_SOURCE_PILOT_SCHEMA_VERSION,
      values: mapThreeSourcePrefillToOaValues({
        prefill: input.prefill,
        attachments,
      }),
      attachments,
    });
    await handoffRepository?.markCreated({
      sourceIdentity,
      oaDraftRecordId: created.recordId,
    });
    return created;
  } catch (error) {
    const readback = (await listActiveCouponOaDrafts(input.ownerOpenId)).find(
      (draft) => draft.draftId === identityDraftId,
    );
    if (readback) {
      await handoffRepository?.markCreated({
        sourceIdentity,
        oaDraftRecordId: readback.recordId,
      });
      return getCouponOaDraft(readback.recordId);
    }
    await handoffRepository?.markOutcomeUnknown({
      sourceIdentity,
      errorCode: "OA_DRAFT_CREATE_OUTCOME_UNKNOWN",
    });
    throw error;
  }
}
