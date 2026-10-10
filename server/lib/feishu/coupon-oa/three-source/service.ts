import { createHash, randomUUID } from "node:crypto";
import { parseTieredIdentifierList } from "../../../coupon-oa/three-source/lists";
import {
  extractRegularFullReductionInput,
  inspectThreeSourceWorkbook,
  selectUniqueRole,
} from "../../../coupon-oa/three-source/recognition";
import {
  type CouponThreeSourceSourceFile,
  cancelCouponThreeSourceTask,
  confirmCouponThreeSourceDraftOnly,
  confirmCouponThreeSourceNoBlacklist,
  confirmCouponThreeSourceSources,
  createCouponThreeSourceTask,
  replaceCouponThreeSourceSource,
  saveCouponThreeSourceArtifacts,
  setCouponThreeSourceOverlap,
} from "../../../coupon-oa/three-source/task";
import type { SourceRole } from "../../../coupon-oa/three-source/types";
import {
  buildOaPrefillSnapshot,
  buildSourceConfirmation,
  createCanonicalPackage,
  generateOfflineArtifacts,
} from "../../../coupon-oa/three-source/workflow";
import { uploadFeishuDriveFile } from "../../drive-client";
import { downloadFeishuMessageResource } from "../../message-client";
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
  uploadArtifact(input: {
    name: string;
    folderToken: string;
    contentType: string;
    bytes: Uint8Array;
  }): Promise<{ fileToken: string }>;
  folderToken(): string;
  loadTemplates: typeof loadCouponThreeSourceTemplates;
  createDraft: typeof createCouponThreeSourcePilotDraft;
  getDraft: typeof getCouponThreeSourcePilotDraft;
  listActive: typeof listActiveCouponThreeSourcePilotDrafts;
  updateDraft: typeof updateCouponThreeSourcePilotDraft;
  handoff: typeof handoffThreeSourcePilotToOaDraft;
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

function sourceForRole(
  draft: CouponThreeSourcePilotDraft,
  role: SourceRole,
): CouponThreeSourceSourceFile {
  const source = draft.task.sources[role];
  if (!source) throw new Error(`缺少${role}材料`);
  return source;
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
    uploadArtifact: uploadFeishuDriveFile,
    folderToken: getCouponThreeSourcePilotFolderToken,
    loadTemplates: loadCouponThreeSourceTemplates,
    createDraft: createCouponThreeSourcePilotDraft,
    getDraft: getCouponThreeSourcePilotDraft,
    listActive: listActiveCouponThreeSourcePilotDrafts,
    updateDraft: updateCouponThreeSourcePilotDraft,
    handoff: handoffThreeSourcePilotToOaDraft,
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
    const stored = toStoredWorkbookRecognition({ recognition, source });
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
    const coupon = sourceForRole(input.draft, "couponTable");
    const task = replaceCouponThreeSourceSource({
      task: input.draft.task,
      ownerOpenId: input.ownerOpenId,
      expectedRevision: input.expectedRevision,
      source: coupon,
    });
    return this.dependencies.updateDraft(
      input.draft,
      {
        task,
        selections: { ...input.draft.selections, ...input.selections },
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
    const coupon = await extractRegularFullReductionInput({
      recognition: couponRecognition,
      fieldCandidateIds: input.draft.selections.couponFieldCandidateIds,
    });
    if (coupon.input.businessMode !== "严选") {
      throw new Error("三源 Bot 首期仅支持严选业务模式");
    }
    const whitelist = await parseTieredIdentifierList({
      recognition: whitelistRecognition,
      role: "whitelist",
      ...input.draft.selections.whitelist,
    });
    const blacklist = blacklistRecognition
      ? await parseTieredIdentifierList({
          recognition: blacklistRecognition,
          role: "blacklist",
          ...input.draft.selections.blacklist,
        })
      : undefined;
    const confirmation = buildSourceConfirmation({
      ownerId: input.ownerOpenId,
      revision: input.draft.task.revision,
      coupon,
      whitelist,
      blacklistStatus: input.draft.task.blacklistStatus,
      blacklist,
    });
    const overlapDecision = input.draft.selections.overlapDecision;
    if (confirmation.overlap.ids.length && !overlapDecision) {
      return this.dependencies.updateDraft(
        input.draft,
        {
          coupon,
          whitelist,
          blacklist,
          validationIssues: [
            "白黑名单存在重叠，请选择白名单优先、黑名单优先或替换源文件",
          ],
        },
        input.expectedRevision,
      );
    }
    if (overlapDecision === "source_replacement_required") {
      throw new Error("请替换冲突源文件后重新确认");
    }

    let task = setCouponThreeSourceOverlap({
      task: input.draft.task,
      ownerOpenId: input.ownerOpenId,
      expectedRevision: input.expectedRevision,
      overlap: {
        sha256: confirmation.overlap.sha256,
        count: confirmation.overlap.ids.length,
        decision: overlapDecision,
      },
    });
    const revisionConfirmation = buildSourceConfirmation({
      ownerId: input.ownerOpenId,
      revision: task.revision,
      coupon,
      whitelist,
      blacklistStatus: task.blacklistStatus,
      blacklist,
    });
    const packageValue = createCanonicalPackage({
      confirmation: revisionConfirmation,
      ownerId: input.ownerOpenId,
      expectedRevision: task.revision,
      overlapDecision,
    });
    task = confirmCouponThreeSourceSources({
      task,
      ownerOpenId: input.ownerOpenId,
      expectedRevision: task.revision,
      snapshotHash: revisionConfirmation.snapshotHash,
    });
    const artifacts = await generateOfflineArtifacts({
      package: packageValue,
      templates: await this.dependencies.loadTemplates(),
    });
    const frozenArtifacts = await Promise.all(
      artifacts.map(async (artifact) => {
        const uploaded = await this.dependencies.uploadArtifact({
          name: artifact.fileName,
          folderToken: this.dependencies.folderToken(),
          contentType: xlsxContentType,
          bytes: artifact.bytes,
        });
        return {
          role: artifact.role,
          fileName: artifact.fileName,
          fileToken: uploaded.fileToken,
          bytes: artifact.bytes.byteLength,
          sha256: artifact.sha256,
          templateId: artifact.template.id,
          templateVersion: artifact.template.version,
        };
      }),
    );
    task = saveCouponThreeSourceArtifacts({
      task,
      ownerOpenId: input.ownerOpenId,
      expectedRevision: task.revision,
      requiresCalcImage: false,
      artifacts: frozenArtifacts,
    });
    const oaPrefill = buildOaPrefillSnapshot({
      package: packageValue,
      artifacts,
      activityPointPercent,
    });
    return this.dependencies.updateDraft(
      input.draft,
      {
        task,
        coupon,
        whitelist,
        blacklist,
        package: packageValue,
        artifacts: frozenArtifacts,
        oaPrefill,
        validationIssues: [],
        failureReason: undefined,
      },
      input.expectedRevision,
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
        recognitions: {
          ...input.draft.recognitions,
          [input.role]: input.recognition,
        },
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
