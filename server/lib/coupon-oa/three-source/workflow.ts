import { createHash } from "node:crypto";
import {
  generateDynamicSkuListWorkbook,
  generateRegularFullReductionWorkbook,
  generateRegularFullReductionWorkbookSet,
  generateSingleCouponSkuListWorkbook,
} from "../../excel-template-engine";
import {
  multiTierSkuBlacklistManifest,
  multiTierSkuWhitelistManifest,
  regularFullReductionManifest,
  singleCouponSkuBlacklistManifest,
  singleCouponSkuWhitelistManifest,
} from "../../excel-template-engine/template-manifests";
import { computeRegularFullReductionValues } from "../calculation";
import {
  applyOverlapDecision,
  computeOverlap,
  groupIdentifiersByTier,
} from "./lists";
import type {
  BlacklistStatus,
  CanonicalPackage,
  ConfirmedCouponSetSource,
  ConfirmedCouponSource,
  OaPrefillSnapshot,
  OfflineArtifact,
  OverlapDecision,
  ParsedSingleCouponIdentifierList,
  ParsedTieredIdentifierList,
  RenderedCouponScreenshot,
  SourceConfirmation,
} from "./types";
import { threeSourceRuleVersion } from "./types";

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableHash(value: unknown): string {
  return sha256(`${threeSourceRuleVersion}:${JSON.stringify(value)}`);
}

function assertListIsUsable(
  list: ParsedTieredIdentifierList,
  label: string,
): void {
  if (list.issues.length) {
    throw new Error(`${label}存在未解决的数据问题：${list.issues.join("；")}`);
  }
  if (!list.entries.length) {
    throw new Error(`${label}不能是空名单`);
  }
  if (list.dimension !== "SKU") {
    throw new Error(`${label}不是 SKU 维度，当前标准模板不支持`);
  }
}

function confirmationSnapshot(input: {
  ownerId: string;
  revision: number;
  coupon: ConfirmedCouponSource;
  whitelist: ParsedTieredIdentifierList;
  blacklistStatus: BlacklistStatus;
  blacklist?: ParsedTieredIdentifierList;
  overlapSha256: string;
}): Record<string, unknown> {
  return {
    ownerId: input.ownerId,
    revision: input.revision,
    coupon: {
      sourceHash: input.coupon.sourceHash,
      input: input.coupon.input,
      provenance: input.coupon.provenance,
    },
    whitelist: {
      sourceHash: input.whitelist.sourceHash,
      dimension: input.whitelist.dimension,
      entries: input.whitelist.entries.map(({ id, tier, provenance }) => ({
        id,
        tier,
        provenance,
      })),
    },
    blacklistStatus: input.blacklistStatus,
    blacklist: input.blacklist
      ? {
          sourceHash: input.blacklist.sourceHash,
          dimension: input.blacklist.dimension,
          entries: input.blacklist.entries.map(({ id, tier, provenance }) => ({
            id,
            tier,
            provenance,
          })),
        }
      : undefined,
    overlapSha256: input.overlapSha256,
  };
}

export interface BuildSourceConfirmationInput {
  ownerId: string;
  revision: number;
  coupon: ConfirmedCouponSource;
  whitelist: ParsedTieredIdentifierList;
  blacklistStatus: BlacklistStatus;
  blacklist?: ParsedTieredIdentifierList;
}

/**
 * First-confirmation gate. This models an explicit business confirmation only;
 * it does not persist anything or access a Feishu service.
 */
export function buildSourceConfirmation(
  input: BuildSourceConfirmationInput,
): SourceConfirmation {
  if (!input.ownerId.trim()) throw new Error("必须提供业务员标识");
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new Error("revision 必须是从 1 开始的整数");
  }
  assertListIsUsable(input.whitelist, "白名单");

  if (input.blacklistStatus === "invalid") {
    throw new Error("已上传黑名单无效，不能将其视为无黑名单");
  }
  if (input.blacklistStatus === "uploaded") {
    if (!input.blacklist)
      throw new Error("黑名单状态为 uploaded 时必须提供黑名单");
    assertListIsUsable(input.blacklist, "黑名单");
  } else if (input.blacklist) {
    throw new Error("非 uploaded 黑名单状态不能附带黑名单数据");
  }

  const overlap = computeOverlap(input.whitelist, input.blacklist);
  const snapshotHash = stableHash(
    confirmationSnapshot({ ...input, overlapSha256: overlap.sha256 }),
  );
  return {
    ownerId: input.ownerId,
    revision: input.revision,
    snapshotHash,
    coupon: input.coupon,
    whitelist: input.whitelist,
    blacklistStatus: input.blacklistStatus,
    blacklist: input.blacklist,
    overlap,
  };
}

export function assertExpectedRevision(
  confirmation: SourceConfirmation,
  ownerId: string,
  expectedRevision: number,
): void {
  if (confirmation.ownerId !== ownerId) {
    throw new Error("不能确认其他业务员的数据包");
  }
  if (confirmation.revision !== expectedRevision) {
    throw new Error(
      `确认版本已过期：当前为 v${confirmation.revision}，请求的是 v${expectedRevision}`,
    );
  }
}

export interface CreateCanonicalPackageInput {
  confirmation: SourceConfirmation;
  ownerId: string;
  expectedRevision: number;
  overlapDecision?: OverlapDecision;
}

export function createCanonicalPackage(
  input: CreateCanonicalPackageInput,
): CanonicalPackage {
  const { confirmation } = input;
  assertExpectedRevision(confirmation, input.ownerId, input.expectedRevision);
  if (confirmation.blacklistStatus === "absent_pending_confirmation") {
    throw new Error("必须明确确认“本次无黑名单”后才能继续");
  }
  if (confirmation.blacklistStatus === "invalid") {
    throw new Error("无效黑名单不能进入标准附件生成");
  }
  assertListIsUsable(confirmation.whitelist, "白名单");
  if (confirmation.blacklistStatus === "uploaded" && confirmation.blacklist) {
    assertListIsUsable(confirmation.blacklist, "黑名单");
  }

  const recomputedOverlap = computeOverlap(
    confirmation.whitelist,
    confirmation.blacklist,
  );
  if (recomputedOverlap.sha256 !== confirmation.overlap.sha256) {
    throw new Error("源名单已变化，旧的重叠确认已失效");
  }
  const recalculatedSnapshotHash = stableHash(
    confirmationSnapshot({
      ownerId: confirmation.ownerId,
      revision: confirmation.revision,
      coupon: confirmation.coupon,
      whitelist: confirmation.whitelist,
      blacklistStatus: confirmation.blacklistStatus,
      blacklist: confirmation.blacklist,
      overlapSha256: recomputedOverlap.sha256,
    }),
  );
  if (recalculatedSnapshotHash !== confirmation.snapshotHash) {
    throw new Error("源材料、映射或确认状态已变化，旧的第一次确认已失效");
  }
  const resolved = applyOverlapDecision({
    whitelist: confirmation.whitelist,
    blacklist: confirmation.blacklist,
    decision: input.overlapDecision,
  });
  const computed = computeRegularFullReductionValues(confirmation.coupon.input);
  return {
    ownerId: confirmation.ownerId,
    revision: confirmation.revision,
    sourceConfirmationHash: confirmation.snapshotHash,
    coupon: confirmation.coupon,
    computed,
    whitelistByTier: groupIdentifiersByTier(resolved.whitelist),
    blacklistByTier: resolved.blacklist
      ? groupIdentifiersByTier(resolved.blacklist)
      : undefined,
    blacklistStatus: confirmation.blacklistStatus,
    overlap: resolved.overlap,
  };
}

export interface OfflineArtifactTemplates {
  regularFullReductionTemplateBytes: Uint8Array;
  whitelistTemplateBytes: Uint8Array;
  blacklistTemplateBytes: Uint8Array;
}

export function createCouponSetCanonicalPackage(input: {
  ownerId: string;
  revision: number;
  couponSet: ConfirmedCouponSetSource;
  whitelist: ParsedTieredIdentifierList;
  blacklistStatus: BlacklistStatus;
  blacklist?: ParsedTieredIdentifierList;
  overlapDecision?: OverlapDecision;
}): CanonicalPackage {
  if (!input.couponSet.tiers.length) throw new Error("至少需要一个优惠券档位");
  assertListIsUsable(input.whitelist, "白名单");
  if (input.blacklistStatus === "absent_pending_confirmation") {
    throw new Error("必须明确确认“本次无黑名单”后才能继续");
  }
  if (input.blacklistStatus === "uploaded") {
    if (!input.blacklist) throw new Error("已上传黑名单但缺少解析结果");
    assertListIsUsable(input.blacklist, "黑名单");
  }
  const overlap = computeOverlap(input.whitelist, input.blacklist);
  const resolved = applyOverlapDecision({
    whitelist: input.whitelist,
    blacklist: input.blacklist,
    decision: input.overlapDecision,
  });
  const coupon = input.couponSet.tiers[0];
  const computed = computeRegularFullReductionValues(coupon.input);
  return {
    ownerId: input.ownerId,
    revision: input.revision,
    sourceConfirmationHash: stableHash({
      ownerId: input.ownerId,
      revision: input.revision,
      couponSet: input.couponSet.tiers.map((tier) => ({
        sourceHash: tier.sourceHash,
        input: tier.input,
      })),
      whitelist: resolved.whitelist.entries.map(({ id, tier }) => ({
        id,
        tier,
      })),
      blacklist: resolved.blacklist?.entries.map(({ id, tier }) => ({
        id,
        tier,
      })),
      overlap,
    }),
    coupon,
    couponSet: input.couponSet,
    computed,
    whitelistByTier: groupIdentifiersByTier(resolved.whitelist),
    blacklistByTier: resolved.blacklist
      ? groupIdentifiersByTier(resolved.blacklist)
      : undefined,
    blacklistStatus: input.blacklistStatus,
    overlap: { ...overlap, decision: input.overlapDecision },
  };
}

export async function generateOfflineArtifacts(input: {
  package: CanonicalPackage;
  templates: OfflineArtifactTemplates;
}): Promise<OfflineArtifact[]> {
  const couponWorkbook = input.package.couponSet
    ? await generateRegularFullReductionWorkbookSet({
        templateBytes: input.templates.regularFullReductionTemplateBytes,
        tiers: input.package.couponSet.tiers.map((tier) => ({
          data: tier.input,
          computed: computeRegularFullReductionValues(tier.input),
        })),
        revision: input.package.revision,
      })
    : await generateRegularFullReductionWorkbook({
        templateBytes: input.templates.regularFullReductionTemplateBytes,
        data: input.package.coupon.input,
        computed: input.package.computed,
        revision: input.package.revision,
      });
  const whitelistWorkbook = await generateDynamicSkuListWorkbook({
    tiers: input.package.whitelistByTier,
    activityName: input.package.coupon.input.activityName,
    revision: input.package.revision,
    role: "whitelist",
  });
  const artifacts: OfflineArtifact[] = [
    {
      role: "couponTable",
      fileName: couponWorkbook.fileName,
      bytes: couponWorkbook.bytes,
      sha256: couponWorkbook.sha256,
      rowCount: couponWorkbook.rowCount,
      template: regularFullReductionManifest,
    },
    {
      role: "productWhitelist",
      fileName: whitelistWorkbook.fileName,
      bytes: whitelistWorkbook.bytes,
      sha256: whitelistWorkbook.sha256,
      rowCount: whitelistWorkbook.rowCount,
      template: { id: "coupon-dynamic-sku-whitelist-v1", version: "v1" },
    },
  ];
  if (input.package.blacklistByTier) {
    const blacklistWorkbook = await generateDynamicSkuListWorkbook({
      tiers: input.package.blacklistByTier,
      activityName: input.package.coupon.input.activityName,
      revision: input.package.revision,
      role: "blacklist",
    });
    artifacts.push({
      role: "productBlacklist",
      fileName: blacklistWorkbook.fileName,
      bytes: blacklistWorkbook.bytes,
      sha256: blacklistWorkbook.sha256,
      rowCount: blacklistWorkbook.rowCount,
      template: { id: "coupon-dynamic-sku-blacklist-v1", version: "v1" },
    });
  }
  return artifacts;
}

function singleListOverlap(
  whitelist: ParsedSingleCouponIdentifierList,
  blacklist: ParsedSingleCouponIdentifierList | undefined,
): { ids: string[]; sha256: string } {
  if (!blacklist) {
    return { ids: [], sha256: stableHash("single-list:no-blacklist") };
  }
  const blacklistIds = new Set(blacklist.entries.map((entry) => entry.id));
  const ids = whitelist.entries
    .map((entry) => entry.id)
    .filter((id) => blacklistIds.has(id))
    .sort((left, right) => left.localeCompare(right, "en"));
  return { ids: [...new Set(ids)], sha256: stableHash(ids) };
}

function assertSingleList(
  list: ParsedSingleCouponIdentifierList,
  label: string,
): void {
  if (list.dimension !== "SKU") throw new Error(`${label}必须是 SKU 维度`);
  if (!list.entries.length) throw new Error(`${label}不能是空名单`);
  if (list.issues.length) {
    throw new Error(`${label}存在未解决的数据问题：${list.issues.join("；")}`);
  }
}

export function createSingleCouponCanonicalPackage(input: {
  ownerId: string;
  revision: number;
  coupon: ConfirmedCouponSource;
  whitelist: ParsedSingleCouponIdentifierList;
  blacklistStatus: BlacklistStatus;
  blacklist?: ParsedSingleCouponIdentifierList;
  overlapDecision?: OverlapDecision;
}): CanonicalPackage {
  assertSingleList(input.whitelist, "白名单");
  if (input.blacklistStatus === "absent_pending_confirmation") {
    throw new Error("必须明确确认“本次无黑名单”后才能继续");
  }
  if (input.blacklistStatus === "uploaded") {
    if (!input.blacklist) throw new Error("已上传黑名单但缺少解析结果");
    assertSingleList(input.blacklist, "黑名单");
  } else if (input.blacklist) {
    throw new Error("非 uploaded 状态不能附带黑名单");
  }
  const overlap = singleListOverlap(input.whitelist, input.blacklist);
  if (overlap.ids.length && !input.overlapDecision) {
    throw new Error("白黑名单存在重叠 SKU，必须由业务员选择处理方式");
  }
  if (input.overlapDecision === "source_replacement_required") {
    throw new Error("业务员要求返回修改源文件，不能生成标准附件");
  }
  const conflicts = new Set(overlap.ids);
  const whitelist =
    input.overlapDecision === "blacklist_wins"
      ? {
          ...input.whitelist,
          entries: input.whitelist.entries.filter(
            (entry) => !conflicts.has(entry.id),
          ),
        }
      : input.whitelist;
  const blacklist =
    input.blacklist && input.overlapDecision === "whitelist_wins"
      ? {
          ...input.blacklist,
          entries: input.blacklist.entries.filter(
            (entry) => !conflicts.has(entry.id),
          ),
        }
      : input.blacklist;
  const computed = computeRegularFullReductionValues(input.coupon.input);
  const compatibilityTiers = multiTierSkuWhitelistManifest.sheets.reduce(
    (result, tier) => {
      result[tier] = [];
      return result;
    },
    {} as CanonicalPackage["whitelistByTier"],
  );
  compatibilityTiers[multiTierSkuWhitelistManifest.sheets[0]] =
    whitelist.entries.map((entry) => entry.id);
  const compatibilityBlacklist = blacklist
    ? multiTierSkuBlacklistManifest.sheets.reduce(
        (result, tier) => {
          result[tier] = [];
          return result;
        },
        {} as NonNullable<CanonicalPackage["blacklistByTier"]>,
      )
    : undefined;
  if (compatibilityBlacklist && blacklist) {
    compatibilityBlacklist[multiTierSkuBlacklistManifest.sheets[0]] =
      blacklist.entries.map((entry) => entry.id);
  }
  return {
    ownerId: input.ownerId,
    revision: input.revision,
    sourceConfirmationHash: stableHash({
      ownerId: input.ownerId,
      revision: input.revision,
      couponSourceHash: input.coupon.sourceHash,
      couponCandidateId: input.coupon.couponCandidateId,
      whitelistSourceHash: whitelist.sourceHash,
      whitelistIds: whitelist.entries.map((entry) => entry.id),
      blacklistSourceHash: blacklist?.sourceHash,
      blacklistIds: blacklist?.entries.map((entry) => entry.id),
      overlap,
    }),
    coupon: input.coupon,
    computed,
    couponName: computed.couponName,
    whitelist,
    blacklist,
    whitelistByTier: compatibilityTiers,
    blacklistByTier: compatibilityBlacklist,
    blacklistStatus: input.blacklistStatus,
    overlap: { ...overlap, decision: input.overlapDecision },
  };
}

export async function generateSingleCouponOfflineArtifacts(input: {
  package: CanonicalPackage;
  templates: OfflineArtifactTemplates;
}): Promise<OfflineArtifact[]> {
  if (!input.package.whitelist || !input.package.couponName) {
    throw new Error("单券标准附件缺少已确认名单或券名");
  }
  const couponWorkbook = await generateRegularFullReductionWorkbook({
    templateBytes: input.templates.regularFullReductionTemplateBytes,
    data: input.package.coupon.input,
    computed: input.package.computed,
    revision: input.package.revision,
  });
  const whitelistWorkbook = await generateSingleCouponSkuListWorkbook({
    templateBytes: input.templates.whitelistTemplateBytes,
    manifest: singleCouponSkuWhitelistManifest,
    couponName: input.package.couponName,
    ids: input.package.whitelist.entries.map((entry) => entry.id),
    activityName: input.package.coupon.input.activityName,
    revision: input.package.revision,
    role: "whitelist",
  });
  const artifacts: OfflineArtifact[] = [
    {
      role: "couponTable",
      fileName: couponWorkbook.fileName,
      bytes: couponWorkbook.bytes,
      sha256: couponWorkbook.sha256,
      rowCount: couponWorkbook.rowCount,
      template: regularFullReductionManifest,
    },
    {
      role: "productWhitelist",
      fileName: whitelistWorkbook.fileName,
      bytes: whitelistWorkbook.bytes,
      sha256: whitelistWorkbook.sha256,
      rowCount: whitelistWorkbook.rowCount,
      template: singleCouponSkuWhitelistManifest,
    },
  ];
  if (input.package.blacklist) {
    const blacklistWorkbook = await generateSingleCouponSkuListWorkbook({
      templateBytes: input.templates.blacklistTemplateBytes,
      manifest: singleCouponSkuBlacklistManifest,
      couponName: input.package.couponName,
      ids: input.package.blacklist.entries.map((entry) => entry.id),
      activityName: input.package.coupon.input.activityName,
      revision: input.package.revision,
      role: "blacklist",
    });
    artifacts.push({
      role: "productBlacklist",
      fileName: blacklistWorkbook.fileName,
      bytes: blacklistWorkbook.bytes,
      sha256: blacklistWorkbook.sha256,
      rowCount: blacklistWorkbook.rowCount,
      template: singleCouponSkuBlacklistManifest,
    });
  }
  return artifacts;
}

function durationDays(startAt: string, endAt: string): number {
  const start = Date.parse(`${startAt}T00:00:00.000Z`);
  const end = Date.parse(`${endAt}T00:00:00.000Z`);
  const duration = (end - start) / 86_400_000 + 1;
  if (!Number.isSafeInteger(duration) || duration <= 0) {
    throw new Error("活动日期无法生成有效活动天数");
  }
  return duration;
}

export interface BuildOaPrefillSnapshotInput {
  package: CanonicalPackage;
  artifacts: OfflineArtifact[];
  screenshots: RenderedCouponScreenshot[];
  /**
   * The OA “活动点位” mapping remains a business-owned decision. Requiring it
   * here prevents the offline workflow from silently assuming it equals coupon
   * discount ratio.
   */
  activityPointPercent: number;
}

export function buildOaPrefillSnapshot(
  input: BuildOaPrefillSnapshotInput,
): OaPrefillSnapshot {
  if (
    !Number.isFinite(input.activityPointPercent) ||
    input.activityPointPercent < 0
  ) {
    throw new Error("OA 活动点位必须是非负有限数值");
  }
  const expectedRoles = new Set<OfflineArtifact["role"]>([
    "couponTable",
    "productWhitelist",
    ...(input.package.blacklistByTier ? (["productBlacklist"] as const) : []),
  ]);
  const actualRoles = new Set(input.artifacts.map((artifact) => artifact.role));
  for (const role of expectedRoles) {
    if (!actualRoles.has(role))
      throw new Error(`缺少 OA 所需的离线附件：${role}`);
  }
  if (
    input.artifacts.length !== expectedRoles.size ||
    actualRoles.size !== expectedRoles.size
  ) {
    throw new Error("OA 预填快照包含与当前数据包不一致的附件角色");
  }

  const { coupon, computed } = input.package;
  const screenshotRequired = coupon.input.businessMode !== "严选";
  const couponArtifact = input.artifacts.find(
    (artifact) => artifact.role === "couponTable",
  );
  if (!couponArtifact) {
    throw new Error("缺少用于生成标准配券表截图的产物");
  }
  if (screenshotRequired && !input.screenshots.length) {
    throw new Error("当前业务模式缺少标准配券表截图");
  }
  if (!screenshotRequired && input.screenshots.length) {
    throw new Error("严选业务模式不能包含测算图片");
  }
  const screenshotIds = new Set(
    input.screenshots.map((screenshot) => screenshot.artifactId),
  );
  if (screenshotIds.size !== input.screenshots.length) {
    throw new Error("测算图片产物 ID 不能重复");
  }
  for (const [index, screenshot] of input.screenshots.entries()) {
    if (screenshot.order !== index) throw new Error("测算图片顺序无效");
    if (screenshot.sha256 !== sha256(screenshot.bytes)) {
      throw new Error("测算图片 bytes 与 hash 不一致");
    }
    if (
      screenshot.provenance === "generated" &&
      (screenshot.sourceArtifactSha256 !== couponArtifact.sha256 ||
        !screenshot.renderRange?.trim() ||
        !screenshot.templateId?.trim() ||
        !screenshot.templateVersion?.trim())
    ) {
      throw new Error("标准配券表截图未绑定到已验证的同 revision 配券表");
    }
    if (!screenshot.fileName.trim()) throw new Error("测算图片文件名不能为空");
  }
  const attachmentMetadata = input.artifacts.map((artifact, order) => ({
    artifactId: `${artifact.role}-${artifact.sha256}`,
    order,
    role: artifact.role,
    fileName: artifact.fileName,
    sha256: artifact.sha256,
    bytes: artifact.bytes.byteLength,
    offlineReference: `offline://${input.package.sourceConfirmationHash}/${artifact.role}`,
  }));
  const attachments: OaPrefillSnapshot["attachments"] = [
    ...attachmentMetadata,
    ...input.screenshots.map((screenshot) => ({
      artifactId: screenshot.artifactId,
      order: screenshot.order,
      role: "calcImage" as const,
      fileName: screenshot.fileName,
      sha256: screenshot.sha256,
      bytes: screenshot.bytes.byteLength,
      offlineReference: `offline://${input.package.sourceConfirmationHash}/${screenshot.artifactId}`,
      sourceArtifactSha256: screenshot.sourceArtifactSha256,
      renderRange: screenshot.renderRange,
      contentType: screenshot.contentType,
    })),
  ];
  const snapshotHash = stableHash({
    packageHash: input.package.sourceConfirmationHash,
    artifactHashes: attachmentMetadata.map(
      ({ role, sha256: attachmentHash }) => ({
        role,
        sha256: attachmentHash,
      }),
    ),
    screenshots: input.screenshots.map((screenshot) => ({
      artifactId: screenshot.artifactId,
      order: screenshot.order,
      provenance: screenshot.provenance,
      sha256: screenshot.sha256,
      sourceArtifactSha256: screenshot.sourceArtifactSha256,
      templateId: screenshot.templateId,
      templateVersion: screenshot.templateVersion,
      renderRange: screenshot.renderRange,
    })),
    activityPointPercent: input.activityPointPercent,
  });
  return {
    ownerId: input.package.ownerId,
    revision: input.package.revision,
    snapshotHash,
    values: {
      applicant: {
        source: "feishuIdentity",
        status: "resolved_on_final_confirmation",
      },
      department: {
        source: "feishuIdentity",
        status: "resolved_on_final_confirmation",
      },
      applicationType: "优惠券申请",
      businessMode: coupon.input.businessMode,
      activityName: coupon.input.activityName,
      activityBackground: coupon.input.activityBackground,
      activityPointPercent: input.activityPointPercent,
      platformBearingPercent: coupon.input.platformBearingRatio * 100,
      overDeduction: coupon.input.overDeduction,
      overDeductionReason: coupon.input.overDeductionReason || undefined,
      estimatedGmvYuan: coupon.input.estimatedGmvYuan,
      estimatedCostYuan: computed.estimatedCostYuan,
      estimatedRoi: computed.estimatedRoi,
      channels: coupon.input.channels,
      activityStartAt: coupon.input.activityStartAt,
      activityEndAt: coupon.input.activityEndAt,
      durationDays: durationDays(
        coupon.input.activityStartAt,
        coupon.input.activityEndAt,
      ),
    },
    attachments,
    blacklistStatus: input.package.blacklistStatus,
    overlap: input.package.overlap,
  };
}

/**
 * The final offline acknowledgement intentionally returns only a local proof.
 * It cannot create, submit, or read an Approval instance.
 */
export function simulateSecondConfirmation(input: {
  snapshot: OaPrefillSnapshot;
  ownerId: string;
  expectedRevision: number;
}): { localConfirmationHash: string; oaCreated: false } {
  if (input.snapshot.ownerId !== input.ownerId) {
    throw new Error("不能确认其他业务员的 OA 预填快照");
  }
  if (input.snapshot.revision !== input.expectedRevision) {
    throw new Error("OA 预填快照已过期");
  }
  return {
    localConfirmationHash: stableHash({
      snapshotHash: input.snapshot.snapshotHash,
      ownerId: input.ownerId,
      expectedRevision: input.expectedRevision,
    }),
    oaCreated: false,
  };
}
