import type { BlacklistStatus, OverlapDecision, SourceRole } from "./types";

export const couponThreeSourceTaskSchemaVersion = "coupon-three-source-r2-v1";

export const couponThreeSourceTaskStatuses = [
  "Collecting",
  "AwaitingSourceConfirmation",
  "GeneratingArtifacts",
  "AwaitingFinalConfirmation",
  "DraftOnlyConfirmed",
  "Canceled",
] as const;
export type CouponThreeSourceTaskStatus =
  (typeof couponThreeSourceTaskStatuses)[number];

export interface CouponThreeSourceSourceFile {
  role: SourceRole;
  messageId: string;
  fileKey: string;
  fileName: string;
  bytes: number;
  sha256: string;
}

export interface CouponThreeSourceArtifact {
  role: "couponTable" | "productWhitelist" | "productBlacklist" | "calcImage";
  fileName: string;
  bytes: number;
  sha256: string;
  /** The standard coupon workbook hash that produced the render. */
  sourceArtifactSha256?: string;
  rendererVersion?: string;
  renderRange?: string;
}

export interface CouponThreeSourceConfirmation {
  actorOpenId: string;
  revision: number;
  snapshotHash: string;
}

export interface CouponThreeSourceTask {
  taskId: string;
  ownerOpenId: string;
  schemaVersion: typeof couponThreeSourceTaskSchemaVersion;
  revision: number;
  status: CouponThreeSourceTaskStatus;
  sources: Partial<Record<SourceRole, CouponThreeSourceSourceFile>>;
  blacklistStatus: BlacklistStatus;
  overlap?: { sha256: string; count: number; decision?: OverlapDecision };
  sourceConfirmation?: CouponThreeSourceConfirmation;
  finalConfirmation?: CouponThreeSourceConfirmation;
  artifacts: CouponThreeSourceArtifact[];
}

function assertOwnerAndRevision(
  task: CouponThreeSourceTask,
  input: { ownerOpenId: string; expectedRevision: number },
): void {
  if (task.ownerOpenId !== input.ownerOpenId) {
    throw new Error("只有当前三源提报创建人可以继续操作");
  }
  if (task.revision !== input.expectedRevision) {
    throw new Error("当前三源提报版本已变化，请使用最新卡片");
  }
  if (["DraftOnlyConfirmed", "Canceled"].includes(task.status)) {
    throw new Error("当前三源提报已结束，不能继续修改");
  }
}

function nextRevision(
  task: CouponThreeSourceTask,
  changes: Partial<CouponThreeSourceTask>,
): CouponThreeSourceTask {
  return {
    ...task,
    ...changes,
    revision: task.revision + 1,
    sourceConfirmation: undefined,
    finalConfirmation: undefined,
    artifacts: [],
  };
}

function collectingStatus(
  task: CouponThreeSourceTask,
): CouponThreeSourceTaskStatus {
  if (!task.sources.couponTable || !task.sources.whitelist) return "Collecting";
  if (task.blacklistStatus === "absent_pending_confirmation") {
    return "Collecting";
  }
  return "AwaitingSourceConfirmation";
}

export function createCouponThreeSourceTask(input: {
  taskId: string;
  ownerOpenId: string;
}): CouponThreeSourceTask {
  if (!input.taskId.trim()) throw new Error("三源提报任务 ID 不能为空");
  if (!input.ownerOpenId.trim()) throw new Error("三源提报创建人不能为空");
  return {
    taskId: input.taskId,
    ownerOpenId: input.ownerOpenId,
    schemaVersion: couponThreeSourceTaskSchemaVersion,
    revision: 1,
    status: "Collecting",
    sources: {},
    blacklistStatus: "absent_pending_confirmation",
    artifacts: [],
  };
}

/**
 * Adds or replaces an immutable source reference. The caller must perform any
 * workbook inspection before showing mapping choices; this aggregate only owns
 * revision invalidation and source-role state.
 */
export function replaceCouponThreeSourceSource(input: {
  task: CouponThreeSourceTask;
  ownerOpenId: string;
  expectedRevision: number;
  source: CouponThreeSourceSourceFile;
}): CouponThreeSourceTask {
  assertOwnerAndRevision(input.task, input);
  if (!input.source.fileName.toLowerCase().endsWith(".xlsx")) {
    throw new Error("三源提报只接受 .xlsx 源文件");
  }
  if (!input.source.messageId || !input.source.fileKey) {
    throw new Error("三源提报源文件缺少飞书消息引用");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.source.sha256)) {
    throw new Error("三源提报源文件 hash 无效");
  }
  if (!Number.isSafeInteger(input.source.bytes) || input.source.bytes <= 0) {
    throw new Error("三源提报源文件大小无效");
  }

  const sources = { ...input.task.sources, [input.source.role]: input.source };
  const blacklistStatus =
    input.source.role === "blacklist" ? "uploaded" : input.task.blacklistStatus;
  const candidate = { ...input.task, sources, blacklistStatus };
  return nextRevision(input.task, {
    sources,
    blacklistStatus,
    overlap: undefined,
    status: collectingStatus(candidate),
  });
}

export function confirmCouponThreeSourceNoBlacklist(input: {
  task: CouponThreeSourceTask;
  ownerOpenId: string;
  expectedRevision: number;
}): CouponThreeSourceTask {
  assertOwnerAndRevision(input.task, input);
  if (input.task.sources.blacklist) {
    throw new Error("已上传黑名单，不能确认本次无黑名单");
  }
  if (input.task.blacklistStatus === "invalid") {
    throw new Error("无效黑名单必须先替换，不能确认本次无黑名单");
  }
  const candidate = {
    ...input.task,
    blacklistStatus: "absent_confirmed" as const,
  };
  return nextRevision(input.task, {
    blacklistStatus: "absent_confirmed",
    overlap: undefined,
    status: collectingStatus(candidate),
  });
}

export function setCouponThreeSourceOverlap(input: {
  task: CouponThreeSourceTask;
  ownerOpenId: string;
  expectedRevision: number;
  overlap: { sha256: string; count: number; decision?: OverlapDecision };
}): CouponThreeSourceTask {
  assertOwnerAndRevision(input.task, input);
  if (!/^[a-f0-9]{64}$/i.test(input.overlap.sha256)) {
    throw new Error("名单交集 hash 无效");
  }
  if (!Number.isSafeInteger(input.overlap.count) || input.overlap.count < 0) {
    throw new Error("名单交集数量无效");
  }
  if (input.overlap.count > 0 && !input.overlap.decision) {
    throw new Error("白黑名单交集必须明确处理决定");
  }
  if (input.overlap.decision === "source_replacement_required") {
    throw new Error("请替换冲突源文件后重新确认");
  }
  return nextRevision(input.task, {
    overlap: input.overlap,
    status: collectingStatus(input.task),
  });
}

export function confirmCouponThreeSourceSources(input: {
  task: CouponThreeSourceTask;
  ownerOpenId: string;
  expectedRevision: number;
  snapshotHash: string;
}): CouponThreeSourceTask {
  assertOwnerAndRevision(input.task, input);
  if (!input.task.sources.couponTable || !input.task.sources.whitelist) {
    throw new Error("必须先提供配券表和商品白名单");
  }
  if (input.task.blacklistStatus === "absent_pending_confirmation") {
    throw new Error("必须明确确认“本次无黑名单”后才能继续");
  }
  if (input.task.blacklistStatus === "invalid") {
    throw new Error("无效黑名单不能进入标准产物生成");
  }
  if (input.task.overlap?.count && !input.task.overlap.decision) {
    throw new Error("白黑名单交集尚未处理");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.snapshotHash)) {
    throw new Error("来源确认快照 hash 无效");
  }
  return {
    ...input.task,
    status: "GeneratingArtifacts",
    sourceConfirmation: {
      actorOpenId: input.ownerOpenId,
      revision: input.task.revision,
      snapshotHash: input.snapshotHash,
    },
  };
}

export function saveCouponThreeSourceArtifacts(input: {
  task: CouponThreeSourceTask;
  ownerOpenId: string;
  expectedRevision: number;
  requiresCalcImage: boolean;
  artifacts: CouponThreeSourceArtifact[];
}): CouponThreeSourceTask {
  assertOwnerAndRevision(input.task, input);
  if (input.task.status !== "GeneratingArtifacts") {
    throw new Error("当前状态不能冻结三源标准产物");
  }
  const byRole = new Map(
    input.artifacts.map((artifact) => [artifact.role, artifact]),
  );
  const couponTable = byRole.get("couponTable");
  const whitelist = byRole.get("productWhitelist");
  const image = byRole.get("calcImage");
  if (!couponTable || !whitelist || (input.requiresCalcImage && !image)) {
    throw new Error(
      input.requiresCalcImage
        ? "缺少标准配券表、标准白名单或配券表渲染图片"
        : "缺少标准配券表或标准白名单",
    );
  }
  if (
    input.task.blacklistStatus === "uploaded" &&
    !byRole.has("productBlacklist")
  ) {
    throw new Error("已上传黑名单时必须生成标准黑名单");
  }
  if (
    image &&
    (image.sourceArtifactSha256 !== couponTable.sha256 ||
      !image.rendererVersion ||
      !image.renderRange)
  ) {
    throw new Error("配券表渲染图片未绑定当前标准配券表");
  }
  for (const artifact of input.artifacts) {
    if (
      !artifact.fileName ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes <= 0 ||
      !/^[a-f0-9]{64}$/i.test(artifact.sha256)
    ) {
      throw new Error("标准产物元数据无效");
    }
  }
  return {
    ...input.task,
    artifacts: [...input.artifacts],
    status: "AwaitingFinalConfirmation",
  };
}

export function confirmCouponThreeSourceDraftOnly(input: {
  task: CouponThreeSourceTask;
  ownerOpenId: string;
  expectedRevision: number;
  snapshotHash: string;
}): CouponThreeSourceTask {
  assertOwnerAndRevision(input.task, input);
  if (input.task.status !== "AwaitingFinalConfirmation") {
    throw new Error("当前状态不能确认系统草稿");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.snapshotHash)) {
    throw new Error("最终预填快照 hash 无效");
  }
  return {
    ...input.task,
    status: "DraftOnlyConfirmed",
    finalConfirmation: {
      actorOpenId: input.ownerOpenId,
      revision: input.task.revision,
      snapshotHash: input.snapshotHash,
    },
  };
}

export function cancelCouponThreeSourceTask(input: {
  task: CouponThreeSourceTask;
  ownerOpenId: string;
  expectedRevision: number;
}): CouponThreeSourceTask {
  assertOwnerAndRevision(input.task, input);
  return { ...input.task, status: "Canceled" };
}
