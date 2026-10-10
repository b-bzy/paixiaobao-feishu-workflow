import type { OaPrefillSnapshot } from "../../../coupon-oa/three-source/types";
import type { CouponOaDraftValues } from "../approval-schema";
import {
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
};

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
  if (values.businessMode !== "严选") {
    throw new Error("三源 Bot 首期仅支持严选业务模式");
  }
  if (
    !Number.isFinite(values.activityPointPercent) ||
    values.activityPointPercent <= 0
  ) {
    throw new Error("请先明确确认 OA 活动点位");
  }
  const couponTable = attachmentByRole(input.attachments, "couponTable");
  const whitelist = attachmentByRole(input.attachments, "productWhitelist");
  const blacklist = attachmentByRole(input.attachments, "productBlacklist");
  if (couponTable.length !== 1 || whitelist.length !== 1) {
    throw new Error("三源 OA 草稿必须包含一份标准配券表和一份标准白名单");
  }
  if (blacklist.length > 1) {
    throw new Error("三源 OA 草稿不能包含多份标准黑名单");
  }
  if (
    input.prefill.attachments.some(
      (attachment) => attachment.role === "calcImage",
    )
  ) {
    throw new Error("严选三源首期不接受测算图片附件");
  }

  return {
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
  };
}

export async function handoffThreeSourcePilotToOaDraft(input: {
  ownerOpenId: string;
  prefill: OaPrefillSnapshot;
  artifacts: FrozenThreeSourceArtifact[];
  oaDraftRecordId?: string;
}): Promise<CouponOaDraft> {
  if (input.oaDraftRecordId) return getCouponOaDraft(input.oaDraftRecordId);

  const active = await listActiveCouponOaDrafts(input.ownerOpenId);
  if (active.length) {
    throw new Error("你已有未完成的优惠券 OA 草稿，请先完成或取消后再自动填写");
  }
  const attachments = await uploadVerifiedCouponOaArtifacts({
    artifacts: input.artifacts,
  });
  const concurrent = await listActiveCouponOaDrafts(input.ownerOpenId);
  if (concurrent.length) {
    throw new Error("自动填写期间产生了另一份优惠券 OA 草稿，已停止以避免覆盖");
  }
  return createCouponOaDraft({
    ownerOpenId: input.ownerOpenId,
    schemaVersion: "coupon-three-source-pilot-v1",
    values: mapThreeSourcePrefillToOaValues({
      prefill: input.prefill,
      attachments,
    }),
    attachments,
  });
}
