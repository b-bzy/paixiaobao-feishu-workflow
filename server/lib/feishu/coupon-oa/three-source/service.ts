import { createHash, randomUUID } from "node:crypto";
import { PostgresCouponAiRecognitionRepository } from "../../../control-plane/postgres-coupon-ai-recognition-repository";
import { PostgresCouponAiTextRepository } from "../../../control-plane/postgres-coupon-ai-text-repository";
import { getControlPlaneDatabase } from "../../../control-plane/postgres-sql-database";
import { couponThreeSourceAiPromptVersion } from "../../../coupon-oa/three-source/ai-recognition";
import { couponSupplementTextPromptVersion } from "../../../coupon-oa/three-source/ai-text";
import {
  inspectUserCalcImage,
  renderCouponArtifactScreenshots,
} from "../../../coupon-oa/three-source/calc-image";
import { parseMultiSheetTieredIdentifierList } from "../../../coupon-oa/three-source/lists";
import {
  confirmRegularFullReductionCouponSet,
  discoverRegularFullReductionCoupons,
  inspectThreeSourceWorkbook,
  selectUniqueRole,
} from "../../../coupon-oa/three-source/recognition";
import {
  type CalcImageMergeMode,
  type CouponThreeSourceSourceFile,
  cancelCouponThreeSourceTask,
  commitCouponThreeSourceCalcImageBatch,
  confirmCouponThreeSourceDraftOnly,
  confirmCouponThreeSourceNoBlacklist,
  confirmCouponThreeSourceSources,
  createCouponThreeSourceTask,
  replaceCouponThreeSourceSource,
  saveCouponThreeSourceArtifacts,
  setCouponThreeSourceOverlap,
  stageCouponThreeSourceCalcImage,
} from "../../../coupon-oa/three-source/task";
import type {
  CouponFieldKey,
  RenderedCouponScreenshot,
  SourceRole,
} from "../../../coupon-oa/three-source/types";
import {
  buildOaPrefillSnapshot,
  createCouponSetCanonicalPackage,
  generateOfflineArtifacts,
} from "../../../coupon-oa/three-source/workflow";
import {
  grantFeishuDriveFileViewPermission,
  uploadFeishuDriveFile,
} from "../../drive-client";
import { downloadFeishuMessageResource } from "../../message-client";
import {
  getCouponThreeSourceAiConfig,
  isCouponActivityCopyEnabled,
  isCouponThreeSourceAiPrimaryEnabled,
  isCouponThreeSourceAiRecognitionEnabled,
} from "./ai-config";
import { loadCouponThreeSourceTemplates } from "./assets";
import { handoffThreeSourcePilotToOaDraft } from "./handoff";
import { getCouponThreeSourcePilotFolderToken } from "./pilot-config";
import {
  type CouponThreeSourcePilotDraft,
  type CouponThreeSourcePilotSelections,
  type CouponThreeSourceSourceReference,
  createCouponThreeSourcePilotDraft,
  getCouponThreeSourcePilotDraft,
  listActiveCouponThreeSourcePilotDrafts,
  type StoredWorkbookRecognition,
  toStoredWorkbookRecognition,
  updateCouponThreeSourcePilotDraft,
} from "./store";

const xlsxContentType =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const maximumSourceBytes = 10 * 1024 * 1024;

export interface CouponThreeSourcePilotDependencies {
  downloadSource(input: CouponThreeSourceSourceReference): Promise<Uint8Array>;
  downloadResource?(input: {
    messageId: string;
    resourceKey: string;
    type: "file" | "image";
  }): Promise<Uint8Array>;
  renderScreenshots?: typeof renderCouponArtifactScreenshots;
  uploadArtifact(input: {
    name: string;
    folderToken: string;
    contentType: string;
    bytes: Uint8Array;
  }): Promise<{ fileToken: string }>;
  grantArtifactPreview?(input: {
    fileToken: string;
    memberOpenId: string;
  }): Promise<void>;
  folderToken(): string;
  loadTemplates: typeof loadCouponThreeSourceTemplates;
  createDraft: typeof createCouponThreeSourcePilotDraft;
  getDraft: typeof getCouponThreeSourcePilotDraft;
  listActive: typeof listActiveCouponThreeSourcePilotDrafts;
  updateDraft: typeof updateCouponThreeSourcePilotDraft;
  handoff: typeof handoffThreeSourcePilotToOaDraft;
  prepareAiRecognition?(input: {
    draft: CouponThreeSourcePilotDraft;
    role: SourceRole;
    source: CouponThreeSourceSourceReference;
  }): Promise<StoredWorkbookRecognition["ai"] | undefined>;
  activateAiRecognition?(runId: string): Promise<void>;
  prepareAiText?(input: {
    draft: CouponThreeSourcePilotDraft;
    text: string;
    textSha256: string;
  }): Promise<
    NonNullable<CouponThreeSourcePilotDraft["supplementRecognition"]>
  >;
  activateAiText?(runId: string): Promise<void>;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function storedRecognitionForRole(
  draft: CouponThreeSourcePilotDraft,
  role: SourceRole,
): StoredWorkbookRecognition {
  const recognition = draft.recognitions[role];
  if (!recognition) throw new Error(`缺少${role}材料的识别结果`);
  return recognition;
}

function assertOwnerAndRevision(input: {
  draft: CouponThreeSourcePilotDraft;
  ownerOpenId: string;
  expectedRevision: number;
}): void {
  if (input.draft.ownerOpenId !== input.ownerOpenId) {
    throw new Error("只有当前三源提报创建人可以继续操作");
  }
  if (input.draft.task.revision !== input.expectedRevision) {
    throw new Error("当前三源提报版本已变化，请使用最新卡片");
  }
}

export const defaultCouponThreeSourcePilotDependencies: CouponThreeSourcePilotDependencies =
  {
    async downloadSource(input) {
      return downloadFeishuMessageResource({
        messageId: input.messageId,
        fileKey: input.fileKey,
        type: "file",
      });
    },
    async downloadResource(input) {
      return downloadFeishuMessageResource({
        messageId: input.messageId,
        fileKey: input.resourceKey,
        type: input.type,
      });
    },
    renderScreenshots: renderCouponArtifactScreenshots,
    uploadArtifact: uploadFeishuDriveFile,
    grantArtifactPreview: grantFeishuDriveFileViewPermission,
    folderToken: getCouponThreeSourcePilotFolderToken,
    loadTemplates: loadCouponThreeSourceTemplates,
    createDraft: createCouponThreeSourcePilotDraft,
    getDraft: getCouponThreeSourcePilotDraft,
    listActive: listActiveCouponThreeSourcePilotDrafts,
    updateDraft: updateCouponThreeSourcePilotDraft,
    handoff: handoffThreeSourcePilotToOaDraft,
    async prepareAiRecognition(input) {
      if (!isCouponThreeSourceAiRecognitionEnabled()) return undefined;
      const config = getCouponThreeSourceAiConfig();
      const semanticKey = [
        input.draft.recordId,
        input.draft.task.revision,
        input.role,
        input.source.sha256,
        config.model,
        couponThreeSourceAiPromptVersion,
      ].join(":");
      const run = await new PostgresCouponAiRecognitionRepository(
        getControlPlaneDatabase(),
      ).prepare({
        semanticKey,
        pilotRecordId: input.draft.recordId,
        businessTaskId: input.draft.task.taskId,
        ownerOpenId: input.draft.ownerOpenId,
        revision: input.draft.task.revision,
        sourceSlot: input.role,
        sourceReference: {
          messageId: input.source.messageId,
          fileKey: input.source.fileKey,
        },
        sourceSha256: input.source.sha256,
        sourceFileName: input.source.fileName,
        model: config.model,
        promptVersion: couponThreeSourceAiPromptVersion,
      });
      return {
        runId: run.id,
        revision: run.revision,
        sourceSha256: run.sourceSha256,
        status: run.status,
        result: run.result,
        audit: run.audit,
        fallbackCode: run.fallbackCode,
        primary: isCouponThreeSourceAiPrimaryEnabled(),
        activityCopyEnabled: isCouponActivityCopyEnabled(),
      };
    },
    async activateAiRecognition(runId) {
      const repository = new PostgresCouponAiRecognitionRepository(
        getControlPlaneDatabase(),
      );
      const run = await repository.get(runId);
      if (!run) throw new Error("AI recognition run was not found");
      await repository.activate(run);
    },
    async prepareAiText(input) {
      if (!isCouponThreeSourceAiRecognitionEnabled()) {
        throw new Error("当前环境未启用 AI 补充说明识别");
      }
      const config = getCouponThreeSourceAiConfig();
      const repository = new PostgresCouponAiTextRepository(
        getControlPlaneDatabase(),
      );
      const run = await repository.prepare({
        semanticKey: [
          input.draft.recordId,
          input.draft.task.revision,
          input.textSha256,
          config.model,
          couponSupplementTextPromptVersion,
        ].join(":"),
        pilotRecordId: input.draft.recordId,
        businessTaskId: input.draft.task.taskId,
        ownerOpenId: input.draft.ownerOpenId,
        revision: input.draft.task.revision,
        supplementText: input.text,
        textSha256: input.textSha256,
        model: config.model,
        promptVersion: couponSupplementTextPromptVersion,
      });
      return {
        text: run.supplementText,
        textSha256: run.textSha256,
        runId: run.id,
        revision: run.revision,
        status: run.status,
        result: run.result,
        audit: run.audit,
        fallbackCode: run.fallbackCode,
      };
    },
    async activateAiText(runId) {
      const repository = new PostgresCouponAiTextRepository(
        getControlPlaneDatabase(),
      );
      const run = await repository.get(runId);
      if (!run) throw new Error("AI supplement run was not found");
      await repository.activate(run);
    },
  };

export function createDefaultCouponThreeSourcePilotService(): CouponThreeSourcePilotService {
  return new CouponThreeSourcePilotService(
    defaultCouponThreeSourcePilotDependencies,
  );
}
export class CouponThreeSourcePilotService {
  constructor(
    private readonly dependencies: CouponThreeSourcePilotDependencies,
  ) {}

  async startOrResume(
    ownerOpenId: string,
  ): Promise<CouponThreeSourcePilotDraft> {
    const active = await this.dependencies.listActive(ownerOpenId);
    if (active.length > 1) {
      throw new Error("当前业务员存在多笔未完成的三源提报");
    }
    if (active[0]) return active[0];
    const task = createCouponThreeSourceTask({
      taskId: `CTS-${randomUUID()}`,
      ownerOpenId,
    });
    return this.dependencies.createDraft({ ownerOpenId, task });
  }

  async receiveSource(input: {
    draft: CouponThreeSourcePilotDraft;
    ownerOpenId: string;
    expectedRevision: number;
    messageId: string;
    fileKey: string;
    fileName: string;
    bytes: Uint8Array;
  }): Promise<CouponThreeSourcePilotDraft> {
    assertOwnerAndRevision(input);
    if (input.draft.processedMessageIds.includes(input.messageId)) {
      return input.draft;
    }
    if (!input.fileName.toLowerCase().endsWith(".xlsx")) {
      throw new Error("三源提报只接受 .xlsx 源文件");
    }
    if (!input.messageId || !input.fileKey) {
      throw new Error("三源提报源文件缺少飞书消息引用");
    }
    if (
      !input.bytes.byteLength ||
      input.bytes.byteLength > maximumSourceBytes
    ) {
      throw new Error("三源提报源文件必须大于 0 且不超过 10 MB");
    }
    const source: CouponThreeSourceSourceReference = {
      messageId: input.messageId,
      fileKey: input.fileKey,
      fileName: input.fileName,
      bytes: input.bytes.byteLength,
      sha256: sha256(input.bytes),
    };
    const recognition = await inspectThreeSourceWorkbook({
      fileName: source.fileName,
      bytes: input.bytes,
    });
    const couponCandidates = await discoverRegularFullReductionCoupons({
      recognition,
    });
    const stored = toStoredWorkbookRecognition({
      recognition,
      source,
      couponCandidates,
    });
    try {
      const role = selectUniqueRole(recognition);
      return this.assignSource({
        draft: input.draft,
        ownerOpenId: input.ownerOpenId,
        expectedRevision: input.expectedRevision,
        role,
        recognition: stored,
        messageId: input.messageId,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "无法识别材料角色";
      if (!message.includes("需要业务员确认")) throw error;
      return this.dependencies.updateDraft(
        input.draft,
        {
          pendingRecognition: stored,
          processedMessageIds: [
            ...new Set([...input.draft.processedMessageIds, input.messageId]),
          ],
          validationIssues: [message],
          failureReason: undefined,
        },
        input.expectedRevision,
      );
    }
  }

  async receiveCalcImage(input: {
    draft: CouponThreeSourcePilotDraft;
    ownerOpenId: string;
    expectedRevision: number;
    messageId: string;
    resourceKey: string;
    resourceType: "file" | "image";
    fileName: string;
    bytes: Uint8Array;
    receivedAt?: string;
  }): Promise<CouponThreeSourcePilotDraft> {
    assertOwnerAndRevision(input);
    if (input.draft.processedMessageIds.includes(input.messageId)) {
      return input.draft;
    }
    if (!input.messageId || !input.resourceKey) {
      throw new Error("测算图片缺少飞书消息资源引用");
    }
    const inspected = await inspectUserCalcImage(input.bytes);
    const task = stageCouponThreeSourceCalcImage({
      task: input.draft.task,
      ownerOpenId: input.ownerOpenId,
      expectedRevision: input.expectedRevision,
      image: {
        artifactId: `calc-image-user-${inspected.sha256}`,
        messageId: input.messageId,
        resourceKey: input.resourceKey,
        resourceType: input.resourceType,
        sourceType:
          input.resourceType === "image" ? "feishu_image" : "feishu_file",
        fileName: input.fileName,
        contentType: inspected.contentType,
        bytes: inspected.bytes,
        width: inspected.width,
        height: inspected.height,
        sha256: inspected.sha256,
        receivedAt: input.receivedAt ?? new Date().toISOString(),
      },
    });
    if (task === input.draft.task) return input.draft;
    return this.dependencies.updateDraft(
      input.draft,
      {
        task,
        artifacts: [],
        oaPrefill: undefined,
        oaDraftRecordId: undefined,
        processedMessageIds: [
          ...new Set([...input.draft.processedMessageIds, input.messageId]),
        ],
        validationIssues: [],
        failureReason: undefined,
      },
      input.expectedRevision,
    );
  }

  async commitCalcImageBatch(input: {
    draft: CouponThreeSourcePilotDraft;
    ownerOpenId: string;
    expectedRevision: number;
    mode: CalcImageMergeMode;
    operationId: string;
  }): Promise<CouponThreeSourcePilotDraft> {
    assertOwnerAndRevision(input);
    const task = commitCouponThreeSourceCalcImageBatch({
      task: input.draft.task,
      ownerOpenId: input.ownerOpenId,
      expectedRevision: input.expectedRevision,
      mode: input.mode,
      operationId: input.operationId,
    });
    if (task === input.draft.task) return input.draft;
    return this.dependencies.updateDraft(
      input.draft,
      { task, artifacts: [], oaPrefill: undefined, oaDraftRecordId: undefined },
      input.expectedRevision,
    );
  }

  async selectPendingRole(input: {
    draft: CouponThreeSourcePilotDraft;
    ownerOpenId: string;
    expectedRevision: number;
    role: SourceRole;
    operationId: string;
  }): Promise<CouponThreeSourcePilotDraft> {
    assertOwnerAndRevision(input);
    if (!input.operationId) throw new Error("三源提报操作 ID 不能为空");
    const recognition = input.draft.pendingRecognition;
    if (!recognition) throw new Error("当前没有待确认角色的材料");
    if (
      !recognition.roleCandidates.some(
        (candidate) => candidate.role === input.role,
      )
    ) {
      throw new Error("所选材料角色不在当前候选中");
    }
    return this.assignSource({
      draft: input.draft,
      ownerOpenId: input.ownerOpenId,
      expectedRevision: input.expectedRevision,
      role: input.role,
      recognition,
      messageId: recognition.source.messageId,
    });
  }

  async updateSelections(input: {
    draft: CouponThreeSourcePilotDraft;
    ownerOpenId: string;
    expectedRevision: number;
    selections: CouponThreeSourcePilotSelections;
    operationId: string;
  }): Promise<CouponThreeSourcePilotDraft> {
    assertOwnerAndRevision(input);
    if (!input.operationId) throw new Error("三源提报操作 ID 不能为空");
    return this.dependencies.updateDraft(
      input.draft,
      {
        selections: {
          ...input.draft.selections,
          ...input.selections,
          ownerFieldValues: {
            ...input.draft.selections.ownerFieldValues,
            ...input.selections.ownerFieldValues,
          },
        },
        coupon: undefined,
        whitelist: undefined,
        blacklist: undefined,
        package: undefined,
        artifacts: [],
        oaPrefill: undefined,
        oaDraftRecordId: undefined,
        validationIssues: [],
        failureReason: undefined,
      },
      input.expectedRevision,
    );
  }

  async startAiRecognition(input: {
    draft: CouponThreeSourcePilotDraft;
    ownerOpenId: string;
    expectedRevision: number;
    operationId: string;
  }): Promise<CouponThreeSourcePilotDraft> {
    assertOwnerAndRevision(input);
    if (!input.operationId) throw new Error("三源提报操作 ID 不能为空");
    if (input.draft.pendingRecognition) {
      throw new Error("请先确认无法唯一识别的材料角色");
    }
    if (
      !input.draft.task.sources.couponTable ||
      !input.draft.task.sources.whitelist
    ) {
      throw new Error("请先上传配券表和商品白名单，再开始统一识别");
    }
    if (
      !this.dependencies.prepareAiRecognition ||
      !this.dependencies.activateAiRecognition
    ) {
      return input.draft;
    }

    const recognitions = { ...input.draft.recognitions };
    const sourceRoles = Object.keys(input.draft.task.sources) as SourceRole[];
    if (sourceRoles.some((role) => !recognitions[role])) {
      throw new Error("当前 revision 缺少来源识别结果，请重新上传材料");
    }
    const currentBatch = sourceRoles.every((role) => {
      const recognition = recognitions[role];
      return (
        recognition?.ai?.revision === input.draft.task.revision &&
        recognition.ai.sourceSha256 === recognition.sourceHash
      );
    });
    if (currentBatch) {
      await this.activatePendingRecognitions(recognitions);
      return input.draft;
    }

    for (const [role, recognition] of Object.entries(recognitions)) {
      if (!recognition) continue;
      const prepared = await this.dependencies.prepareAiRecognition({
        draft: input.draft,
        role: role as SourceRole,
        source: recognition.source,
      });
      if (!prepared) continue;
      recognitions[role as SourceRole] = {
        ...recognition,
        ai: prepared,
      };
    }
    const updated = await this.dependencies.updateDraft(
      input.draft,
      { recognitions },
      input.expectedRevision,
    );
    await this.activatePendingRecognitions(updated.recognitions);
    return updated;
  }

  async startSupplementRecognition(input: {
    draft: CouponThreeSourcePilotDraft;
    ownerOpenId: string;
    expectedRevision: number;
    operationId: string;
    text: string;
    kind?: "owner_supplement" | "form_repair";
    replaceOwnerFieldKeys?: CouponFieldKey[];
    validationIssues?: string[];
  }): Promise<CouponThreeSourcePilotDraft> {
    assertOwnerAndRevision(input);
    if (!input.operationId) throw new Error("三源提报操作 ID 不能为空");
    const text = input.text.trim();
    if (!text) throw new Error("请先输入语音转写或文字补充说明");
    if (text.length > 4_000) throw new Error("补充说明不能超过 4000 字");
    if (!this.dependencies.prepareAiText || !this.dependencies.activateAiText) {
      throw new Error("当前环境未配置补充说明识别");
    }
    const textSha256 = sha256(new TextEncoder().encode(text));
    const prepared = await this.dependencies.prepareAiText({
      draft: input.draft,
      text,
      textSha256,
    });
    const supplementRecognition = {
      ...prepared,
      kind: input.kind ?? "owner_supplement",
      ...(input.replaceOwnerFieldKeys?.length
        ? { replaceOwnerFieldKeys: input.replaceOwnerFieldKeys }
        : {}),
    };
    const updated = await this.dependencies.updateDraft(
      input.draft,
      {
        supplementRecognition,
        validationIssues: [
          ...input.draft.validationIssues.filter(
            (issue) =>
              !issue.startsWith("补充说明识别") &&
              !issue.startsWith("输入校验[") &&
              !issue.startsWith("输入校验："),
          ),
          ...(input.validationIssues ?? []),
        ],
        failureReason: undefined,
      },
      input.expectedRevision,
    );
    if (supplementRecognition.status === "pending") {
      await this.dependencies.activateAiText(supplementRecognition.runId);
    }
    return updated;
  }

  async confirmNoBlacklist(input: {
    draft: CouponThreeSourcePilotDraft;
    ownerOpenId: string;
    expectedRevision: number;
    operationId: string;
  }): Promise<CouponThreeSourcePilotDraft> {
    assertOwnerAndRevision(input);
    if (!input.operationId) throw new Error("三源提报操作 ID 不能为空");
    const task = confirmCouponThreeSourceNoBlacklist({
      task: input.draft.task,
      ownerOpenId: input.ownerOpenId,
      expectedRevision: input.expectedRevision,
    });
    return this.dependencies.updateDraft(
      input.draft,
      { task },
      input.expectedRevision,
    );
  }

  async confirmSourcesAndGenerate(input: {
    draft: CouponThreeSourcePilotDraft;
    ownerOpenId: string;
    expectedRevision: number;
    operationId: string;
  }): Promise<CouponThreeSourcePilotDraft> {
    assertOwnerAndRevision(input);
    if (!input.operationId) throw new Error("三源提报操作 ID 不能为空");
    const activityPointPercent = input.draft.selections.activityPointPercent;
    if (
      !Number.isFinite(activityPointPercent) ||
      !activityPointPercent ||
      activityPointPercent <= 0
    ) {
      throw new Error("请先明确确认 OA 活动点位");
    }

    const couponRecognition = await this.loadRecognition(
      storedRecognitionForRole(input.draft, "couponTable"),
    );
    const whitelistRecognition = await this.loadRecognition(
      storedRecognitionForRole(input.draft, "whitelist"),
    );
    const blacklistRecognition = input.draft.task.sources.blacklist
      ? await this.loadRecognition(
          storedRecognitionForRole(input.draft, "blacklist"),
        )
      : undefined;
    for (const recognition of Object.values(input.draft.recognitions)) {
      if (recognition?.ai?.status === "pending") {
        throw new Error("AI 识别仍在进行，请等待最新卡片后再确认生成");
      }
    }
    const storedCoupon = storedRecognitionForRole(input.draft, "couponTable");
    const storedWhitelist = storedRecognitionForRole(input.draft, "whitelist");
    const storedBlacklist = input.draft.task.sources.blacklist
      ? storedRecognitionForRole(input.draft, "blacklist")
      : undefined;
    let draftForGeneration = input.draft;
    if (input.draft.task.pendingCalcImages.length) {
      if (input.draft.task.confirmedCalcImages.length) {
        throw new Error("请先选择追加或替换待确认的测算图片");
      }
      draftForGeneration = await this.commitCalcImageBatch({
        draft: input.draft,
        ownerOpenId: input.ownerOpenId,
        expectedRevision: input.expectedRevision,
        mode: "append",
        operationId: `${input.operationId}:initial-images`,
      });
    }
    const couponSet = await confirmRegularFullReductionCouponSet({
      recognition: couponRecognition,
      ownerId: input.ownerOpenId,
      revision: draftForGeneration.task.revision,
      ownerConfirmedCouponType: input.draft.selections.couponType,
      fieldCandidateIds: input.draft.selections.couponFieldCandidateIds,
      ownerFieldValues: {
        ...input.draft.selections.ownerFieldValues,
        activityPointPercent,
      },
      overrideReasons: input.draft.selections.overrideReasons,
      aiRecognition: storedCoupon.ai?.primary
        ? storedCoupon.ai.result
        : undefined,
    });
    const coupon = couponSet.tiers[0];
    const whitelist = await parseMultiSheetTieredIdentifierList({
      recognition: whitelistRecognition,
      role: "whitelist",
      aiSkuRegions: storedWhitelist.ai?.primary
        ? storedWhitelist.ai.result?.skuRegionCandidates
        : undefined,
    });
    const blacklist = blacklistRecognition
      ? await parseMultiSheetTieredIdentifierList({
          recognition: blacklistRecognition,
          role: "blacklist",
          aiSkuRegions: storedBlacklist?.ai?.primary
            ? storedBlacklist.ai.result?.skuRegionCandidates
            : undefined,
        })
      : undefined;
    const overlapIds = blacklist
      ? whitelist.entries
          .map((entry) => entry.id)
          .filter((id) => blacklist.entries.some((entry) => entry.id === id))
      : [];
    const overlapDecision = input.draft.selections.overlapDecision;
    if (overlapIds.length && !overlapDecision) {
      return this.dependencies.updateDraft(
        draftForGeneration,
        {
          coupon,
          whitelist,
          blacklist,
          validationIssues: [
            "白黑名单存在重叠，请选择白名单优先、黑名单优先或替换源文件",
          ],
        },
        draftForGeneration.task.revision,
      );
    }
    if (overlapDecision === "source_replacement_required") {
      throw new Error("请替换冲突源文件后重新确认");
    }

    let task = setCouponThreeSourceOverlap({
      task: draftForGeneration.task,
      ownerOpenId: input.ownerOpenId,
      expectedRevision: draftForGeneration.task.revision,
      overlap: {
        sha256: sha256(
          new TextEncoder().encode(JSON.stringify([...overlapIds].sort())),
        ),
        count: overlapIds.length,
        decision: overlapDecision,
      },
    });
    const packageValue = createCouponSetCanonicalPackage({
      ownerId: input.ownerOpenId,
      revision: task.revision,
      couponSet,
      whitelist,
      blacklistStatus: task.blacklistStatus,
      blacklist,
      overlapDecision,
    });
    task = confirmCouponThreeSourceSources({
      task,
      ownerOpenId: input.ownerOpenId,
      expectedRevision: task.revision,
      snapshotHash: packageValue.sourceConfirmationHash,
    });
    // Persist the in-flight marker before the slow freeze/upload phase so a
    // concurrent click or upload is rejected by the GeneratingArtifacts gate
    // instead of re-entering this read-modify-write path with a stale snapshot.
    // The persisted revision becomes the baseline for the final write below.
    draftForGeneration = await this.dependencies.updateDraft(
      draftForGeneration,
      { task },
      draftForGeneration.task.revision,
    );
    const artifacts = await generateOfflineArtifacts({
      package: packageValue,
      templates: await this.dependencies.loadTemplates(),
    });
    const couponArtifact = artifacts.find(
      (artifact) => artifact.role === "couponTable",
    );
    if (!couponArtifact) throw new Error("标准配券表生成后缺失");
    let screenshots: RenderedCouponScreenshot[] = [];
    if (coupon.input.businessMode !== "严选") {
      if (task.confirmedCalcImages.length) {
        screenshots = await Promise.all(
          task.confirmedCalcImages.map(async (image, order) => {
            const bytes = this.dependencies.downloadResource
              ? await this.dependencies.downloadResource({
                  messageId: image.messageId,
                  resourceKey: image.resourceKey,
                  type: image.resourceType,
                })
              : await downloadFeishuMessageResource({
                  messageId: image.messageId,
                  fileKey: image.resourceKey,
                  type: image.resourceType,
                });
            const inspected = await inspectUserCalcImage(bytes);
            if (
              inspected.sha256 !== image.sha256 ||
              inspected.bytes !== image.bytes ||
              inspected.contentType !== image.contentType
            ) {
              throw new Error(`已确认的测算图片 ${image.fileName} 已变更`);
            }
            return {
              artifactId: image.artifactId,
              order,
              role: "calcImage",
              provenance: "user",
              fileName: image.fileName,
              bytes,
              sha256: image.sha256,
              contentType: image.contentType,
              page: order + 1,
              pageCount: task.confirmedCalcImages.length,
            } satisfies RenderedCouponScreenshot;
          }),
        );
      } else {
        screenshots = await (
          this.dependencies.renderScreenshots ?? renderCouponArtifactScreenshots
        )({
          couponArtifact,
          revision: task.revision,
          businessMode: coupon.input.businessMode,
        });
      }
    }
    const frozenArtifacts = await Promise.all(
      [...artifacts, ...screenshots].map(async (artifact, order) => {
        const uploaded = await this.dependencies.uploadArtifact({
          name: artifact.fileName,
          folderToken: this.dependencies.folderToken(),
          contentType:
            artifact.role === "calcImage"
              ? artifact.contentType
              : xlsxContentType,
          bytes: artifact.bytes,
        });
        // In-card preview is auxiliary: a failed grant only hides the eye
        // entry and must not break freezing or the confirmation card.
        let previewGrantedFor: string | undefined;
        let previewGrantError: string | undefined;
        if (this.dependencies.grantArtifactPreview) {
          try {
            await this.dependencies.grantArtifactPreview({
              fileToken: uploaded.fileToken,
              memberOpenId: input.ownerOpenId,
            });
            previewGrantedFor = input.ownerOpenId;
          } catch (error) {
            previewGrantError =
              error instanceof Error ? error.message : String(error);
          }
        }
        return {
          artifactId:
            artifact.role === "calcImage"
              ? artifact.artifactId
              : `${artifact.role}-${artifact.sha256}`,
          order: artifact.role === "calcImage" ? artifact.order : order,
          role: artifact.role,
          fileName: artifact.fileName,
          fileToken: uploaded.fileToken,
          bytes: artifact.bytes.byteLength,
          sha256: artifact.sha256,
          templateId:
            artifact.role === "calcImage"
              ? (artifact.templateId ?? "user-upload")
              : artifact.template.id,
          templateVersion:
            artifact.role === "calcImage"
              ? (artifact.templateVersion ?? "1")
              : artifact.template.version,
          ...(previewGrantedFor ? { previewGrantedFor } : {}),
          ...(previewGrantError ? { previewGrantError } : {}),
          ...(artifact.role === "calcImage"
            ? {
                contentType: artifact.contentType,
                sourceArtifactSha256: artifact.sourceArtifactSha256,
                rendererVersion: artifact.rendererVersion,
                renderRange: artifact.renderRange,
              }
            : {}),
        };
      }),
    );
    task = saveCouponThreeSourceArtifacts({
      task,
      ownerOpenId: input.ownerOpenId,
      expectedRevision: task.revision,
      requiresCalcImage: coupon.input.businessMode !== "严选",
      artifacts: frozenArtifacts,
    });
    const oaPrefill = buildOaPrefillSnapshot({
      package: packageValue,
      artifacts,
      screenshots,
      activityPointPercent,
    });
    // The fully parsed coupon/whitelist/blacklist datasets are only needed
    // in memory for artifact generation and are baked into the frozen
    // artifacts plus the OA prefill snapshot. Persisting them would push the
    // Base State JSON past its cell limit and be silently dropped, so they
    // are cleared from the stored draft.
    return this.dependencies.updateDraft(
      draftForGeneration,
      {
        task,
        coupon: undefined,
        couponSet: undefined,
        whitelist: undefined,
        blacklist: undefined,
        package: undefined,
        artifacts: frozenArtifacts,
        oaPrefill,
        validationIssues: [],
        failureReason: undefined,
      },
      draftForGeneration.task.revision,
    );
  }

  async confirmFinalPreview(input: {
    draft: CouponThreeSourcePilotDraft;
    ownerOpenId: string;
    expectedRevision: number;
    operationId: string;
  }): Promise<CouponThreeSourcePilotDraft> {
    assertOwnerAndRevision(input);
    if (!input.operationId) throw new Error("三源提报操作 ID 不能为空");
    if (
      input.draft.task.status !== "AwaitingFinalConfirmation" ||
      !input.draft.oaPrefill
    ) {
      throw new Error("当前三源提报尚不能生成 OA 测试稿");
    }
    const oaDraft = await this.dependencies.handoff({
      ownerOpenId: input.ownerOpenId,
      prefill: input.draft.oaPrefill,
      artifacts: input.draft.artifacts,
      oaDraftRecordId: input.draft.oaDraftRecordId,
    });
    const persisted = await this.dependencies.updateDraft(
      input.draft,
      {
        oaDraftRecordId: oaDraft.recordId,
        validationIssues: [],
        failureReason: undefined,
      },
      input.expectedRevision,
    );
    const task = confirmCouponThreeSourceDraftOnly({
      task: persisted.task,
      ownerOpenId: input.ownerOpenId,
      expectedRevision: persisted.task.revision,
      snapshotHash:
        persisted.oaPrefill?.snapshotHash ?? input.draft.oaPrefill.snapshotHash,
    });
    return this.dependencies.updateDraft(
      persisted,
      {
        task,
        validationIssues: [],
        failureReason: undefined,
      },
      persisted.task.revision,
    );
  }

  async cancel(input: {
    draft: CouponThreeSourcePilotDraft;
    ownerOpenId: string;
    expectedRevision: number;
  }): Promise<CouponThreeSourcePilotDraft> {
    assertOwnerAndRevision(input);
    const task = cancelCouponThreeSourceTask({
      task: input.draft.task,
      ownerOpenId: input.ownerOpenId,
      expectedRevision: input.expectedRevision,
    });
    return this.dependencies.updateDraft(
      input.draft,
      { task },
      input.expectedRevision,
    );
  }

  /**
   * Reverts a draft stuck in GeneratingArtifacts after a failed generation
   * (e.g. transient Drive failure) back to the source-confirmation step.
   * The store's read-before-write guard makes this a no-op when another
   * attempt already completed or moved the draft on.
   */
  async recoverFailedGeneration(input: {
    draft: CouponThreeSourcePilotDraft;
    ownerOpenId: string;
    expectedRevision: number;
  }): Promise<CouponThreeSourcePilotDraft | undefined> {
    assertOwnerAndRevision(input);
    if (input.draft.task.status !== "GeneratingArtifacts") {
      return undefined;
    }
    const task = {
      ...input.draft.task,
      status: "AwaitingSourceConfirmation" as const,
    };
    return this.dependencies.updateDraft(
      input.draft,
      { task, failureReason: undefined },
      input.expectedRevision,
    );
  }

  private async assignSource(input: {
    draft: CouponThreeSourcePilotDraft;
    ownerOpenId: string;
    expectedRevision: number;
    role: SourceRole;
    recognition: StoredWorkbookRecognition;
    messageId: string;
  }): Promise<CouponThreeSourcePilotDraft> {
    const source: CouponThreeSourceSourceFile = {
      role: input.role,
      ...input.recognition.source,
    };
    const task = replaceCouponThreeSourceSource({
      task: input.draft.task,
      ownerOpenId: input.ownerOpenId,
      expectedRevision: input.expectedRevision,
      source,
    });
    return this.dependencies.updateDraft(
      input.draft,
      {
        task,
        recognitions: Object.fromEntries(
          Object.entries({
            ...input.draft.recognitions,
            [input.role]: input.recognition,
          }).map(([role, recognition]) => [
            role,
            recognition ? { ...recognition, ai: undefined } : recognition,
          ]),
        ),
        pendingRecognition: undefined,
        selections: {},
        coupon: undefined,
        whitelist: undefined,
        blacklist: undefined,
        package: undefined,
        artifacts: [],
        oaPrefill: undefined,
        oaDraftRecordId: undefined,
        processedMessageIds: [
          ...new Set([...input.draft.processedMessageIds, input.messageId]),
        ],
        validationIssues: [],
        failureReason: undefined,
      },
      input.expectedRevision,
    );
  }

  private async activatePendingRecognitions(
    recognitions: CouponThreeSourcePilotDraft["recognitions"],
  ): Promise<void> {
    if (!this.dependencies.activateAiRecognition) return;
    for (const recognition of Object.values(recognitions)) {
      if (recognition?.ai?.status !== "pending") continue;
      await this.dependencies.activateAiRecognition(recognition.ai.runId);
    }
  }

  private async loadRecognition(stored: StoredWorkbookRecognition) {
    const bytes = await this.dependencies.downloadSource(stored.source);
    if (
      bytes.byteLength !== stored.source.bytes ||
      sha256(bytes) !== stored.source.sha256
    ) {
      throw new Error(
        `来源文件 ${stored.source.fileName} 已变化，无法继续当前版本`,
      );
    }
    const recognition = await inspectThreeSourceWorkbook({
      fileName: stored.source.fileName,
      bytes,
    });
    if (recognition.sourceHash !== stored.sourceHash) {
      throw new Error(`来源文件 ${stored.source.fileName} hash 不一致`);
    }
    return recognition;
  }
}
