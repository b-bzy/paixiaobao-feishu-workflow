import type { BlacklistStatus, OverlapDecision, SourceRole } from "./types";

export const couponThreeSourceTaskSchemaVersion = "coupon-three-source-r2-v2";

export type CalcImageMergeMode = "append" | "replace_all";

export interface UserCalcImageSource {
  artifactId: string;
  messageId: string;
  resourceKey: string;
  resourceType: "file" | "image";
  sourceType: "feishu_file" | "feishu_image";
  fileName: string;
  contentType: "image/png" | "image/jpeg";
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  receivedOrder: number;
  receivedAt: string;
  revision: number;
  actorOpenId: string;
}

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

export type PendingCouponThreeSourceSourceFile = Omit<
  CouponThreeSourceSourceFile,
  "role"
>;

export interface CouponThreeSourceArtifact {
  artifactId: string;
  order: number;
  role: "couponTable" | "productWhitelist" | "productBlacklist" | "calcImage";
  fileName: string;
  bytes: number;
  sha256: string;
  /** The standard coupon workbook hash that produced the render. */
  sourceArtifactSha256?: string;
  rendererVersion?: string;
  renderRange?: string;
  contentType?: "image/png" | "image/jpeg";
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
  confirmedCalcImages: UserCalcImageSource[];
  pendingCalcImages: UserCalcImageSource[];
  processedCalcImageOperationIds: string[];
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
    confirmedCalcImages: [],
    pendingCalcImages: [],
    processedCalcImageOperationIds: [],
    artifacts: [],
  };
}

export function stageCouponThreeSourceCalcImage(input: {
  task: CouponThreeSourceTask;
  ownerOpenId: string;
  expectedRevision: number;
  image: Omit<
    UserCalcImageSource,
    "revision" | "actorOpenId" | "receivedOrder"
  >;
}): CouponThreeSourceTask {
  assertOwnerAndRevision(input.task, input);
  if (
    !input.image.artifactId ||
    !input.image.messageId ||
    !input.image.resourceKey
  ) {
    throw new Error("测算图片缺少稳定资源标识");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.image.sha256)) {
    throw new Error("测算图片 hash 无效");
  }
  if (
    !Number.isSafeInteger(input.image.bytes) ||
    input.image.bytes <= 0 ||
    !Number.isSafeInteger(input.image.width) ||
    input.image.width <= 0 ||
    !Number.isSafeInteger(input.image.height) ||
    input.image.height <= 0
  ) {
    throw new Error("测算图片尺寸或大小无效");
  }
  if (
    input.task.pendingCalcImages.some(
      (image) =>
        image.messageId === input.image.messageId ||
        image.sha256 === input.image.sha256,
    ) ||
    input.task.confirmedCalcImages.some(
      (image) =>
        image.messageId === input.image.messageId ||
        image.sha256 === input.image.sha256,
    )
  ) {
    return input.task;
  }
  if (
    input.task.confirmedCalcImages.length +
      input.task.pendingCalcImages.length >=
    20
  ) {
    throw new Error("每次三源提报最多接收 20 张测算图片");
  }
  const image: UserCalcImageSource = {
    ...input.image,
    receivedOrder:
      input.task.confirmedCalcImages.length +
      input.task.pendingCalcImages.length,
    revision: input.task.revision + 1,
    actorOpenId: input.ownerOpenId,
  };
  return nextRevision(input.task, {
    pendingCalcImages: [...input.task.pendingCalcImages, image],
    status: collectingStatus(input.task),
  });
}

export function commitCouponThreeSourceCalcImageBatch(input: {
  task: CouponThreeSourceTask;
  ownerOpenId: string;
  expectedRevision: number;
  mode: CalcImageMergeMode;
  operationId: string;
}): CouponThreeSourceTask {
  assertOwnerAndRevision(input.task, input);
  if (!input.operationId.trim()) throw new Error("测算图片操作 ID 不能为空");
  if (input.task.processedCalcImageOperationIds.includes(input.operationId)) {
    return input.task;
  }
  if (!input.task.pendingCalcImages.length) {
    throw new Error("当前没有待确认的测算图片");
  }
  const merged =
    input.mode === "replace_all"
      ? input.task.pendingCalcImages
      : [...input.task.confirmedCalcImages, ...input.task.pendingCalcImages];
  if (merged.length > 20) throw new Error("每次三源提报最多确认 20 张测算图片");
  const confirmedCalcImages = merged.map((image, order) => ({
    ...image,
    receivedOrder: order,
    revision: input.task.revision + 1,
    actorOpenId: input.ownerOpenId,
  }));
  return nextRevision(input.task, {
    confirmedCalcImages,
    pendingCalcImages: [],
    processedCalcImageOperationIds: [
      ...input.task.processedCalcImageOperationIds,
      input.operationId,
    ],
    status: collectingStatus(input.task),
  });
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

export function stageCouponThreeSourcePendingSource(input: {
  task: CouponThreeSourceTask;
  ownerOpenId: string;
  expectedRevision: number;
  source: PendingCouponThreeSourceSourceFile;
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
  return nextRevision(input.task, {
    overlap: undefined,
    status: "Collecting",
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
    input.artifacts
      .filter((artifact) => artifact.role !== "calcImage")
      .map((artifact) => [artifact.role, artifact]),
  );
  const couponTable = byRole.get("couponTable");
  const whitelist = byRole.get("productWhitelist");
  const images = input.artifacts
    .filter((artifact) => artifact.role === "calcImage")
    .sort((left, right) => left.order - right.order);
  const nonImageArtifacts = input.artifacts.filter(
    (artifact) => artifact.role !== "calcImage",
  );
  if (
    new Set(nonImageArtifacts.map((artifact) => artifact.role)).size !==
    nonImageArtifacts.length
  ) {
    throw new Error("标准 Excel 产物角色不能重复");
  }
  if (!input.requiresCalcImage && images.length) {
    throw new Error("严选业务模式不能冻结测算图片");
  }
  if (
    !couponTable ||
    !whitelist ||
    (input.requiresCalcImage && !images.length)
  ) {
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
    images.some(
      (image) =>
        image.sourceArtifactSha256 &&
        (image.sourceArtifactSha256 !== couponTable.sha256 ||
          !image.rendererVersion ||
          !image.renderRange),
    )
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
  const artifactIds = new Set(
    input.artifacts.map((artifact) => artifact.artifactId),
  );
  if (artifactIds.size !== input.artifacts.length) {
    throw new Error("冻结产物 ID 不能重复");
  }
  if (images.some((image, index) => image.order !== index)) {
    throw new Error("测算图片顺序必须从 0 连续递增");
  }
  if (images.some((image) => !image.contentType)) {
    throw new Error("测算图片缺少真实 MIME");
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
