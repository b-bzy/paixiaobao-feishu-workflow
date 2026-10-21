import {
  type CouponThreeSourceActionClaim,
  couponThreeSourceActionSemanticKey,
  PostgresCouponThreeSourceActionRepository,
} from "../../../control-plane/postgres-coupon-three-source-action-repository";
import { getControlPlaneDatabase } from "../../../control-plane/postgres-sql-database";
import {
  type CouponThreeSourceError,
  toCouponThreeSourceError,
  toCouponThreeSourceUserFailure,
} from "../../../coupon-oa/three-source/errors";
import {
  type CouponOwnerInputIssue,
  couponOwnerRepairText,
  normalizeCouponOwnerInputs,
} from "../../../coupon-oa/three-source/owner-input";
import { RegularFullReductionFieldError } from "../../../coupon-oa/three-source/recognition";
import type { CouponFieldKey } from "../../../coupon-oa/three-source/types";
import { sendFeishuCard, updateFeishuCard } from "../../client";
import {
  downloadFeishuMessageResource,
  getFeishuMessageBody,
} from "../../message-client";
import {
  buildCouponOaAttachmentRequestCard,
  buildCouponOaSubmitCard,
} from "../cards";
import {
  assertCouponOaUserAllowed,
  isCouponOaDraftDemo,
  isCouponOaDraftStoreConfigured,
  isCouponOaEnabled,
} from "../config";
import { missingCouponOaAttachments } from "../draft-service";
import {
  COUPON_OA_THREE_SOURCE_PILOT_SCHEMA_VERSION,
  type CouponOaDraft,
  getCouponOaDraft,
  listActiveCouponOaDrafts,
  updateCouponOaDraft,
} from "../draft-store";
import { isCouponExcelPilotEnabled } from "../excel-pilot-config";
import { listActiveCouponExcelPilotDrafts } from "../excel-pilot-store";
import { confirmCouponOaDraft } from "../submit-service";
import { isUserCancelableCouponOaDraft } from "../workflow-lifecycle";
import {
  parseCouponThreeSourceRevisionedAction,
  shortCouponThreeSourceMappingContextHash,
} from "./action-name";
import {
  buildCouponThreeSourceClearedCard,
  buildCouponThreeSourceCompletedCard,
  buildCouponThreeSourceErrorCard,
  buildCouponThreeSourceGeneratingArtifactsCard,
  buildCouponThreeSourceIntakeCard,
  buildCouponThreeSourceManualSubmissionCard,
  buildCouponThreeSourceMappingCard,
  buildCouponThreeSourceOverlapCard,
  buildCouponThreeSourcePreviewCard,
  buildCouponThreeSourceRecognizingCard,
  buildCouponThreeSourceRoleCard,
  buildCouponThreeSourceRuntimeBlockedCard,
  buildCouponThreeSourceUnavailableCard,
  identifierDimensionChoice,
  mappingCardEnumDefaults,
  ownerDefaultValue,
} from "./cards";
import {
  isCouponThreeSourceClearInvocation,
  isCouponThreeSourceInvocation,
} from "./config";
import {
  classifyCouponThreeSourceResource,
  unsupportedCouponThreeSourceFileError,
} from "./file-classification";
import { deliverFrozenArtifactsAsMessages } from "./frozen-artifact-delivery";
import { deliverCouponThreeSourceMappingCard } from "./mapping-card-delivery";
import { isCouponThreeSourcePilotEnabled } from "./pilot-config";
import {
  type CouponThreeSourcePilotService,
  createDefaultCouponThreeSourcePilotService,
} from "./service";
import {
  type CouponThreeSourcePilotDraft,
  computeCouponThreeSourceMappingContextHash,
  getCouponThreeSourcePilotDraft,
  listActiveCouponThreeSourcePilotDrafts,
} from "./store";

export type CouponThreeSourceDispatchResult =
  | { handled: false }
  | { handled: true; message: string };

export interface CouponThreeSourceDispatcherDependencies {
  isPilotEnabled(): boolean;
  isCouponOaEnabled(): boolean;
  isCouponOaDraftDemo(): boolean;
  shouldCheckActiveOa(): boolean;
  shouldCheckActiveExcel(): boolean;
  assertUserAllowed(openId: string): void;
  createService(): CouponThreeSourcePilotService;
  getDraft(recordId: string): Promise<CouponThreeSourcePilotDraft>;
  listActiveThreeSource(openId: string): Promise<CouponThreeSourcePilotDraft[]>;
  listActiveOa(openId: string): Promise<Array<{ recordId: string }>>;
  listActiveExcel(openId: string): Promise<Array<{ recordId: string }>>;
  getMessageBody: typeof getFeishuMessageBody;
  downloadFile(input: {
    messageId: string;
    fileKey: string;
    type: "file";
  }): Promise<Uint8Array>;
  downloadResource?(input: {
    messageId: string;
    resourceKey: string;
    type: "file" | "image";
  }): Promise<Uint8Array>;
  sendCard(
    openId: string,
    card: Parameters<typeof sendFeishuCard>[1],
    idempotencyKey?: string,
  ): Promise<void>;
  /** Best-effort frozen-artifact file/image messages after the send card. */
  sendArtifactMessages?: typeof deliverFrozenArtifactsAsMessages;
  deliverMappingCard: typeof deliverCouponThreeSourceMappingCard;
  updateCard?: typeof updateFeishuCard;
  getOaDraft: typeof getCouponOaDraft;
  /** Owner-scoped cancel of a pilot OA draft; used by the /clear cascade. */
  cancelOaDraft?(
    draft: CouponOaDraft,
  ): Promise<Awaited<ReturnType<typeof updateCouponOaDraft>>>;
  /** Freezes the pilot OA draft (definition hash + identity) before send. */
  confirmOaDraft?: typeof confirmCouponOaDraft;
  claimAction?(input: {
    semanticKey: string;
    requestPayload: Record<string, unknown>;
  }): Promise<CouponThreeSourceActionClaim>;
  completeAction?(input: {
    effectId: string;
    leaseToken: string;
    externalReference?: string;
  }): Promise<void>;
  failAction?(input: {
    effectId: string;
    leaseToken: string;
    errorCode: string;
    errorMessage: string;
    outcomeUnknown?: boolean;
  }): Promise<void>;
}

function defaultActionRepository(): PostgresCouponThreeSourceActionRepository {
  return new PostgresCouponThreeSourceActionRepository(
    getControlPlaneDatabase(),
  );
}

const defaultDependencies: CouponThreeSourceDispatcherDependencies = {
  isPilotEnabled: isCouponThreeSourcePilotEnabled,
  isCouponOaEnabled,
  isCouponOaDraftDemo,
  shouldCheckActiveOa: isCouponOaDraftStoreConfigured,
  shouldCheckActiveExcel: isCouponExcelPilotEnabled,
  assertUserAllowed: assertCouponOaUserAllowed,
  createService: createDefaultCouponThreeSourcePilotService,
  getDraft: getCouponThreeSourcePilotDraft,
  listActiveThreeSource: listActiveCouponThreeSourcePilotDrafts,
  listActiveOa: listActiveCouponOaDrafts,
  listActiveExcel: listActiveCouponExcelPilotDrafts,
  getMessageBody: getFeishuMessageBody,
  async downloadResource(input) {
    return downloadFeishuMessageResource({
      messageId: input.messageId,
      fileKey: input.resourceKey,
      type: input.type,
    });
  },
  downloadFile: downloadFeishuMessageResource,
  sendCard: sendFeishuCard,
  sendArtifactMessages: deliverFrozenArtifactsAsMessages,
  deliverMappingCard: deliverCouponThreeSourceMappingCard,
  updateCard: updateFeishuCard,
  cancelOaDraft: (draft) => updateCouponOaDraft(draft, { status: "Canceled" }),
  confirmOaDraft: confirmCouponOaDraft,
  getOaDraft: getCouponOaDraft,
  claimAction: (input) => defaultActionRepository().prepareAndClaim(input),
  completeAction: (input) => defaultActionRepository().complete(input),
  failAction: (input) => defaultActionRepository().fail(input),
};

function parseRevision(value: unknown): number | undefined {
  const revision = Number(value);
  return Number.isInteger(revision) && revision > 0 ? revision : undefined;
}

function stringValue(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function fileMetadata(content: string): {
  fileKey?: string;
  fileName?: string;
} {
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    return {
      fileKey: stringValue(value.file_key),
      fileName: stringValue(value.file_name),
    };
  } catch {
    return {};
  }
}

function imageMetadata(content: string): { imageKey?: string } {
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    return { imageKey: stringValue(value.image_key) };
  } catch {
    return {};
  }
}

function overlapCount(draft: CouponThreeSourcePilotDraft): number {
  const whitelist = new Set(draft.whitelist?.entries.map((entry) => entry.id));
  return (draft.blacklist?.entries ?? []).filter((entry) =>
    whitelist.has(entry.id),
  ).length;
}

function hasPendingAiRecognition(draft: CouponThreeSourcePilotDraft): boolean {
  return Object.values(draft.recognitions).some(
    (recognition) => recognition?.ai?.status === "pending",
  );
}

async function sendDraftState(input: {
  openId: string;
  draft: CouponThreeSourcePilotDraft;
  dependencies: CouponThreeSourceDispatcherDependencies;
  idempotencyKey?: string;
}): Promise<void> {
  const { draft } = input;
  const isMappingState =
    !draft.pendingRecognition &&
    !hasPendingAiRecognition(draft) &&
    Boolean(draft.task.sources.couponTable && draft.task.sources.whitelist) &&
    !draft.validationIssues.some((issue) =>
      issue.includes("白黑名单存在重叠"),
    ) &&
    draft.task.status !== "AwaitingFinalConfirmation" &&
    draft.task.status !== "DraftOnlyConfirmed" &&
    draft.task.status !== "Canceled";
  if (isMappingState) {
    await input.dependencies.deliverMappingCard({
      draft,
      idempotencyKey: input.idempotencyKey,
    });
    return;
  }
  const card = (() => {
    if (draft.task.status === "DraftOnlyConfirmed") {
      return buildCouponThreeSourceCompletedCard(draft);
    }
    if (draft.task.status === "Canceled") {
      return buildCouponThreeSourceErrorCard({
        message: "当前三源提报已取消，请重新发送 /OA优惠券提报。",
      });
    }
    if (draft.task.status === "GeneratingArtifacts") {
      return buildCouponThreeSourceGeneratingArtifactsCard();
    }
    if (draft.pendingRecognition) {
      return buildCouponThreeSourceRoleCard({
        draft,
        recognition: draft.pendingRecognition,
      });
    }
    if (hasPendingAiRecognition(draft)) {
      return buildCouponThreeSourceRecognizingCard(draft);
    }
    if (!draft.task.sources.couponTable || !draft.task.sources.whitelist) {
      return buildCouponThreeSourceIntakeCard(draft);
    }
    if (
      draft.validationIssues.some((issue) => issue.includes("白黑名单存在重叠"))
    ) {
      return buildCouponThreeSourceOverlapCard({
        draft,
        count: overlapCount(draft),
      });
    }
    if (draft.task.status === "AwaitingFinalConfirmation") {
      return buildCouponThreeSourcePreviewCard(draft);
    }
    return buildCouponThreeSourceMappingCard(draft);
  })();
  await input.dependencies.sendCard(input.openId, card, input.idempotencyKey);
}

async function assertRuntimeAvailable(input: {
  openId: string;
  dependencies: CouponThreeSourceDispatcherDependencies;
  idempotencyKey?: string;
}): Promise<boolean> {
  if (!input.dependencies.isPilotEnabled()) {
    await input.dependencies.sendCard(
      input.openId,
      buildCouponThreeSourceUnavailableCard(),
      input.idempotencyKey,
    );
    return false;
  }
  try {
    if (!input.dependencies.isCouponOaEnabled()) {
      throw new Error("Coupon OA is disabled");
    }
    if (input.dependencies.isCouponOaDraftDemo()) {
      throw new Error(
        "Coupon OA draft demo cannot create a three-source OA handoff",
      );
    }
    input.dependencies.assertUserAllowed(input.openId);
    return true;
  } catch {
    await input.dependencies.sendCard(
      input.openId,
      buildCouponThreeSourceRuntimeBlockedCard(),
      input.idempotencyKey,
    );
    return false;
  }
}

function operationId(input: {
  action: string;
  recordId: string;
  revision: number;
  idempotencyKey?: string;
}): string {
  return (
    input.idempotencyKey ??
    `${input.action}:${input.recordId}:${input.revision}`
  );
}

async function activeWorkflowConflict(input: {
  openId: string;
  dependencies: CouponThreeSourceDispatcherDependencies;
}): Promise<string | undefined> {
  const [oaDrafts, excelPilots] = await Promise.all([
    input.dependencies.shouldCheckActiveOa()
      ? input.dependencies.listActiveOa(input.openId)
      : Promise.resolve([]),
    input.dependencies.shouldCheckActiveExcel()
      ? input.dependencies.listActiveExcel(input.openId)
      : Promise.resolve([]),
  ]);
  if (oaDrafts.length)
    return "当前存在未完成的优惠券 OA 草稿，不能同时启动三源提报";
  if (excelPilots.length)
    return "当前存在未完成的优惠券 Excel 试点，不能同时启动三源提报";
  return undefined;
}

function mappingSelections(
  form: Record<string, unknown>,
  draft: CouponThreeSourcePilotDraft,
) {
  const activityPointPercent = Number(
    stringValue(form.activityPointPercent)?.replace(/%$/, ""),
  );
  if (!Number.isFinite(activityPointPercent) || activityPointPercent <= 0) {
    throw new Error("请填写大于 0 的 OA 活动点位（%）");
  }
  const couponFieldCandidateIds = Object.fromEntries(
    Object.entries(form).flatMap(([name, value]) => {
      const candidateId = stringValue(value);
      return name.startsWith("coupon_") && candidateId
        ? [[name.slice("coupon_".length), candidateId]]
        : [];
    }),
  );
  const submittedOwnerFieldValues = Object.fromEntries(
    Object.entries(form).flatMap(([name, value]) => {
      // 选择组件可能提交数组（多选）；合并为顿号串，领域层按分隔符还原数组。
      const fieldValue =
        stringValue(value) ??
        (Array.isArray(value)
          ? value
              .map((item) => String(item).trim())
              .filter(Boolean)
              .join("、") || undefined
          : undefined);
      return name.startsWith("owner_") && fieldValue
        ? [[name.slice("owner_".length) as CouponFieldKey, fieldValue]]
        : [];
    }),
  ) as Partial<Record<CouponFieldKey, unknown>>;
  const ownerInput = normalizeCouponOwnerInputs({
    // 枚举字段未选择时套卡片声明的服务端默认（仅修正区字段，见函数注释）；
    // 提交值存在时以提交值为准。
    ...mappingCardEnumDefaults(draft),
    ...submittedOwnerFieldValues,
  });
  const couponType = stringValue(form.couponType);
  if (couponType && couponType !== "regular_full_reduction") {
    throw new Error("当前 P0 只支持常规满减券");
  }
  const listSelection = (prefix: "whitelist" | "blacklist") => {
    return {
      identifierCandidateId: stringValue(
        form[`${prefix}_identifierCandidateId`],
      ),
      selectedSheetName: stringValue(form[`${prefix}_selectedSheetName`]),
    };
  };
  const identifierDimensionConfirmations = Object.fromEntries(
    (["whitelist", "blacklist"] as const).flatMap((role) => {
      const recognition = draft.recognitions[role];
      const choice = identifierDimensionChoice(recognition, role);
      if (!recognition || !choice?.requiresChoice) return [];
      const submitted = stringValue(form[`${role}_identifierDimension`]);
      if (submitted !== "SKU" && submitted !== "MERCHANT_ID") {
        throw new Error(
          `${role === "whitelist" ? "白名单" : "黑名单"}标识类型请从商家 ID 或 SKU 中选择`,
        );
      }
      return [
        [
          role,
          {
            sourceSha256: recognition.sourceHash,
            detectedDimension: choice.detected,
            confirmedAs: submitted,
          },
        ],
      ];
    }),
  );
  return {
    activityPointPercent,
    ...(couponType ? { couponType: "regular_full_reduction" as const } : {}),
    ...(stringValue(form.couponCandidateId)
      ? { couponCandidateId: stringValue(form.couponCandidateId) }
      : {}),
    ...(Object.keys(couponFieldCandidateIds).length
      ? { couponFieldCandidateIds }
      : {}),
    ...(Object.keys(ownerInput.values).length
      ? { ownerFieldValues: ownerInput.values }
      : {}),
    repairIssues: ownerInput.issues,
    whitelist: listSelection("whitelist"),
    blacklist: listSelection("blacklist"),
    ...(Object.keys(identifierDimensionConfirmations).length
      ? { identifierDimensionConfirmations }
      : {}),
  };
}

const couponOwnerFieldLabels: Partial<Record<CouponFieldKey, string>> = {
  businessMode: "业务模式",
  activityName: "活动名称",
  activityBackground: "活动背景",
  activityStartAt: "活动开始日期",
  activityEndAt: "活动结束日期",
  overDeduction: "是否超扣",
  overDeductionReason: "超扣原因",
};

/**
 * Friendly, Chinese pre-validation that runs BEFORE any revision bump. A
 * failed submit must leave the draft untouched so the owner can correct the
 * same card instead of hitting a "revision changed" dead end. Only MISSING
 * required fields are rejected here: malformed inputs (e.g. "9月30日") must
 * still flow into the AI form-repair path, which can fix them.
 */
export function assertMappingFormReady(
  selections: { ownerFieldValues?: Partial<Record<CouponFieldKey, unknown>> },
  draft: CouponThreeSourcePilotDraft,
): { ownerFieldValues: Partial<Record<CouponFieldKey, unknown>> } {
  const merged = {
    ...(draft.selections.ownerFieldValues ?? {}),
    ...(selections.ownerFieldValues ?? {}),
  };
  const requiredKeys: CouponFieldKey[] = [
    "businessMode",
    "activityName",
    "activityBackground",
    "activityStartAt",
    "activityEndAt",
    "overDeduction",
  ];
  const missing = requiredKeys.filter(
    (key) => !String(merged[key] ?? "").trim(),
  );
  if (missing.length) {
    throw new Error(
      `请先完整填写：${missing.map((key) => couponOwnerFieldLabels[key] ?? key).join("、")}`,
    );
  }
  if (
    merged.overDeduction === "是" &&
    !String(merged.overDeductionReason ?? "").trim()
  ) {
    throw new Error("选择「是，需要填写超扣原因」后，超扣原因为必填");
  }
  // 与领域规则镜像（calculation.ts superRefine）的表单预检：合并提交值后
  // 的生效推广途径决定公开推广渠道必填/禁填，失败留在原卡可改，不产生
  // revision 死局。判定值级联复用 cards 的 ownerDefaultValue 单一来源。
  // 生效值与卡片/领域确认同一条级联：owner 提交值 → 表内识别候选
  // （ownerDefaultValue 含文案/AI/确定性候选回退）。只看 owner 值会把
  // 渠道已从表列识别的材料误判为缺失（case3 重放实测）。
  const effectivePromotionMode =
    stringValue(merged.promotionMode) ??
    ownerDefaultValue(draft, "promotionMode");
  const channelsRaw =
    stringValue(merged.publicPromotionChannels) ??
    ownerDefaultValue(draft, "publicPromotionChannels");
  const channels = (channelsRaw ?? "").trim();
  if (effectivePromotionMode === "公开自动推广" && !channels) {
    throw new Error(
      "推广途径为「公开自动推广」时，公开推广渠道为必填（全网推广、单品页购物车、领券中心、公开券池）",
    );
  }
  if (effectivePromotionMode === "非公开推广" && channels) {
    throw new Error("推广途径为非公开推广时，无需填写公开推广渠道");
  }
  const ownerFieldValues = {
    ...(selections.ownerFieldValues ?? {}),
    ...(merged.overDeduction === "否" ? { overDeductionReason: "" } : {}),
  };
  return { ownerFieldValues };
}

/**
 * Marks an error whose owner-facing report already went out on the restored
 * form card, so the dispatcher's catch must not bury that card under a
 * dead-end error card.
 */
function ownerReported(error: unknown): Error {
  const reported = toCouponThreeSourceError(error) as CouponThreeSourceError & {
    reportedToOwner?: boolean;
  };
  reported.reportedToOwner = true;
  return reported;
}

function failureDetail(error: unknown): {
  message: string;
  fieldIssues?: Array<{ key: CouponFieldKey; message: string }>;
} {
  if (error instanceof RegularFullReductionFieldError) {
    return { message: error.message, fieldIssues: error.fieldIssues };
  }
  return { message: toCouponThreeSourceUserFailure(error).message };
}

/**
 * Runs artifact generation; on any failure it un-bricks the flow: reverts
 * the GeneratingArtifacts marker, persists the failure reason (and the exact
 * broken fields) onto the draft, and re-delivers the second-round form —
 * in place when the revision is unchanged — so the owner can correct and
 * re-submit on a live card. The error is rethrown marked as already
 * reported; the dispatcher's catch then must not send a separate error card.
 */
async function runGenerationWithRecovery(input: {
  service: CouponThreeSourcePilotService;
  dependencies: CouponThreeSourceDispatcherDependencies;
  openId: string;
  updated: CouponThreeSourcePilotDraft;
  operationId: string;
}): Promise<CouponThreeSourcePilotDraft> {
  try {
    return await input.service.confirmSourcesAndGenerate({
      draft: input.updated,
      ownerOpenId: input.openId,
      expectedRevision: input.updated.task.revision,
      operationId: input.operationId,
    });
  } catch (error) {
    await restoreMappingFormAfterFailure({
      service: input.service,
      dependencies: input.dependencies,
      openId: input.openId,
      updated: input.updated,
      error,
    });
    throw ownerReported(error);
  }
}

/**
 * Best-effort rollback shared by every failure after the confirm click:
 * status revert, failure banner, and live form card re-delivery. Any step
 * may fail without masking the original error.
 */
async function restoreMappingFormAfterFailure(input: {
  service: CouponThreeSourcePilotService;
  dependencies: CouponThreeSourceDispatcherDependencies;
  openId: string;
  updated: CouponThreeSourcePilotDraft;
  error: unknown;
}): Promise<void> {
  const recovered = await input.service
    .recoverFailedGeneration?.({
      draft: input.updated,
      ownerOpenId: input.openId,
      expectedRevision: input.updated.task.revision,
    })
    .catch(() => undefined);
  const reverted = recovered ?? input.updated;
  const recorded = await input.service
    .recordGenerationFailure?.({
      draft: reverted,
      ownerOpenId: input.openId,
      expectedRevision: reverted.task.revision,
      failure: failureDetail(input.error),
    })
    .catch(() => undefined);
  await input.dependencies
    .deliverMappingCard({ draft: recorded ?? reverted })
    .catch(async (deliveryError: unknown) => {
      // 恢复卡投递失败不再静默（11310 事故的死局成因）：降级一条纯文字
      // 报错（不走表单模板，不可能触发 schema 拒收），并留结构化日志。
      console.warn(
        JSON.stringify({
          event: "mapping_card_delivery_failed",
          draft_id: reverted.pilotId,
          revision: reverted.task.revision,
          reason:
            deliveryError instanceof Error
              ? deliveryError.message
              : String(deliveryError),
        }),
      );
      await input.dependencies.sendCard(
        input.openId,
        buildCouponThreeSourceErrorCard({
          message: [
            `本次确认未通过：${failureDetail(input.error).message}`,
            "",
            "表单卡恢复失败，请重发 /OA优惠券提报 获取最新表单卡；已填内容已保留。",
          ].join("\n"),
        }),
        undefined,
      );
    });
}

/**
 * Loads the handed-off OA draft, freezes it server-side (definition hash +
 * identity snapshot — the owner's single human confirmation is the send
 * click itself), and delivers the merged send card. On first delivery the
 * frozen artifacts also go out as real file/image messages so the owner can
 * review the exact frozen bytes inline.
 */
async function deliverPilotSendCard(input: {
  openId: string;
  dependencies: CouponThreeSourceDispatcherDependencies;
  oaDraftRecordId: string;
  idempotencyKey?: string;
  includeArtifacts?: boolean;
}): Promise<{ artifactFailures?: number }> {
  let oaDraft = await input.dependencies.getOaDraft(input.oaDraftRecordId);
  if (
    input.dependencies.confirmOaDraft &&
    ["Draft", "Validated", "Failed"].includes(oaDraft.status)
  ) {
    oaDraft = await input.dependencies.confirmOaDraft(oaDraft);
  }
  await input.dependencies.sendCard(
    input.openId,
    pilotOaSubmitCard(oaDraft),
    input.idempotencyKey,
  );
  if (!input.includeArtifacts || !input.dependencies.sendArtifactMessages) {
    return {};
  }
  // Auxiliary delivery: a failed scope or upload must never fail the chain;
  // failures are surfaced in the dispatch result message for diagnostics.
  const delivered = await input.dependencies
    .sendArtifactMessages({
      openId: input.openId,
      attachments: oaDraft.attachments,
      idempotencyKey: input.idempotencyKey,
    })
    .catch(() => undefined);
  return { artifactFailures: delivered?.failed.length ?? 0 };
}

/**
 * The pilot chain collapses generation, handoff and submission into one
 * human confirmation: after the second-round form the owner receives a
 * single draft card whose button sends the formal OA.
 */
function pilotOaSubmitCard(
  oaDraft: Awaited<ReturnType<typeof getCouponOaDraft>>,
): ReturnType<typeof buildCouponOaSubmitCard> {
  const missing = missingCouponOaAttachments(oaDraft);
  if (missing.length) {
    return buildCouponOaAttachmentRequestCard({
      draftId: oaDraft.draftId,
      missing,
    });
  }
  return buildCouponOaSubmitCard({
    draftRecordId: oaDraft.recordId,
    values: oaDraft.values,
    attachments: oaDraft.attachments,
    stepLabel: "第 4 步：核对无误后点击确认，将创建并发送正式 OA",
  });
}

export function createCouponThreeSourceDispatcher(
  dependencies: CouponThreeSourceDispatcherDependencies = defaultDependencies,
) {
  async function dispatchText(input: {
    openId: string;
    text: string;
    idempotencyKey?: string;
  }): Promise<CouponThreeSourceDispatchResult> {
    const clearRequested = isCouponThreeSourceClearInvocation(input.text);
    if (!clearRequested && !isCouponThreeSourceInvocation(input.text)) {
      return { handled: false };
    }
    if (!(await assertRuntimeAvailable({ ...input, dependencies }))) {
      return {
        handled: true,
        message: "Coupon three-source pilot is unavailable",
      };
    }
    try {
      if (clearRequested) {
        const active = await dependencies.listActiveThreeSource(input.openId);
        const service = dependencies.createService();
        for (const draft of active) {
          await service.cancel({
            draft,
            ownerOpenId: input.openId,
            expectedRevision: draft.task.revision,
          });
        }
        // Cascade to the OA drafts the pilot handed off — otherwise a
        // completed run leaves an active draft that blocks the next report.
        // Only pilot-schema drafts in owner-cancelable states are closed;
        // Submitting-and-later drafts may reference a live instance.
        let closedOaDrafts = 0;
        if (dependencies.cancelOaDraft) {
          const activeOa = dependencies.shouldCheckActiveOa()
            ? await dependencies.listActiveOa(input.openId)
            : [];
          for (const { recordId } of activeOa) {
            const oaDraft = await dependencies
              .getOaDraft(recordId)
              .catch(() => undefined);
            if (
              !oaDraft ||
              oaDraft.ownerOpenId !== input.openId ||
              oaDraft.schemaVersion !==
                COUPON_OA_THREE_SOURCE_PILOT_SCHEMA_VERSION ||
              !isUserCancelableCouponOaDraft(oaDraft)
            ) {
              continue;
            }
            try {
              await dependencies.cancelOaDraft(oaDraft);
              closedOaDrafts += 1;
            } catch {
              // A concurrent submit may have settled the draft; skip it.
            }
          }
        }
        await dependencies.sendCard(
          input.openId,
          buildCouponThreeSourceClearedCard({
            clearedCount: active.length,
            closedOaDraftCount: closedOaDrafts,
          }),
          input.idempotencyKey,
        );
        return {
          handled: true,
          message: active.length
            ? `Cleared ${active.length} active coupon three-source pilots`
            : "No active coupon three-source pilot to clear",
        };
      }
      const conflict = await activeWorkflowConflict({
        openId: input.openId,
        dependencies,
      });
      if (conflict) {
        await dependencies.sendCard(
          input.openId,
          buildCouponThreeSourceErrorCard({ message: conflict }),
          input.idempotencyKey,
        );
        return { handled: true, message: conflict };
      }
      const draft = await dependencies
        .createService()
        .startOrResume(input.openId);
      await sendDraftState({
        openId: input.openId,
        draft,
        dependencies,
        idempotencyKey: input.idempotencyKey,
      });
      return {
        handled: true,
        message: `Coupon three-source pilot ${draft.pilotId} opened`,
      };
    } catch (error) {
      const failure = toCouponThreeSourceUserFailure(error);
      const detail = failure.message;
      await dependencies.sendCard(
        input.openId,
        failure.code === "FILE_TOO_LARGE"
          ? buildCouponThreeSourceManualSubmissionCard({
              fileName: undefined,
            })
          : buildCouponThreeSourceErrorCard({ message: detail }),
        input.idempotencyKey,
      );
      return { handled: true, message: detail };
    }
  }

  async function dispatchResource(input: {
    openId: string;
    messageId: string;
    resourceType: "file" | "image";
    fileKey?: string;
    fileName?: string;
    idempotencyKey?: string;
  }): Promise<CouponThreeSourceDispatchResult> {
    if (!dependencies.isPilotEnabled()) {
      console.warn(
        JSON.stringify({
          event: "file_ignored",
          reason: "pilot_disabled",
          messageId: input.messageId,
        }),
      );
      return { handled: false };
    }
    try {
      if (!dependencies.isCouponOaEnabled()) {
        console.warn(
          JSON.stringify({
            event: "file_ignored",
            reason: "coupon_oa_disabled",
            messageId: input.messageId,
          }),
        );
        return { handled: false };
      }
      dependencies.assertUserAllowed(input.openId);
    } catch (error) {
      // 静默丢弃文件会让业务员完全失去线索（2026-10-18 夜间回归）：
      // 每个忽略分支都必须留下可检索的诊断日志。
      console.warn(
        JSON.stringify({
          event: "file_ignored",
          reason: "user_allowed_check_failed",
          detail:
            error instanceof Error
              ? error.message.slice(0, 160)
              : String(error),
          messageId: input.messageId,
        }),
      );
      return { handled: false };
    }
    let active: CouponThreeSourcePilotDraft[];
    try {
      active = await dependencies.listActiveThreeSource(input.openId);
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "file_ignored",
          reason: "list_active_failed",
          detail:
            error instanceof Error
              ? error.message.slice(0, 200)
              : String(error),
          messageId: input.messageId,
        }),
      );
      return { handled: false };
    }
    if (!active.length) {
      console.warn(
        JSON.stringify({
          event: "file_ignored",
          reason: "no_active_draft",
          messageId: input.messageId,
        }),
      );
      return { handled: false };
    }
    if (active.length > 1) {
      await dependencies.sendCard(
        input.openId,
        buildCouponThreeSourceErrorCard({
          message: "检测到多笔未完成的三源提报，已停止处理本次文件。",
        }),
        input.idempotencyKey,
      );
      return { handled: true, message: "Multiple active three-source pilots" };
    }
    const conflict = await activeWorkflowConflict({
      openId: input.openId,
      dependencies,
    });
    if (conflict) {
      await dependencies.sendCard(
        input.openId,
        buildCouponThreeSourceErrorCard({ message: conflict }),
        input.idempotencyKey,
      );
      return { handled: true, message: conflict };
    }
    if (active[0].task.status === "GeneratingArtifacts") {
      const busy = "三源标准产物正在生成，请等待最新卡片完成后再上传材料";
      await dependencies.sendCard(
        input.openId,
        buildCouponThreeSourceErrorCard({ message: busy }),
        input.idempotencyKey,
      );
      return { handled: true, message: busy };
    }
    try {
      let fileKey = stringValue(input.fileKey);
      let fileName = stringValue(input.fileName);
      if (!fileKey) {
        const original = await dependencies.getMessageBody({
          messageId: input.messageId,
        });
        if (original.messageType !== input.resourceType) {
          throw new Error("来源消息类型与资源类型不一致");
        }
        if (input.resourceType === "image") {
          fileKey = imageMetadata(original.content).imageKey;
        } else {
          const metadata = fileMetadata(original.content);
          fileKey = metadata.fileKey;
          fileName = fileName ?? metadata.fileName;
        }
      }
      if (!fileKey) {
        throw new Error(
          input.resourceType === "image"
            ? "图片消息未包含 image_key"
            : "来源文件未包含 file_key",
        );
      }
      const resourceKind = classifyCouponThreeSourceResource({
        resourceType: input.resourceType,
        fileName,
      });
      if (
        resourceKind === "unsupported_spreadsheet" ||
        resourceKind === "unsupported_file"
      ) {
        throw unsupportedCouponThreeSourceFileError(resourceKind);
      }
      const bytes = dependencies.downloadResource
        ? await dependencies.downloadResource({
            messageId: input.messageId,
            resourceKey: fileKey,
            type: input.resourceType,
          })
        : input.resourceType === "file"
          ? await dependencies.downloadFile({
              messageId: input.messageId,
              fileKey,
              type: "file",
            })
          : await downloadFeishuMessageResource({
              messageId: input.messageId,
              fileKey,
              type: "image",
            });
      const service = dependencies.createService();
      const isWorkbook = resourceKind === "excel_xlsx";
      const next = isWorkbook
        ? await service.receiveSource({
            draft: active[0],
            ownerOpenId: input.openId,
            expectedRevision: active[0].task.revision,
            messageId: input.messageId,
            fileKey,
            fileName: fileName ?? "未命名来源文件.xlsx",
            bytes,
          })
        : await service.receiveCalcImage({
            draft: active[0],
            ownerOpenId: input.openId,
            expectedRevision: active[0].task.revision,
            messageId: input.messageId,
            resourceKey: fileKey,
            resourceType: input.resourceType,
            fileName:
              fileName ??
              (input.resourceType === "image" ? "飞书图片.png" : "测算图片"),
            bytes,
          });
      // Unambiguous uploads are collected silently. The owner starts one
      // recognition batch from the intake card after all files are present.
      if (
        next.pendingRecognition ||
        (!isWorkbook && next.mappingCardDelivery)
      ) {
        await sendDraftState({
          openId: input.openId,
          draft: next,
          dependencies,
          idempotencyKey: input.idempotencyKey,
        });
      }
      return {
        handled: true,
        message: `Coupon three-source source received for ${next.pilotId}`,
      };
    } catch (error) {
      const detail = toCouponThreeSourceUserFailure(error).message;
      await dependencies.sendCard(
        input.openId,
        buildCouponThreeSourceErrorCard({ message: detail }),
        input.idempotencyKey,
      );
      return { handled: true, message: detail };
    }
  }

  async function dispatchCallback(input: {
    openId: string;
    action: string;
    value?: Record<string, unknown>;
    form?: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<CouponThreeSourceDispatchResult> {
    const revisionedAction = parseCouponThreeSourceRevisionedAction(
      input.action,
    );
    const action = revisionedAction?.action ?? input.action;
    const value = input.value ?? {};
    const recordId =
      revisionedAction?.recordId ?? stringValue(value.pilotRecordId);
    const revision = revisionedAction
      ? revisionedAction.revision
      : parseRevision(value.revision);
    if (!action.startsWith("coupon_three_source_")) return { handled: false };
    if (!recordId || !revision) {
      return {
        handled: true,
        message: "Coupon three-source callback is invalid",
      };
    }
    if (
      !(await assertRuntimeAvailable({
        openId: input.openId,
        dependencies,
        idempotencyKey: input.idempotencyKey,
      }))
    ) {
      return {
        handled: true,
        message: "Coupon three-source pilot is unavailable",
      };
    }
    let claimedAction:
      | Extract<CouponThreeSourceActionClaim, { state: "claimed" }>
      | undefined;
    try {
      const draft = await dependencies.getDraft(recordId);
      if (draft.ownerOpenId !== input.openId) {
        throw new Error("只有当前三源提报创建人可以继续操作");
      }
      // Reopen is a read-only state re-render, so it stays available to
      // un-brick a flow that is otherwise showing only dead cards.
      if (
        draft.task.status === "GeneratingArtifacts" &&
        action !== "coupon_three_source_reopen"
      ) {
        throw new Error("三源标准产物正在生成，请等待最新卡片完成后再操作");
      }
      // A retried delivery (e.g. a bridge timeout resend) of the two confirm
      // actions converges by re-delivering the send card; the revision guard
      // below must not turn a transport duplicate into an error card.
      if (
        (action === "coupon_three_source_mapping_confirm" ||
          action === "coupon_three_source_final_confirm") &&
        draft.task.status === "DraftOnlyConfirmed" &&
        draft.oaDraftRecordId
      ) {
        await deliverPilotSendCard({
          openId: input.openId,
          dependencies,
          oaDraftRecordId: draft.oaDraftRecordId,
          idempotencyKey: input.idempotencyKey,
        });
        return {
          handled: true,
          message: `Coupon three-source pilot ${draft.pilotId} already completed; re-delivered the send card`,
        };
      }
      // Reopen is a current-state action: its buttons may live on older
      // cards and it converges on the persisted draft state.
      const statelessAction =
        action === "coupon_three_source_recognition_start" ||
        action === "coupon_three_source_supplement_recognition_start" ||
        action === "coupon_three_source_reopen";
      const expectedRevision = statelessAction ? draft.task.revision : revision;
      if (!statelessAction && draft.task.revision !== revision) {
        throw new Error("当前三源提报版本已变化，请使用最新卡片");
      }
      const submittedContextHash = revisionedAction?.mappingContextHash;
      if (
        action === "coupon_three_source_mapping_confirm" &&
        submittedContextHash &&
        submittedContextHash !==
          shortCouponThreeSourceMappingContextHash(
            computeCouponThreeSourceMappingContextHash(draft),
          )
      ) {
        throw new Error("当前材料或识别结果已变化，请使用最新卡片");
      }
      const service = dependencies.createService();
      const id = operationId({
        action,
        recordId,
        revision: expectedRevision,
        idempotencyKey: input.idempotencyKey,
      });
      if (
        action === "coupon_three_source_mapping_confirm" &&
        dependencies.claimAction
      ) {
        const contextHash = computeCouponThreeSourceMappingContextHash(draft);
        const claim = await dependencies.claimAction({
          semanticKey: couponThreeSourceActionSemanticKey({
            taskId: draft.task.taskId,
            revision: draft.task.revision,
            actionName: action,
            mappingContextHash: contextHash,
          }),
          requestPayload: {
            pilotRecordId: draft.recordId,
            taskId: draft.task.taskId,
            revision: draft.task.revision,
            actionName: action,
            mappingContextHash: contextHash,
          },
        });
        if (claim.state !== "claimed") {
          if (draft.mappingCardDelivery?.messageId) {
            await dependencies.updateCard?.(
              draft.mappingCardDelivery.messageId,
              claim.state === "in_progress"
                ? buildCouponThreeSourceGeneratingArtifactsCard()
                : buildCouponThreeSourceErrorCard({
                    message:
                      claim.state === "outcome_unknown"
                        ? "上次处理结果尚未确认，系统已停止自动重试，请联系处理人员对账。"
                        : claim.state === "failed"
                          ? "上次处理未完成，请使用最新卡片重试。"
                          : "本次处理已经完成，正在恢复最新结果。",
                  }),
            );
          }
          return {
            handled: true,
            message: `Coupon three-source action ${claim.state}`,
          };
        }
        claimedAction = claim;
      }
      let next: CouponThreeSourcePilotDraft;
      switch (action) {
        case "coupon_three_source_recognition_start":
          next = await service.startAiRecognition({
            draft,
            ownerOpenId: input.openId,
            expectedRevision,
            operationId: id,
          });
          break;
        case "coupon_three_source_supplement_recognition_start":
          next = await service.startSupplementRecognition({
            draft,
            ownerOpenId: input.openId,
            expectedRevision,
            operationId: id,
            text: stringValue(input.form?.supplementText) ?? "",
          });
          return {
            handled: true,
            message: `Coupon supplement recognition queued ${next.supplementRecognition?.runId ?? ""}`,
          };
        case "coupon_three_source_role_confirm": {
          const role = stringValue(value.role);
          if (
            role !== "couponTable" &&
            role !== "whitelist" &&
            role !== "blacklist"
          ) {
            throw new Error("请选择有效的材料角色");
          }
          next = await service.selectPendingRole({
            draft,
            ownerOpenId: input.openId,
            expectedRevision,
            role,
            operationId: id,
          });
          await dependencies.sendCard(
            input.openId,
            buildCouponThreeSourceIntakeCard(next),
            input.idempotencyKey,
          );
          return {
            handled: true,
            message: "Coupon three-source source role confirmed",
          };
        }
        case "coupon_three_source_no_blacklist_confirm":
          next = await service.confirmNoBlacklist({
            draft,
            ownerOpenId: input.openId,
            expectedRevision,
            operationId: id,
          });
          break;
        case "coupon_three_source_calc_images_append":
        case "coupon_three_source_calc_images_replace_all":
          next = await service.commitCalcImageBatch({
            draft,
            ownerOpenId: input.openId,
            expectedRevision,
            mode:
              action === "coupon_three_source_calc_images_append"
                ? "append"
                : "replace_all",
            operationId: id,
          });
          break;
        case "coupon_three_source_mapping_confirm": {
          // Freeze the submitted card before anything else: the confirm
          // button collapses within one round trip so repeat clicks have
          // nothing to re-enter. Every failure below restores the live form.
          if (draft.mappingCardDelivery?.messageId) {
            try {
              await dependencies.updateCard?.(
                draft.mappingCardDelivery.messageId,
                buildCouponThreeSourceGeneratingArtifactsCard(),
              );
            } catch {
              // Ignore PATCH failures; processing proceeds either way.
            }
          }
          let restoreBase = draft;
          let repairIssues: CouponOwnerInputIssue[] = [];
          let settled: CouponThreeSourcePilotDraft;
          try {
            const { repairIssues: parsedIssues, ...parsedSelections } =
              mappingSelections(input.form ?? {}, draft);
            repairIssues = parsedIssues;
            const selections = {
              ...parsedSelections,
              ...assertMappingFormReady(parsedSelections, draft),
            };
            let ready = draft;
            if (draft.task.blacklistStatus === "absent_pending_confirmation") {
              if (
                stringValue(input.form?.blacklistDecision) !==
                "absent_confirmed"
              ) {
                throw new Error("请明确确认本次无商品黑名单");
              }
              ready = await service.confirmNoBlacklist({
                draft,
                ownerOpenId: input.openId,
                expectedRevision,
                operationId: `${id}:no-blacklist`,
              });
            }
            restoreBase = ready;
            const updated = await service.updateSelections({
              draft: ready,
              ownerOpenId: input.openId,
              expectedRevision: ready.task.revision,
              selections,
              operationId: id,
            });
            restoreBase = updated;
            settled = repairIssues.length
              ? await service.startSupplementRecognition({
                  draft: updated,
                  ownerOpenId: input.openId,
                  expectedRevision: updated.task.revision,
                  operationId: `${id}:repair`,
                  text: couponOwnerRepairText(repairIssues),
                  kind: "form_repair",
                  replaceOwnerFieldKeys: repairIssues.map((item) => item.key),
                  validationIssues: repairIssues.map(
                    (item) =>
                      `输入校验[${item.key}]：${item.message}。当前输入：${item.input}`,
                  ),
                })
              : await runGenerationWithRecovery({
                  service,
                  dependencies,
                  openId: input.openId,
                  updated,
                  operationId: `${id}:generate`,
                });
          } catch (error) {
            // The confirm card was collapsed on entry, so every failure here
            // must restore a live form card or the owner is left with only
            // dead cards. Generation failures restore inside
            // runGenerationWithRecovery; skip the duplicate pass for those.
            if (!(error as { reportedToOwner?: boolean }).reportedToOwner) {
              await restoreMappingFormAfterFailure({
                service,
                dependencies,
                openId: input.openId,
                updated: restoreBase,
                error,
              }).catch(() => undefined);
              throw ownerReported(error);
            }
            throw error;
          }
          next = settled;
          // Pilot chain: generation and the OA-draft handoff are one step.
          // The owner sees exactly one card afterwards — the draft card with
          // a single send confirmation. A handoff failure falls back to the
          // classic step-5 card so the owner can retry the handoff.
          if (
            !repairIssues.length &&
            next.task.status === "AwaitingFinalConfirmation"
          ) {
            try {
              const confirmed = await service.confirmFinalPreview({
                draft: next,
                ownerOpenId: input.openId,
                expectedRevision: next.task.revision,
                operationId: `${id}:handoff`,
              });
              if (confirmed.oaDraftRecordId) {
                const sent = await deliverPilotSendCard({
                  openId: input.openId,
                  dependencies,
                  oaDraftRecordId: confirmed.oaDraftRecordId,
                  idempotencyKey: input.idempotencyKey,
                  includeArtifacts: true,
                });
                if (claimedAction && dependencies.completeAction) {
                  await dependencies.completeAction({
                    ...claimedAction,
                    externalReference: confirmed.oaDraftRecordId,
                  });
                  claimedAction = undefined;
                }
                return {
                  handled: true,
                  message: `Coupon three-source pilot created OA draft${
                    sent.artifactFailures
                      ? `; ${sent.artifactFailures} review artifact messages failed`
                      : ""
                  }`,
                };
              }
            } catch (error) {
              await sendDraftState({
                openId: input.openId,
                draft: next,
                dependencies,
                idempotencyKey: input.idempotencyKey,
              });
              throw error;
            }
          }
          break;
        }
        case "coupon_three_source_overlap_decide": {
          const decision = stringValue(value.decision);
          if (decision === "source_replacement_required") {
            await dependencies.sendCard(
              input.openId,
              buildCouponThreeSourceIntakeCard(draft),
              input.idempotencyKey,
            );
            return { handled: true, message: "Source replacement requested" };
          }
          if (decision !== "whitelist_wins" && decision !== "blacklist_wins") {
            throw new Error("请选择有效的白黑名单冲突处理规则");
          }
          const updated = await service.updateSelections({
            draft,
            ownerOpenId: input.openId,
            expectedRevision,
            selections: { overlapDecision: decision },
            operationId: id,
          });
          next = await runGenerationWithRecovery({
            service,
            dependencies,
            openId: input.openId,
            updated,
            operationId: `${id}:generate`,
          });
          break;
        }
        case "coupon_three_source_final_confirm": {
          next = await service.confirmFinalPreview({
            draft,
            ownerOpenId: input.openId,
            expectedRevision,
            operationId: id,
          });
          if (!next.oaDraftRecordId) {
            throw new Error("OA 测试稿已创建但缺少草稿记录引用");
          }
          const sent = await deliverPilotSendCard({
            openId: input.openId,
            dependencies,
            oaDraftRecordId: next.oaDraftRecordId,
            idempotencyKey: input.idempotencyKey,
            includeArtifacts: true,
          });
          return {
            handled: true,
            message: `Coupon three-source pilot created OA draft${
              sent.artifactFailures
                ? `; ${sent.artifactFailures} review artifact messages failed`
                : ""
            }`,
          };
        }
        case "coupon_three_source_reopen":
          // Read-only: re-render whichever card matches the persisted state.
          next = draft;
          break;
        case "coupon_three_source_cancel":
          next = await service.cancel({
            draft,
            ownerOpenId: input.openId,
            expectedRevision,
          });
          break;
        default:
          return { handled: false };
      }
      // Every physical click of the start button is a distinct event, so a
      // double click bypasses event-level dedup. When recognition is already
      // prepared/running for the current revision the service call above is an
      // idempotent re-activation (stalled-effect recovery), but the draft is
      // returned unchanged — converge by not delivering another recognizing
      // card for it.
      if (
        action === "coupon_three_source_recognition_start" &&
        next === draft
      ) {
        return {
          handled: true,
          message: `Coupon three-source recognition already running for ${draft.pilotId}`,
        };
      }
      await sendDraftState({
        openId: input.openId,
        draft: next,
        dependencies,
        idempotencyKey: input.idempotencyKey,
      });
      if (claimedAction && dependencies.completeAction) {
        await dependencies.completeAction({ ...claimedAction });
        claimedAction = undefined;
      }
      return {
        handled: true,
        message: `Coupon three-source action ${action} completed`,
      };
    } catch (error) {
      if (claimedAction && dependencies.failAction) {
        await dependencies
          .failAction({
            ...claimedAction,
            errorCode: toCouponThreeSourceUserFailure(error).code,
            errorMessage: toCouponThreeSourceUserFailure(error).message,
            outcomeUnknown: /unknown|未知|结果尚未确认/iu.test(
              error instanceof Error ? error.message : "",
            ),
          })
          .catch(() => undefined);
        claimedAction = undefined;
      }
      const failure = toCouponThreeSourceUserFailure(error);
      if (failure.code === "UNEXPECTED_FAILURE") {
        let diagnosticError = error;
        while (
          diagnosticError instanceof Error &&
          diagnosticError.cause instanceof Error
        ) {
          diagnosticError = diagnosticError.cause;
        }
        const technicalMessage =
          diagnosticError instanceof Error &&
          /cannot read propert|cannot destructure|is not a function|undefined|exceljs/iu.test(
            diagnosticError.message,
          )
            ? diagnosticError.message.slice(0, 500)
            : "redacted";
        console.error("Coupon three-source callback failed unexpectedly", {
          action,
          recordId,
          revision,
          errorName:
            diagnosticError instanceof Error
              ? diagnosticError.name
              : typeof diagnosticError,
          technicalMessage,
        });
      }
      const detail = failure.message;
      if (!(error as { reportedToOwner?: boolean }).reportedToOwner) {
        await dependencies.sendCard(
          input.openId,
          buildCouponThreeSourceErrorCard({
            message: detail,
            ...(recordId && revision ? { reopen: { recordId, revision } } : {}),
          }),
          input.idempotencyKey,
        );
      }
      return { handled: true, message: detail };
    }
  }

  const dispatchFile = (
    input: Omit<Parameters<typeof dispatchResource>[0], "resourceType">,
  ) => dispatchResource({ ...input, resourceType: "file" });
  return { dispatchText, dispatchFile, dispatchResource, dispatchCallback };
}

const defaultDispatcher = createCouponThreeSourceDispatcher();

export const dispatchCouponThreeSourceText = defaultDispatcher.dispatchText;
export const dispatchCouponThreeSourceFile = defaultDispatcher.dispatchFile;
export const dispatchCouponThreeSourceResource =
  defaultDispatcher.dispatchResource;
export const dispatchCouponThreeSourceCallback =
  defaultDispatcher.dispatchCallback;
