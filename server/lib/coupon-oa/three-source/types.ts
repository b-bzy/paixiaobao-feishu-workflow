import type {
  MultiTierSkuListWorkbookManifest,
  MultiTierSkuSheetName,
} from "~/lib/excel-template-engine/template-manifests";
import type {
  RegularFullReductionComputedValues,
  RegularFullReductionInput,
} from "../calculation";

export const threeSourceRuleVersion = "three-source-offline-v1";

export type SourceRole = "couponTable" | "whitelist" | "blacklist";
export type IdentifierDimension = "SKU" | "SPU" | "MERCHANT_ID";
export type BlacklistStatus =
  | "uploaded"
  | "absent_pending_confirmation"
  | "absent_confirmed"
  | "invalid";
export type OverlapDecision =
  | "whitelist_wins"
  | "blacklist_wins"
  | "source_replacement_required";

export interface OfflineSourceFile {
  fileName: string;
  bytes: Uint8Array;
}

export interface SourceProvenance {
  sourceHash: string;
  fileName: string;
  sheetName: string;
  row: number;
  column: string;
  cell: string;
  rawValue: string;
  normalizedValue: string;
  ruleVersion: typeof threeSourceRuleVersion;
}

export interface SourceRoleCandidate {
  id: string;
  role: SourceRole;
  score: number;
  reasons: string[];
}

export type CouponFieldKey =
  | "activityName"
  | "activityBackground"
  | "businessMode"
  | "applicantName"
  | "activityStartAt"
  | "activityEndAt"
  | "channels"
  | "thresholdYuan"
  | "discountAmountYuan"
  | "totalQuantity"
  | "grantQuantityPerClaim"
  | "dailyClaimLimit"
  | "claimWindow"
  | "useWindow"
  | "expectedClaimRate"
  | "expectedUseRate"
  | "platformBearingRatio"
  | "estimatedGmvYuan"
  | "claimRule"
  | "allowGift"
  | "promotionMode"
  | "publicPromotionChannels"
  | "overDeduction"
  | "overDeductionReason";

export interface CouponFieldCandidate {
  id: string;
  key: CouponFieldKey;
  score: number;
  header: string;
  headerRow: number;
  column: string;
  sheetName: string;
  sampleValues: string[];
  reasons: string[];
}

export interface ListColumnCandidate {
  id: string;
  kind: "identifier" | "tier";
  dimension?: IdentifierDimension;
  score: number;
  header: string;
  headerRow: number;
  column: string;
  sheetName: string;
  sampleValues: string[];
  reasons: string[];
}

export interface WorkbookRecognition {
  source: OfflineSourceFile;
  sourceHash: string;
  roleCandidates: SourceRoleCandidate[];
  couponFieldCandidates: Partial<
    Record<CouponFieldKey, CouponFieldCandidate[]>
  >;
  listCandidates: ListColumnCandidate[];
  issues: string[];
}

export interface ConfirmedCouponSource {
  input: RegularFullReductionInput;
  provenance: Record<CouponFieldKey, SourceProvenance>;
  sourceHash: string;
}

export interface TieredIdentifierEntry {
  id: string;
  tier: MultiTierSkuSheetName;
  provenance: SourceProvenance;
}

export interface ParsedTieredIdentifierList {
  role: "whitelist" | "blacklist";
  sourceHash: string;
  dimension: IdentifierDimension;
  entries: TieredIdentifierEntry[];
  issues: string[];
}

export interface OverlapSnapshot {
  ids: string[];
  sha256: string;
  decision?: OverlapDecision;
}

export interface SourceConfirmation {
  ownerId: string;
  revision: number;
  snapshotHash: string;
  coupon: ConfirmedCouponSource;
  whitelist: ParsedTieredIdentifierList;
  blacklistStatus: BlacklistStatus;
  blacklist?: ParsedTieredIdentifierList;
  overlap: OverlapSnapshot;
}

export interface CanonicalPackage {
  ownerId: string;
  revision: number;
  sourceConfirmationHash: string;
  coupon: ConfirmedCouponSource;
  computed: RegularFullReductionComputedValues;
  whitelistByTier: Record<MultiTierSkuSheetName, string[]>;
  blacklistByTier?: Record<MultiTierSkuSheetName, string[]>;
  blacklistStatus: BlacklistStatus;
  overlap: OverlapSnapshot;
}

export interface OfflineArtifact {
  role: "couponTable" | "productWhitelist" | "productBlacklist";
  fileName: string;
  bytes: Uint8Array;
  sha256: string;
  rowCount: number;
  template: MultiTierSkuListWorkbookManifest | { id: string; version: string };
}

export interface RenderedCouponScreenshot {
  role: "calcImage";
  fileName: string;
  bytes: Uint8Array;
  sha256: string;
  sourceArtifactSha256: string;
  templateId: string;
  templateVersion: string;
  renderRange: string;
}

/**
 * The production adapter renders a fully verified standard coupon workbook.
 * It must never substitute a user-uploaded image or an original source table.
 */
export interface WorkbookScreenshotRenderer {
  render(input: {
    couponArtifact: OfflineArtifact;
    revision: number;
  }): Promise<RenderedCouponScreenshot>;
}

export interface OaPrefillSnapshot {
  ownerId: string;
  revision: number;
  snapshotHash: string;
  values: {
    /** Final OA applicant must be the user who performs final confirmation. */
    applicant: {
      source: "feishuIdentity";
      status: "resolved_on_final_confirmation";
    };
    /** The confirmer's primary department is resolved server-side. */
    department: {
      source: "feishuIdentity";
      status: "resolved_on_final_confirmation";
    };
    applicationType: "优惠券申请";
    businessMode: RegularFullReductionInput["businessMode"];
    activityName: string;
    activityBackground: string;
    activityPointPercent: number;
    platformBearingPercent: number;
    overDeduction: "是" | "否";
    overDeductionReason?: string;
    estimatedGmvYuan: number;
    estimatedCostYuan: number;
    estimatedRoi: number;
    channels: string[];
    activityStartAt: string;
    activityEndAt: string;
    durationDays: number;
  };
  attachments: Array<{
    role: OfflineArtifact["role"] | "calcImage";
    fileName: string;
    sha256: string;
    bytes: number;
    offlineReference: string;
    sourceArtifactSha256?: string;
    renderRange?: string;
  }>;
  blacklistStatus: BlacklistStatus;
  overlap: OverlapSnapshot;
}
