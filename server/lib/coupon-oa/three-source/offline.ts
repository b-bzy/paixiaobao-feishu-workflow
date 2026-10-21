import type { MultiTierSkuSheetName } from "../../excel-template-engine/template-manifests";
import {
  type IdentifierDimensionConfirmation,
  parseMultiSheetTieredIdentifierList,
  parseTieredIdentifierList,
} from "./lists";
import {
  extractRegularFullReductionInput,
  inspectThreeSourceWorkbook,
  selectUniqueRole,
} from "./recognition";
import type {
  CanonicalPackage,
  OaPrefillSnapshot,
  OfflineArtifact,
  OfflineSourceFile,
  OverlapDecision,
  RenderedCouponScreenshot,
  SourceConfirmation,
  WorkbookRecognition,
  WorkbookScreenshotRenderer,
} from "./types";
import {
  buildOaPrefillSnapshot,
  buildSourceConfirmation,
  createCanonicalPackage,
  generateOfflineArtifacts,
  type OfflineArtifactTemplates,
  simulateSecondConfirmation,
} from "./workflow";

function assertDetectedRole(
  recognition: WorkbookRecognition,
  expected: "couponTable" | "whitelist" | "blacklist",
): void {
  const detected = selectUniqueRole(recognition);
  if (detected !== expected) {
    throw new Error(`材料角色不匹配：期望 ${expected}，实际识别为 ${detected}`);
  }
}

export interface ListColumnSelection {
  identifierCandidateId?: string;
  tierCandidateId?: string;
  defaultTier?: MultiTierSkuSheetName;
}

export interface OfflineThreeSourceRunInput {
  ownerId: string;
  revision: number;
  couponTable: OfflineSourceFile;
  whitelist: OfflineSourceFile;
  blacklist?: OfflineSourceFile;
  /** Explicit acknowledgement required only when blacklist is not uploaded. */
  noBlacklistConfirmed?: boolean;
  whitelistSelection?: ListColumnSelection;
  blacklistSelection?: ListColumnSelection;
  /** Owner-confirmed identifier dimensions (ADR-0015); headerless or
   * non-SKU lists fail closed without them. */
  whitelistDimensionConfirmation?: IdentifierDimensionConfirmation;
  blacklistDimensionConfirmation?: IdentifierDimensionConfirmation;
  overlapDecision?: OverlapDecision;
  screenshotRenderer?: WorkbookScreenshotRenderer;
  templates: OfflineArtifactTemplates;
  activityPointPercent: number;
  /** Dynamic mode keeps every business Sheet as an independent coupon tier. */
  listMode?: "legacy-column" | "dynamic-multi-sheet";
}

export interface OfflineThreeSourceRunResult {
  recognitions: {
    couponTable: WorkbookRecognition;
    whitelist: WorkbookRecognition;
    blacklist?: WorkbookRecognition;
  };
  confirmation: SourceConfirmation;
  package: CanonicalPackage;
  artifacts: OfflineArtifact[];
  screenshots: RenderedCouponScreenshot[];
  oaPrefill: OaPrefillSnapshot;
  secondConfirmation: { localConfirmationHash: string; oaCreated: false };
}

/**
 * A deliberately side-effect-free orchestration facade. It never imports a
 * Feishu adapter or reads credentials: every input and generated artifact is
 * in memory.
 */
export async function runOfflineThreeSourceWorkflow(
  input: OfflineThreeSourceRunInput,
): Promise<OfflineThreeSourceRunResult> {
  const couponRecognition = await inspectThreeSourceWorkbook(input.couponTable);
  const whitelistRecognition = await inspectThreeSourceWorkbook(
    input.whitelist,
  );
  const blacklistRecognition = input.blacklist
    ? await inspectThreeSourceWorkbook(input.blacklist)
    : undefined;
  assertDetectedRole(couponRecognition, "couponTable");
  assertDetectedRole(whitelistRecognition, "whitelist");
  if (blacklistRecognition)
    assertDetectedRole(blacklistRecognition, "blacklist");

  const coupon = await extractRegularFullReductionInput({
    recognition: couponRecognition,
    productLimitType:
      input.whitelistDimensionConfirmation?.confirmedAs === "MERCHANT_ID"
        ? "限商家ID"
        : "限SKU",
  });
  const whitelist =
    input.listMode === "dynamic-multi-sheet"
      ? await parseMultiSheetTieredIdentifierList({
          recognition: whitelistRecognition,
          role: "whitelist",
          identifierDimensionConfirmation: input.whitelistDimensionConfirmation,
        })
      : await parseTieredIdentifierList({
          recognition: whitelistRecognition,
          role: "whitelist",
          ...input.whitelistSelection,
        });
  const blacklist = blacklistRecognition
    ? input.listMode === "dynamic-multi-sheet"
      ? await parseMultiSheetTieredIdentifierList({
          recognition: blacklistRecognition,
          role: "blacklist",
          identifierDimensionConfirmation: input.blacklistDimensionConfirmation,
        })
      : await parseTieredIdentifierList({
          recognition: blacklistRecognition,
          role: "blacklist",
          ...input.blacklistSelection,
        })
    : undefined;
  const blacklistStatus = blacklist
    ? blacklist.issues.length
      ? "invalid"
      : "uploaded"
    : input.noBlacklistConfirmed
      ? "absent_confirmed"
      : "absent_pending_confirmation";

  const confirmation = buildSourceConfirmation({
    ownerId: input.ownerId,
    revision: input.revision,
    coupon,
    whitelist,
    blacklistStatus,
    blacklist,
  });
  const packageValue = createCanonicalPackage({
    confirmation,
    ownerId: input.ownerId,
    expectedRevision: input.revision,
    overlapDecision: input.overlapDecision,
  });
  const artifacts = await generateOfflineArtifacts({
    package: packageValue,
    templates: input.templates,
  });
  const requiresScreenshot = packageValue.coupon.input.businessMode !== "严选";
  const couponArtifact = artifacts.find(
    (artifact) => artifact.role === "couponTable",
  );
  if (!couponArtifact) {
    throw new Error("标准配券表生成后缺失，不能生成 OA 图片附件");
  }
  if (requiresScreenshot && !input.screenshotRenderer) {
    throw new Error("当前业务模式必须提供标准配券表截图渲染器");
  }
  const screenshots = input.screenshotRenderer
    ? await input.screenshotRenderer.render({
        couponArtifact,
        revision: packageValue.revision,
      })
    : [];
  const oaPrefill = buildOaPrefillSnapshot({
    package: packageValue,
    artifacts,
    screenshots,
    activityPointPercent: input.activityPointPercent,
  });
  const secondConfirmation = simulateSecondConfirmation({
    snapshot: oaPrefill,
    ownerId: input.ownerId,
    expectedRevision: input.revision,
  });
  return {
    recognitions: {
      couponTable: couponRecognition,
      whitelist: whitelistRecognition,
      blacklist: blacklistRecognition,
    },
    confirmation,
    package: packageValue,
    artifacts,
    screenshots,
    oaPrefill,
    secondConfirmation,
  };
}
