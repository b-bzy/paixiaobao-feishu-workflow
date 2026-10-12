import type {
  MultiTierSkuListWorkbookManifest,
  MultiTierSkuSheetName,
  SingleCouponSkuListWorkbookManifest,
} from "~/lib/excel-template-engine/template-manifests";
import type {
  RegularFullReductionComputedValues,
  RegularFullReductionInput,
} from "../calculation";

export const threeSourceRuleVersion = "three-source-offline-v1";

export type SourceRole = "couponTable" | "whitelist" | "blacklist";
export type CandidateOrigin =
  | "source_explicit"
  | "ai_derived"
  | "ai_inferred"
  | "rule_fallback"
  | "owner_supplied";

export interface CandidateEvidence {
  sourceHash: string;
  sheetName: string;
  cells: string[];
  region?: { startCell: string; endCell: string };
}
export type CouponType = "regular_full_reduction";
export type CouponTemplateKind =
  | "regular_full_reduction"
  | "regular_discount"
  | "plus_full_reduction"
  | "plus_discount"
  | "campaign_regular_full_reduction"
  | "campaign_regular_discount"
  | "campaign_plus_full_reduction"
  | "campaign_plus_discount"
  | "redemption_full_reduction"
  | "redemption_discount";
export type CouponTemplateResolutionStatus =
  | "unique_template"
  | "ambiguous_template"
  | "unknown_template"
  | "unsupported_template";
export type CouponTypeResolutionStatus =
  | "unique"
  | "ambiguous"
  | "unknown"
  | "multiple_coupons"
  | "unsupported";
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

export interface CouponTemplateCandidate {
  templateKind: CouponTemplateKind;
  score: number;
  supported: boolean;
  headerRow: number;
  sheetName: string;
  evidenceCells: string[];
  reasons: string[];
  fileNameHint?: string;
}

export interface CouponTierRowReference {
  sheetName: string;
  row: number;
  evidenceCells: string[];
}

export interface CouponTemplateResolution {
  status: CouponTemplateResolutionStatus;
  templateKind?: CouponTemplateKind;
  candidates: CouponTemplateCandidate[];
  tierRows: CouponTierRowReference[];
  issues: string[];
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
  sourceKind?: "workbook" | "ownerSupplement";
  ownerId?: string;
  revision?: number;
  overrideReason?: string;
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
  | "activityPointPercent"
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
  provenance: Partial<Record<CouponFieldKey, SourceProvenance>>;
  sourceHash: string;
  couponCandidateId?: string;
  couponType?: CouponType;
  activityPointPercent?: number;
}

export interface ConfirmedCouponSetSource {
  templateKind: "regular_full_reduction";
  sourceHash: string;
  activityPointPercent: number;
  tiers: ConfirmedCouponSource[];
}

export interface CouponCandidate {
  id: string;
  couponType: CouponType | "unknown" | "unsupported";
  displayName: string;
  sourceHash: string;
  sheetName: string;
  row: number;
  evidenceCells: string[];
  fieldCandidateIds: Partial<Record<CouponFieldKey, string>>;
  source: "deterministic" | "ai";
}

export interface CouponTypeResolution {
  status: CouponTypeResolutionStatus;
  couponType?: CouponType;
  candidates: CouponCandidate[];
  issues: string[];
}

export interface AiAuditSummary {
  provider: "deepseek";
  model: string;
  promptVersion: string;
  status: "succeeded" | "failed" | "outcome_unknown" | "disabled";
  requestSha256?: string;
  responseSha256?: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  fallbackReason?: string;
  activityCopy?: {
    status: "succeeded" | "failed" | "skipped";
    promptVersion: string;
    requestSha256?: string;
    responseSha256?: string;
    durationMs?: number;
    failureCode?: string;
  };
}

export interface AiSourceRoleCandidate {
  role: SourceRole;
  confidence: number;
  reasons: string[];
  evidenceCells: string[];
}

export interface AiCouponFieldCandidate {
  key: CouponFieldKey;
  sheetName: string;
  headerCell: string;
  valueCell: string;
  confidence: number;
  reason: string;
  value?: string | number | boolean | string[];
  origin?: CandidateOrigin;
  evidence?: CandidateEvidence;
}

export interface AiCampaignThemeCandidate {
  value: string;
  confidence: number;
  reason: string;
  origin: CandidateOrigin;
  evidence: CandidateEvidence;
}

export interface AiListCandidate {
  role: "whitelist" | "blacklist" | "unknown";
  dimension: IdentifierDimension;
  sheetName: string;
  headerCell: string;
  confidence: number;
  reason: string;
}

export interface AiActivityCopyCandidate {
  key: "activityName" | "activityBackground";
  value: string;
  evidenceCells: string[];
}

export interface AiTemplateCandidate {
  id: string;
  templateKind: CouponTemplateKind;
  confidence: number;
  supported: boolean;
  evidence: CandidateEvidence;
  reason: string;
}

export interface AiTierCandidate {
  id: string;
  templateKind: CouponTemplateKind;
  displayName: string;
  row: number;
  evidence: CandidateEvidence;
}

export interface AiSkuRegionCandidate {
  id: string;
  role: "whitelist" | "blacklist" | "unknown";
  dimension: IdentifierDimension;
  tierDisplayName?: string;
  headerCell: string;
  confidence: number;
  reason: string;
  evidence: CandidateEvidence;
}

export interface ValidatedAiRecognition {
  sourceHash: string;
  roleCandidates: AiSourceRoleCandidate[];
  couponCandidates: CouponCandidate[];
  fieldCandidates: AiCouponFieldCandidate[];
  campaignThemeCandidates?: AiCampaignThemeCandidate[];
  listCandidates: AiListCandidate[];
  activityCopyCandidates?: AiActivityCopyCandidate[];
  activityCopyAudit?: NonNullable<AiAuditSummary["activityCopy"]>;
  templateCandidates?: AiTemplateCandidate[];
  tierCandidates?: AiTierCandidate[];
  skuRegionCandidates?: AiSkuRegionCandidate[];
  issues: string[];
}

export interface AiPrimaryRecognitionProjection {
  sourceHash: string;
  mode: "ai_primary" | "rule_fallback";
  couponCandidates: CouponCandidate[];
  fieldCandidates: AiCouponFieldCandidate[];
  templateCandidates: AiTemplateCandidate[];
  tierCandidates: AiTierCandidate[];
  skuRegionCandidates: AiSkuRegionCandidate[];
  issues: string[];
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

export interface MultiSheetListSelection {
  sheets: Record<
    string,
    {
      templateTier: MultiTierSkuSheetName;
      identifierCandidateId?: string;
    }
  >;
}

export interface SingleCouponIdentifierEntry {
  id: string;
  provenance: SourceProvenance;
}

export interface ParsedSingleCouponIdentifierList {
  role: "whitelist" | "blacklist";
  sourceHash: string;
  dimension: IdentifierDimension;
  selectedSheetName: string;
  selectedColumn: string;
  confirmedCouponName: string;
  entries: SingleCouponIdentifierEntry[];
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
  couponSet?: ConfirmedCouponSetSource;
  computed: RegularFullReductionComputedValues;
  couponName?: string;
  whitelist?: ParsedSingleCouponIdentifierList;
  blacklist?: ParsedSingleCouponIdentifierList;
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
  template:
    | MultiTierSkuListWorkbookManifest
    | SingleCouponSkuListWorkbookManifest
    | { id: string; version: string };
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
