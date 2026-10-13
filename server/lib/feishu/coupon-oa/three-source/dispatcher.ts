import {
  couponOwnerRepairText,
  normalizeCouponOwnerInputs,
} from "../../../coupon-oa/three-source/owner-input";
import type { CouponFieldKey } from "../../../coupon-oa/three-source/types";
import { sendFeishuCard } from "../../client";
import {
  downloadFeishuMessageResource,
  getFeishuMessageBody,
} from "../../message-client";
import { buildCouponOaPreviewCard } from "../cards";
import {
  assertCouponOaUserAllowed,
  isCouponOaDraftDemo,
  isCouponOaDraftStoreConfigured,
  isCouponOaEnabled,
} from "../config";
import { missingCouponOaAttachments } from "../draft-service";
import { getCouponOaDraft, listActiveCouponOaDrafts } from "../draft-store";
import { isCouponExcelPilotEnabled } from "../excel-pilot-config";
import { listActiveCouponExcelPilotDrafts } from "../excel-pilot-store";
import {
  buildCouponThreeSourceClearedCard,
  buildCouponThreeSourceCompletedCard,
  buildCouponThreeSourceErrorCard,
  buildCouponThreeSourceIntakeCard,
  buildCouponThreeSourceMappingCard,
  buildCouponThreeSourceOverlapCard,
  buildCouponThreeSourcePreviewCard,
  buildCouponThreeSourceRecognizingCard,
  buildCouponThreeSourceRoleCard,
  buildCouponThreeSourceRuntimeBlockedCard,
  buildCouponThreeSourceUnavailableCard,
} from "./cards";
import {
  isCouponThreeSourceClearInvocation,
  isCouponThreeSourceInvocation,
} from "./config";
import { deliverCouponThreeSourceMappingCard } from "./mapping-card-delivery";
import { isCouponThreeSourcePilotEnabled } from "./pilot-config";
import {
  type CouponThreeSourcePilotService,
  createDefaultCouponThreeSourcePilotService,
} from "./service";
import {
  type CouponThreeSourcePilotDraft,
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
  deliverMappingCard: typeof deliverCouponThreeSourceMappingCard;
  getOaDraft: typeof getCouponOaDraft;
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
  deliverMappingCard: deliverCouponThreeSourceMappingCard,
  getOaDraft: getCouponOaDraft,
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

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

function mappingSelections(form: Record<string, unknown>) {
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
      const fieldValue = stringValue(value);
      return name.startsWith("owner_") && fieldValue
        ? [[name.slice("owner_".length) as CouponFieldKey, fieldValue]]
        : [];
    }),
  ) as Partial<Record<CouponFieldKey, unknown>>;
  const ownerInput = normalizeCouponOwnerInputs(submittedOwnerFieldValues);
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
  };
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
        await dependencies.sendCard(
          input.openId,
          buildCouponThreeSourceClearedCard({
            clearedCount: active.length,
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
      const detail = errorMessage(error, "无法创建三源提报，请稍后重试");
      await dependencies.sendCard(
        input.openId,
        buildCouponThreeSourceErrorCard({ message: detail }),
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
    if (!dependencies.isPilotEnabled()) return { handled: false };
    try {
      if (!dependencies.isCouponOaEnabled()) return { handled: false };
      dependencies.assertUserAllowed(input.openId);
    } catch {
      return { handled: false };
    }
    let active: CouponThreeSourcePilotDraft[];
    try {
      active = await dependencies.listActiveThreeSource(input.openId);
    } catch {
      // A partially configured pilot must not steal files from existing routes.
      return { handled: false };
    }
    if (!active.length) return { handled: false };
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
      const isWorkbook =
        input.resourceType === "file" &&
        (fileName ?? "").toLowerCase().endsWith(".xlsx");
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
      const detail = errorMessage(error, "三源来源文件处理失败，请重新上传");
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
    const revisionedAction = input.action.match(
      /^(coupon_three_source_(?:mapping_confirm|supplement_recognition_start)):([^:]+):(\d+)$/,
    );
    const action = revisionedAction?.[1] ?? input.action;
    const value = input.value ?? {};
    const recordId = revisionedAction?.[2] ?? stringValue(value.pilotRecordId);
    const revision = revisionedAction
      ? Number(revisionedAction[3])
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
    try {
      const draft = await dependencies.getDraft(recordId);
      if (draft.ownerOpenId !== input.openId) {
        throw new Error("只有当前三源提报创建人可以继续操作");
      }
      if (draft.task.status === "GeneratingArtifacts") {
        throw new Error("三源标准产物正在生成，请等待最新卡片完成后再操作");
      }
      const expectedRevision =
        action === "coupon_three_source_recognition_start" ||
        action === "coupon_three_source_supplement_recognition_start"
          ? draft.task.revision
          : revision;
      if (
        action !== "coupon_three_source_recognition_start" &&
        action !== "coupon_three_source_supplement_recognition_start" &&
        draft.task.revision !== revision
      ) {
        throw new Error("当前三源提报版本已变化，请使用最新卡片");
      }
      const service = dependencies.createService();
      const id = operationId({
        action,
        recordId,
        revision: expectedRevision,
        idempotencyKey: input.idempotencyKey,
      });
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
        case "coupon_three_source_over_deduction_select": {
          const decision = stringValue(value.decision);
          if (decision !== "是" && decision !== "否") {
            throw new Error("请选择是否超扣");
          }
          next = await service.updateSelections({
            draft,
            ownerOpenId: input.openId,
            expectedRevision,
            selections: {
              ownerFieldValues: {
                overDeduction: decision,
                ...(decision === "否" ? { overDeductionReason: "" } : {}),
              },
            },
            operationId: id,
          });
          break;
        }
        case "coupon_three_source_mapping_confirm": {
          const { repairIssues, ...selections } = mappingSelections(
            input.form ?? {},
          );
          let ready = draft;
          if (draft.task.blacklistStatus === "absent_pending_confirmation") {
            if (
              stringValue(input.form?.blacklistDecision) !== "absent_confirmed"
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
          const updated = await service.updateSelections({
            draft: ready,
            ownerOpenId: input.openId,
            expectedRevision: ready.task.revision,
            selections,
            operationId: id,
          });
          next = repairIssues.length
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
            : await service.confirmSourcesAndGenerate({
                draft: updated,
                ownerOpenId: input.openId,
                expectedRevision: updated.task.revision,
                operationId: `${id}:generate`,
              });
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
          next = await service.confirmSourcesAndGenerate({
            draft: updated,
            ownerOpenId: input.openId,
            expectedRevision: updated.task.revision,
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
          const oaDraft = await dependencies.getOaDraft(next.oaDraftRecordId);
          await dependencies.sendCard(
            input.openId,
            buildCouponOaPreviewCard({
              draftRecordId: oaDraft.recordId,
              values: oaDraft.values,
              attachments: oaDraft.attachments,
              missing: missingCouponOaAttachments(oaDraft),
            }),
            input.idempotencyKey,
          );
          return {
            handled: true,
            message: `Coupon three-source pilot created OA draft ${oaDraft.draftId}`,
          };
        }
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
      await sendDraftState({
        openId: input.openId,
        draft: next,
        dependencies,
        idempotencyKey: input.idempotencyKey,
      });
      return {
        handled: true,
        message: `Coupon three-source action ${action} completed`,
      };
    } catch (error) {
      const detail = errorMessage(error, "三源提报操作失败，请稍后重试");
      await dependencies.sendCard(
        input.openId,
        buildCouponThreeSourceErrorCard({ message: detail }),
        input.idempotencyKey,
      );
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
