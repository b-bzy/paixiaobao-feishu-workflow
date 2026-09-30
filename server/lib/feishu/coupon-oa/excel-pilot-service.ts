import {
  generateRegularFullReductionWorkbook,
  generateSkuWhitelistWorkbook,
  inspectSkuWhitelistSource,
  parseSkuWhitelistSource,
} from "../../excel-template-engine";
import {
  regularFullReductionManifest,
  skuWhitelistPilotManifest,
} from "../../excel-template-engine/template-manifests";
import { extractCouponPilotFields } from "../deepseek-client";
import {
  uploadFeishuBitableAttachment,
  uploadFeishuDriveFile,
} from "../drive-client";
import { downloadFeishuMessageResource } from "../message-client";
import { loadCouponPilotTemplate } from "./excel-pilot-assets";
import {
  getCouponExcelPilotFolderToken,
  getCouponExcelPilotTableId,
} from "./excel-pilot-config";
import { beginCouponPilotOaHandoff } from "./excel-pilot-oa-handoff";
import {
  type CouponPilotChannel,
  computeCouponPilotValues,
  couponPilotInputSchema,
  normalizeRatio,
} from "./excel-pilot-schema";
import {
  type CouponExcelPilotArtifact,
  type CouponExcelPilotDraft,
  type CouponExcelPilotMapping,
  sourceFileMetadata,
  updateCouponExcelPilotDraft,
} from "./excel-pilot-store";

const requiredFieldKeys = [
  "activityName",
  "activityBackground",
  "businessMode",
  "applicantName",
  "activityStartAt",
  "activityEndAt",
  "channels",
  "thresholdYuan",
  "discountAmountYuan",
  "totalQuantity",
  "grantQuantityPerClaim",
  "dailyClaimLimit",
  "claimWindow",
  "useWindow",
  "expectedClaimRate",
  "expectedUseRate",
  "platformBearingRatio",
  "estimatedGmvYuan",
  "claimRule",
  "allowGift",
  "promotionMode",
  "overDeduction",
] as const;

function text(value: unknown): string | undefined {
  const result = String(value ?? "").trim();
  return result || undefined;
}

function number(value: unknown): number | undefined {
  const result = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(result) ? result : undefined;
}

function channels(value: unknown): CouponPilotChannel[] | undefined {
  const items = Array.isArray(value)
    ? value
    : String(value ?? "").split(/[、，,；;\s]+/);
  const normalized = items.flatMap((item) => {
    const candidate = String(item).trim();
    if (["JD", "京东", "京东渠道", "京东商城"].includes(candidate))
      return ["JD"] as const;
    if (
      ["PAIPAI", "拍拍", "拍拍二手", "严选APP及小程序", "严选"].includes(
        candidate,
      )
    ) {
      return ["PAIPAI"] as const;
    }
    return [];
  });
  return normalized.length ? [...new Set(normalized)] : undefined;
}

function publicChannels(value: unknown): string[] {
  if (Array.isArray(value))
    return value
      .map(String)
      .map((item) => item.trim())
      .filter(Boolean);
  return String(value ?? "")
    .split(/[、，,；;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function candidateInput(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const candidate: Record<string, unknown> = {
    activityName: text(fields.activityName),
    activityBackground: text(fields.activityBackground),
    businessMode: text(fields.businessMode),
    applicantName: text(fields.applicantName),
    activityStartAt: text(fields.activityStartAt),
    activityEndAt: text(fields.activityEndAt),
    channels: channels(fields.channels),
    thresholdYuan: number(fields.thresholdYuan),
    discountAmountYuan: number(fields.discountAmountYuan),
    totalQuantity: number(fields.totalQuantity),
    grantQuantityPerClaim: number(fields.grantQuantityPerClaim),
    dailyClaimLimit: number(fields.dailyClaimLimit),
    claimWindow: text(fields.claimWindow),
    useWindow: text(fields.useWindow),
    expectedClaimRate: normalizeRatio(fields.expectedClaimRate),
    expectedUseRate: normalizeRatio(fields.expectedUseRate),
    platformBearingRatio: normalizeRatio(fields.platformBearingRatio),
    estimatedGmvYuan: number(fields.estimatedGmvYuan),
    claimRule: text(fields.claimRule),
    allowGift: text(fields.allowGift),
    promotionMode: text(fields.promotionMode),
    publicPromotionChannels: publicChannels(fields.publicPromotionChannels),
    overDeduction: text(fields.overDeduction),
    overDeductionReason: text(fields.overDeductionReason) ?? "",
    couponType: "东券",
    productLimitType: "限SKU",
    claimRiskControl: "0级以下用户可领",
  };
  return Object.fromEntries(
    Object.entries(candidate).filter(([, value]) => value !== undefined),
  );
}

function missingFields(candidate: Record<string, unknown>): string[] {
  return requiredFieldKeys.filter((key) => {
    const value = candidate[key];
    return (
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && !value.length)
    );
  });
}

export async function extractAndSaveCouponPilotInput(
  draft: CouponExcelPilotDraft,
  message: string,
): Promise<CouponExcelPilotDraft> {
  const extraction = await extractCouponPilotFields(message);
  const candidate = {
    ...(draft.candidateInput ?? {}),
    ...candidateInput(extraction.fields),
  };
  const missing = missingFields(candidate);
  const parsed = couponPilotInputSchema.safeParse(candidate);
  if (!parsed.success || missing.length || extraction.ambiguousFields.length) {
    const issues = [
      ...missing.map((key) => `缺少字段：${key}`),
      ...extraction.ambiguousFields.map((key) => `字段有歧义：${key}`),
      ...(parsed.success
        ? []
        : parsed.error.issues.map((issue) => issue.message)),
    ];
    return updateCouponExcelPilotDraft(draft, {
      status: "NeedsInput",
      candidateInput: candidate,
      validationIssues: [...new Set(issues)],
      failureReason: undefined,
    });
  }
  return updateCouponExcelPilotDraft(draft, {
    status: "AwaitingInputConfirmation",
    candidateInput: candidate,
    input: parsed.data,
    validationIssues: [],
    failureReason: undefined,
  });
}

export async function confirmCouponPilotInput(
  draft: CouponExcelPilotDraft,
): Promise<CouponExcelPilotDraft> {
  if (draft.status !== "AwaitingInputConfirmation" || !draft.input) {
    throw new Error("当前优惠券字段不能确认");
  }
  return updateCouponExcelPilotDraft(draft, {
    status: "AwaitingWhitelistUpload",
    validationIssues: [],
    failureReason: undefined,
  });
}

function canReplaceWhitelistSource(draft: CouponExcelPilotDraft): boolean {
  return (
    draft.status === "AwaitingWhitelistUpload" ||
    (draft.status === "NeedsInput" && Boolean(draft.input))
  );
}

export async function saveCouponPilotWhitelistSource(input: {
  draft: CouponExcelPilotDraft;
  messageId: string;
  fileKey: string;
  fileName: string;
  bytes: Uint8Array;
}): Promise<CouponExcelPilotDraft> {
  if (!canReplaceWhitelistSource(input.draft)) {
    throw new Error("请先确认优惠券字段，或先修正当前白名单问题");
  }
  const sourceWhitelist = sourceFileMetadata({
    messageId: input.messageId,
    fileKey: input.fileKey,
    fileName: input.fileName,
    bytes: input.bytes,
  });
  const processedMessageIds = [
    ...new Set([...input.draft.processedMessageIds, input.messageId]),
  ];
  const inspection = await inspectSkuWhitelistSource(input.bytes);
  if (!inspection.candidates.length) {
    return updateCouponExcelPilotDraft(input.draft, {
      status: "NeedsInput",
      sourceWhitelist,
      whitelistMapping: undefined,
      artifacts: [],
      processedMessageIds,
      validationIssues: ["白名单文件中未发现可选择的非空列"],
      failureReason: "白名单源文件需要修正",
    });
  }
  return updateCouponExcelPilotDraft(input.draft, {
    status: "AwaitingWhitelistMapping",
    sourceWhitelist: { ...sourceWhitelist, candidates: inspection.candidates },
    whitelistMapping: undefined,
    artifacts: [],
    processedMessageIds,
    validationIssues: [],
    failureReason: undefined,
  });
}

export async function saveCouponPilotWhitelistMapping(input: {
  draft: CouponExcelPilotDraft;
  mapping: CouponExcelPilotMapping;
}): Promise<CouponExcelPilotDraft> {
  const source = input.draft.sourceWhitelist;
  const candidate = source?.candidates?.find(
    (item) =>
      item.sheetName === input.mapping.sheetName &&
      item.column === input.mapping.column &&
      item.header === input.mapping.header,
  );
  if (!candidate) throw new Error("白名单列映射已过期，请重新上传文件");
  if (!input.draft.input) throw new Error("请先确认优惠券字段");
  return updateCouponExcelPilotDraft(input.draft, {
    status: "Generating",
    whitelistMapping: input.mapping,
    validationIssues: [],
    failureReason: undefined,
  });
}

export async function generateCouponPilotArtifacts(
  draft: CouponExcelPilotDraft,
): Promise<CouponExcelPilotDraft> {
  if (!draft.input || !draft.sourceWhitelist || !draft.whitelistMapping) {
    throw new Error("优惠券字段、白名单源文件或映射尚未确认");
  }
  const sourceBytes = await downloadFeishuMessageResource({
    messageId: draft.sourceWhitelist.messageId,
    fileKey: draft.sourceWhitelist.fileKey,
    type: "file",
  });
  const parsedSkus = await parseSkuWhitelistSource({
    bytes: sourceBytes,
    sheetName: draft.whitelistMapping.sheetName,
    column: draft.whitelistMapping.column,
  });
  if (parsedSkus.issues.length) {
    return updateCouponExcelPilotDraft(draft, {
      status: "NeedsInput",
      validationIssues: parsedSkus.issues.slice(0, 20),
      failureReason: "白名单源文件需要修正",
    });
  }
  const computed = computeCouponPilotValues(draft.input);
  const [couponTemplate, whitelistTemplate] = await Promise.all([
    loadCouponPilotTemplate({ kind: "coupon" }),
    loadCouponPilotTemplate({ kind: "whitelist" }),
  ]);
  const revision = draft.revision;
  const [couponWorkbook, whitelistWorkbook] = await Promise.all([
    generateRegularFullReductionWorkbook({
      templateBytes: couponTemplate,
      data: draft.input,
      computed,
      revision,
    }),
    generateSkuWhitelistWorkbook({
      templateBytes: whitelistTemplate,
      skus: parsedSkus.skus,
      activityName: draft.input.activityName,
      revision,
    }),
  ]);
  const folderToken = getCouponExcelPilotFolderToken();
  const [couponFile, whitelistFile] = await Promise.all([
    uploadFeishuDriveFile({
      name: couponWorkbook.fileName,
      folderToken,
      contentType: couponWorkbook.mimeType,
      bytes: couponWorkbook.bytes,
    }),
    uploadFeishuDriveFile({
      name: whitelistWorkbook.fileName,
      folderToken,
      contentType: whitelistWorkbook.mimeType,
      bytes: whitelistWorkbook.bytes,
    }),
  ]);
  const artifacts: CouponExcelPilotArtifact[] = [
    {
      role: "couponTable",
      fileName: couponWorkbook.fileName,
      fileToken: couponFile.fileToken,
      bytes: couponWorkbook.bytes.byteLength,
      sha256: couponWorkbook.sha256,
      templateId: regularFullReductionManifest.id,
      templateVersion: regularFullReductionManifest.version,
    },
    {
      role: "productWhitelist",
      fileName: whitelistWorkbook.fileName,
      fileToken: whitelistFile.fileToken,
      bytes: whitelistWorkbook.bytes.byteLength,
      sha256: whitelistWorkbook.sha256,
      templateId: skuWhitelistPilotManifest.id,
      templateVersion: skuWhitelistPilotManifest.version,
    },
  ];
  const generating = await updateCouponExcelPilotDraft(draft, {
    status: "Generating",
    artifacts,
    validationIssues: [],
    failureReason: undefined,
  });
  const baseAppToken = process.env.FEISHU_BASE_APP_TOKEN;
  if (!baseAppToken) throw new Error("Feishu Base POC is not configured");
  const tableId = getCouponExcelPilotTableId();
  const [couponBaseFileToken, whitelistBaseFileToken] = await Promise.all([
    uploadFeishuBitableAttachment({
      baseAppToken,
      tableId,
      recordId: generating.recordId,
      fieldName: "Generated Coupon File",
      name: couponWorkbook.fileName,
      contentType: couponWorkbook.mimeType,
      bytes: couponWorkbook.bytes,
    }),
    uploadFeishuBitableAttachment({
      baseAppToken,
      tableId,
      recordId: generating.recordId,
      fieldName: "Generated Whitelist File",
      name: whitelistWorkbook.fileName,
      contentType: whitelistWorkbook.mimeType,
      bytes: whitelistWorkbook.bytes,
    }),
  ]);
  return updateCouponExcelPilotDraft(generating, {
    status: "AwaitingOutputConfirmation",
    artifacts: [
      { ...artifacts[0], baseFileToken: couponBaseFileToken },
      { ...artifacts[1], baseFileToken: whitelistBaseFileToken },
    ],
    validationIssues: [],
    failureReason: undefined,
  });
}

export async function confirmCouponPilotOutput(
  draft: CouponExcelPilotDraft,
): Promise<CouponExcelPilotDraft> {
  if (
    !["AwaitingOutputConfirmation", "RetryableFailure"].includes(
      draft.status,
    ) ||
    draft.artifacts.length !== 2
  ) {
    throw new Error("当前没有可确认的 Excel 生成结果");
  }
  return beginCouponPilotOaHandoff(draft);
}
