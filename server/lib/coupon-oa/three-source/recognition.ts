import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import {
  normalizeRegularRatio,
  regularFullReductionInputSchema,
} from "../calculation";
import { parseFlexibleNumber } from "../number-text";
import { canonicalCouponBusinessDate } from "./business-date";
import { couponFieldLabels } from "./owner-input";
import type {
  AiPrimaryRecognitionProjection,
  ConfirmedCouponSetSource,
  ConfirmedCouponSource,
  CouponCandidate,
  CouponFieldCandidate,
  CouponFieldKey,
  CouponType,
  CouponTypeResolution,
  IdentifierDimension,
  ListColumnCandidate,
  OfflineSourceFile,
  SourceProvenance,
  SourceRole,
  SourceRoleDecision,
  ValidatedAiRecognition,
  WorkbookRecognition,
} from "./types";
import { threeSourceRuleVersion } from "./types";

const HEADER_ALIASES: Partial<Record<CouponFieldKey, readonly string[]>> = {
  activityName: ["活动名称", "活动名"],
  activityBackground: ["活动背景", "活动说明", "活动简介"],
  businessMode: ["业务模式"],
  applicantName: ["申请人", "提报人"],
  activityStartAt: ["活动开始日期", "活动开始时间"],
  activityEndAt: ["活动结束日期", "活动结束时间"],
  channels: ["用券渠道", "配置渠道"],
  thresholdYuan: ["满减门槛", "限额", "门槛", "满额"],
  discountAmountYuan: [
    "优惠面额",
    "面额",
    "优惠金额",
    "减免金额",
    "券面额",
    "优惠额度",
  ],
  activityPointPercent: ["活动点位", "活动点位（%）", "活动点位%"],
  totalQuantity: [
    "总申请数量",
    "申请数量",
    "总数量",
    "申请总量",
    "发放总量",
    "发放数量",
    "优惠券数量",
    "券数量",
    "总张数",
    "数量",
  ],
  grantQuantityPerClaim: ["单次发放到账张数", "单次到账张数"],
  dailyClaimLimit: ["每日领取次数", "日领取次数"],
  claimWindow: ["可领时间", "领券时间"],
  useWindow: ["可用时间", "用券时间"],
  expectedClaimRate: ["预计领用率", "预计券率", "领用率"],
  expectedUseRate: ["预计使用率", "使用率"],
  platformBearingRatio: ["拍拍平台承担比例", "平台承担比例"],
  estimatedGmvYuan: [
    "预计引入GMV",
    "预估GMV",
    "预计GMV",
    "预计成交额",
    "预估成交额",
    "成交额",
    "预计销售额",
    "GMV",
  ],
  claimRule: ["用户领券规则", "领券规则"],
  allowGift: ["优惠券赠送", "是否允许赠送"],
  promotionMode: ["推广途径", "推广方式"],
  publicPromotionChannels: ["公开推广渠道", "推广渠道"],
  overDeduction: ["是否超扣点"],
  overDeductionReason: ["超扣点原因"],
};

const IDENTIFIER_ALIASES: Array<{
  dimension: IdentifierDimension;
  aliases: readonly string[];
}> = [
  { dimension: "SKU", aliases: ["sku", "skuid", "商品sku", "sku编号"] },
  { dimension: "SPU", aliases: ["spu", "spuid", "商品spu", "spu编号"] },
  {
    dimension: "MERCHANT_ID",
    aliases: ["商家id", "商家编号", "merchantid", "merchant_id"],
  },
];

const TIER_ALIASES = ["券档", "券档名称", "优惠券档位", "档位"];

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function columnName(index: number): string {
  let result = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s_（）()【】：-]/g, "");
}

/**
 * Header comparison also drops bracketed units/annotations so manually
 * maintained tables match: “预计成交额（元）” and “预计成交额” are the same
 * column for alias lookup and candidate de-duplication.
 */
function normalizeHeader(value: string): string {
  return normalize(
    value.replace(/（[^（）]*）|\([^()]*\)|【[^【】]*】|\[[^[\]]*\]/g, ""),
  );
}

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("richText" in value) {
      return value.richText
        .map((item) => item.text)
        .join("")
        .trim();
    }
    if ("formula" in value || "sharedFormula" in value) {
      // Formula cells carry {formula, result}. Without a cached result the
      // value is unknowable from bytes alone — return empty so the caller
      // falls back to the AI-derived value instead of "[object Object]".
      const result = (value as { result?: unknown }).result;
      if (
        result === undefined ||
        result === null ||
        (typeof result === "object" && "error" in result)
      ) {
        return "";
      }
      return String(result).trim();
    }
    if ("hyperlink" in value) {
      return String((value as { text?: unknown }).text ?? "").trim();
    }
    if (value instanceof Date) {
      return String(cell.text ?? "").trim();
    }
    return "";
  }
  return String(cell.text || value).trim();
}

function candidateId(
  sourceHash: string,
  kind: string,
  sheetName: string,
  headerRow: number,
  column: string,
): string {
  return createHash("sha256")
    .update(
      `${threeSourceRuleVersion}:${sourceHash}:${kind}:${sheetName}:${headerRow}:${column}`,
    )
    .digest("hex")
    .slice(0, 20);
}

function sampleValues(
  worksheet: ExcelJS.Worksheet,
  headerRow: number,
  column: number,
): string[] {
  const samples: string[] = [];
  for (
    let row = headerRow + 1;
    row <= Math.min(worksheet.rowCount, headerRow + 20) && samples.length < 3;
    row += 1
  ) {
    const value = cellText(worksheet.getRow(row).getCell(column));
    if (value) samples.push(value);
  }
  return samples;
}

function isIdentifierLike(value: string): boolean {
  return /^\d{4,}$/.test(value.trim());
}

function headerlessSingleColumnCandidate(input: {
  worksheet: ExcelJS.Worksheet;
  sourceHash: string;
  sourceFileName: string;
}): ListColumnCandidate | undefined {
  const populatedColumns = new Set<number>();
  const values: string[] = [];
  for (let row = 1; row <= input.worksheet.rowCount; row += 1) {
    const current = input.worksheet.getRow(row);
    current.eachCell({ includeEmpty: false }, (cell, column) => {
      const text = cellText(cell);
      if (!text) return;
      populatedColumns.add(column);
      values.push(text);
    });
  }
  if (
    populatedColumns.size !== 1 ||
    values.length < 2 ||
    values.some((value) => !isIdentifierLike(value))
  ) {
    return undefined;
  }
  const columnIndex = [...populatedColumns][0];
  const column = columnName(columnIndex);
  const fileNameHint = normalize(input.sourceFileName).includes("商家id")
    ? "文件名包含“商家ID”，但原表无表头，不能据此确定 ID 类型"
    : "原表无表头，无法从单元格证明 ID 类型";
  return {
    id: candidateId(
      input.sourceHash,
      "identifier-unknown",
      input.worksheet.name,
      0,
      column,
    ),
    kind: "identifier",
    dimension: "UNKNOWN",
    score: 40,
    header: "",
    headerRow: 0,
    column,
    sheetName: input.worksheet.name,
    sampleValues: values.slice(0, 3),
    reasons: ["识别到无表头单列数字区域", fileNameHint],
  };
}

function roleCandidates(input: {
  sourceHash: string;
  sourceFileName: string;
  worksheetTexts: string[];
  couponFieldCount: number;
  listCandidates: ListColumnCandidate[];
}): WorkbookRecognition["roleCandidates"] {
  const candidates: WorkbookRecognition["roleCandidates"] = [];
  if (input.couponFieldCount >= 5) {
    candidates.push({
      id: candidateId(input.sourceHash, "role", "workbook", 0, "coupon"),
      role: "couponTable",
      score: input.couponFieldCount * 10,
      reasons: [`识别到 ${input.couponFieldCount} 个配券字段`],
    });
  }

  const worksheetText = input.worksheetTexts.map(normalize).join(" ");
  const fileName = normalize(input.sourceFileName);
  const roleSignal = (marker: "白名单" | "黑名单") => {
    const englishMarker = marker === "白名单" ? "whitelist" : "blacklist";
    if (
      worksheetText.includes(marker) ||
      worksheetText.includes(englishMarker)
    ) {
      return { score: 80, reason: `识别到名单标记“${marker}”和有效 ID 列` };
    }
    if (fileName.includes(marker) || fileName.includes(englishMarker)) {
      return { score: 30, reason: `文件名包含“${marker}”，且识别到有效 ID 列` };
    }
    return undefined;
  };
  if (
    input.listCandidates.some((candidate) => candidate.kind === "identifier")
  ) {
    const whitelistSignal = roleSignal("白名单");
    if (whitelistSignal) {
      candidates.push({
        id: candidateId(input.sourceHash, "role", "workbook", 0, "whitelist"),
        role: "whitelist",
        score: whitelistSignal.score,
        reasons: [whitelistSignal.reason],
      });
    }
    const blacklistSignal = roleSignal("黑名单");
    if (blacklistSignal) {
      candidates.push({
        id: candidateId(input.sourceHash, "role", "workbook", 0, "blacklist"),
        role: "blacklist",
        score: blacklistSignal.score,
        reasons: [blacklistSignal.reason],
      });
    }
    if (!whitelistSignal && !blacklistSignal) {
      candidates.push({
        id: candidateId(
          input.sourceHash,
          "role",
          "workbook",
          0,
          "default-whitelist",
        ),
        role: "whitelist",
        score: 20,
        reasons: ["仅检测到名单结构，按当前产品规则默认作为白名单候选"],
      });
    }
  }
  return candidates;
}

export async function inspectThreeSourceWorkbook(
  source: OfflineSourceFile,
): Promise<WorkbookRecognition> {
  const sourceHash = hash(source.bytes);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(source.bytes) as never);
  if (!workbook.worksheets.length) {
    throw new Error("工作簿没有可读取的 Sheet");
  }

  const couponFieldCandidates: WorkbookRecognition["couponFieldCandidates"] =
    {};
  const listCandidates: ListColumnCandidate[] = [];
  const texts: string[] = [];

  for (const worksheet of workbook.worksheets) {
    const firstListCandidateIndex = listCandidates.length;
    texts.push(worksheet.name);
    for (let row = 1; row <= Math.min(worksheet.rowCount, 100); row += 1) {
      const current = worksheet.getRow(row);
      const cells = Array.from(
        { length: Math.max(current.cellCount, worksheet.columnCount) },
        (_, offset) => ({
          index: offset + 1,
          text: cellText(current.getCell(offset + 1)),
        }),
      ).filter((cell) => cell.text);
      texts.push(...cells.map((cell) => cell.text));
      if (!cells.length) continue;

      for (const cell of cells) {
        const normalized = normalizeHeader(cell.text);
        for (const [key, aliases] of Object.entries(HEADER_ALIASES) as Array<
          [CouponFieldKey, readonly string[]]
        >) {
          if (!aliases.some((alias) => normalizeHeader(alias) === normalized))
            continue;
          const column = columnName(cell.index);
          const candidate: CouponFieldCandidate = {
            id: candidateId(sourceHash, key, worksheet.name, row, column),
            key,
            score: 100,
            header: cell.text,
            headerRow: row,
            column,
            sheetName: worksheet.name,
            sampleValues: sampleValues(worksheet, row, cell.index),
            reasons: [`表头“${cell.text}”匹配字段别名`],
          };
          const candidatesForKey = couponFieldCandidates[key] ?? [];
          candidatesForKey.push(candidate);
          couponFieldCandidates[key] = candidatesForKey;
        }

        for (const identifier of IDENTIFIER_ALIASES) {
          if (
            !identifier.aliases.some(
              (alias) => normalizeHeader(alias) === normalized,
            )
          ) {
            continue;
          }
          const column = columnName(cell.index);
          listCandidates.push({
            id: candidateId(
              sourceHash,
              "identifier",
              worksheet.name,
              row,
              column,
            ),
            kind: "identifier",
            dimension: identifier.dimension,
            score: 100,
            header: cell.text,
            headerRow: row,
            column,
            sheetName: worksheet.name,
            sampleValues: sampleValues(worksheet, row, cell.index),
            reasons: [`表头“${cell.text}”匹配 ${identifier.dimension} 别名`],
          });
        }
        if (
          TIER_ALIASES.some((alias) => normalizeHeader(alias) === normalized)
        ) {
          const column = columnName(cell.index);
          listCandidates.push({
            id: candidateId(sourceHash, "tier", worksheet.name, row, column),
            kind: "tier",
            score: 100,
            header: cell.text,
            headerRow: row,
            column,
            sheetName: worksheet.name,
            sampleValues: sampleValues(worksheet, row, cell.index),
            reasons: [`表头“${cell.text}”匹配券档别名`],
          });
        }
      }
    }
    if (
      !listCandidates
        .slice(firstListCandidateIndex)
        .some((candidate) => candidate.kind === "identifier")
    ) {
      const candidate = headerlessSingleColumnCandidate({
        worksheet,
        sourceHash,
        sourceFileName: source.fileName,
      });
      if (candidate) listCandidates.push(candidate);
    }
  }

  const couponFieldCount = Object.keys(couponFieldCandidates).length;
  return {
    source,
    sourceHash,
    roleCandidates: roleCandidates({
      sourceHash,
      sourceFileName: source.fileName,
      worksheetTexts: texts,
      couponFieldCount,
      listCandidates,
    }),
    couponFieldCandidates,
    listCandidates,
    issues: [],
  };
}

export function resolveSourceRoleCandidates(input: {
  recognition: WorkbookRecognition;
  occupiedRoles: Partial<Record<SourceRole, string>>;
  sourceCount: number;
}): SourceRoleDecision {
  const sorted = [...input.recognition.roleCandidates].sort(
    (left, right) => right.score - left.score,
  );
  const top = sorted[0];
  if (top && (!sorted[1] || top.score > sorted[1].score)) {
    const occupiedByOther = Boolean(
      input.occupiedRoles[top.role] &&
        input.occupiedRoles[top.role] !== input.recognition.sourceHash,
    );
    return {
      role: occupiedByOther ? "unknown" : top.role,
      confidence: top.score >= 80 ? "high" : "low",
      reasons: top.reasons,
      requiresOwnerConfirmation: occupiedByOther,
    };
  }
  const looksLikeList = input.recognition.listCandidates.some(
    (candidate) => candidate.kind === "identifier",
  );
  if (
    looksLikeList &&
    !input.occupiedRoles.whitelist &&
    input.sourceCount <= 2
  ) {
    return {
      role: "whitelist",
      confidence: "low",
      reasons: ["仅识别到名单形态，按常见两份材料场景默认作为白名单候选"],
      requiresOwnerConfirmation: false,
    };
  }
  return {
    role: "unknown",
    confidence: "low",
    reasons: looksLikeList
      ? ["名单用途无法从现有证据确定"]
      : ["无法根据工作簿内容确定材料角色"],
    requiresOwnerConfirmation: true,
  };
}

export function selectUniqueRole(recognition: WorkbookRecognition): SourceRole {
  const sorted = [...recognition.roleCandidates].sort(
    (left, right) => right.score - left.score,
  );
  if (!sorted.length) {
    throw new Error("无法根据工作簿内容识别材料角色");
  }
  if (sorted.length > 1 && sorted[0].score === sorted[1].score) {
    throw new Error("材料角色存在多个同等候选，需要业务员确认");
  }
  return sorted[0].role;
}

function selectFieldCandidate(
  recognition: WorkbookRecognition,
  key: CouponFieldKey,
  candidateId?: string,
): CouponFieldCandidate {
  const candidates = recognition.couponFieldCandidates[key] ?? [];
  if (candidateId) {
    const candidate = candidates.find((item) => item.id === candidateId);
    if (!candidate) {
      throw new Error(`未找到已确认的${key}字段候选`);
    }
    return candidate;
  }
  const canonicalCandidates = candidates.filter(
    (candidate, index) =>
      candidates.findIndex(
        (current) =>
          current.sheetName === candidate.sheetName &&
          current.column === candidate.column &&
          normalizeHeader(current.header) === normalizeHeader(candidate.header),
      ) === index,
  );
  if (canonicalCandidates.length !== 1) {
    throw new Error(
      canonicalCandidates.length
        ? `字段 ${key} 存在多个候选，需要业务员确认`
        : `配券表缺少字段：${key}`,
    );
  }
  return canonicalCandidates[0];
}

function sourceCell(
  worksheet: ExcelJS.Worksheet,
  row: number,
  column: string,
  sourceHash: string,
  fileName: string,
): SourceProvenance {
  const cell = worksheet.getRow(row).getCell(column);
  const rawValue = cellText(cell);
  return {
    sourceHash,
    fileName,
    sheetName: worksheet.name,
    row,
    column,
    cell: `${column}${row}`,
    rawValue,
    normalizedValue: rawValue,
    ruleVersion: threeSourceRuleVersion,
  };
}

function normalizeChannels(value: string): Array<"JD" | "PAIPAI"> {
  const channels = value
    .split(/[、，,；;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((item) => {
      if (["JD", "京东", "京东商城", "京东渠道"].includes(item))
        return ["JD"] as const;
      if (
        ["PAIPAI", "拍拍", "拍拍二手", "严选", "严选APP及小程序"].includes(item)
      ) {
        return ["PAIPAI"] as const;
      }
      return [] as const;
    });
  return [...new Set(channels)];
}

function number(value: string): number | undefined {
  return parseFlexibleNumber(value);
}

export interface ExtractRegularFullReductionInput {
  recognition: WorkbookRecognition;
  fieldCandidateIds?: Partial<Record<CouponFieldKey, string>>;
}

export interface RegularFullReductionFieldIssue {
  key: CouponFieldKey;
  message: string;
}

interface RegularFieldSchemaIssue {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly message: string;
  readonly expected?: string;
  readonly minimum?: unknown;
  readonly maximum?: unknown;
}

/**
 * Field-level, owner-readable validation failure. The message is what the
 * business user sees on the restored form card; `fieldIssues` lets the
 * dispatcher render exactly the broken fields as editable inputs.
 */
export class RegularFullReductionFieldError extends Error {
  readonly code = "regular_full_reduction_field_invalid";

  constructor(readonly fieldIssues: RegularFullReductionFieldIssue[]) {
    super(
      `配券表字段不符合常规满减券规则：${fieldIssues
        .map((issue) => issue.message)
        .join("；")}`,
    );
    this.name = "RegularFullReductionFieldError";
  }
}

function describeRegularFieldIssues(
  issues: readonly RegularFieldSchemaIssue[],
  rawTexts: Partial<Record<CouponFieldKey, string>>,
): RegularFullReductionFieldIssue[] {
  return issues.map((issue) => {
    const key = issue.path[0];
    const fieldKey =
      typeof key === "string" ? (key as CouponFieldKey) : undefined;
    const label = fieldKey ? couponFieldLabels[fieldKey] : undefined;
    const raw = (fieldKey ? rawTexts[fieldKey] : "")?.trim() ?? "";
    const quotedRaw = raw ? `“${raw}”` : "";
    if (!fieldKey || !label || issue.code === "custom") {
      return { key: fieldKey ?? "activityName", message: issue.message };
    }
    if (issue.code === "invalid_type") {
      if (!raw) {
        return {
          key: fieldKey,
          message: `未识别到「${label}」的取值：请检查配券表对应列的表头和数据行是否已填写`,
        };
      }
      return {
        key: fieldKey,
        message: `「${label}」的取值${quotedRaw}无法识别为${
          issue.expected === "number" ? "数字" : "有效值"
        }，请修改后重新提交`,
      };
    }
    if (issue.code === "too_small" || issue.code === "too_big") {
      const bound = issue.code === "too_small" ? issue.minimum : issue.maximum;
      return {
        key: fieldKey,
        message: `「${label}」的取值${quotedRaw}超出允许范围（${
          issue.code === "too_small" ? "下限" : "上限"
        } ${String(bound)}）`,
      };
    }
    return {
      key: fieldKey,
      message: `「${label}」的取值${quotedRaw}未通过校验：${issue.message}`,
    };
  });
}

function throwRegularFieldIssues(
  issues: readonly RegularFieldSchemaIssue[],
  rawTexts: Partial<Record<CouponFieldKey, string>>,
): never {
  throw new RegularFullReductionFieldError(
    describeRegularFieldIssues(issues, rawTexts),
  );
}

const REGULAR_FIELD_KEYS = (
  Object.keys(HEADER_ALIASES) as CouponFieldKey[]
).filter((key) => key !== "activityPointPercent");

const SHARED_ACTIVITY_FIELD_KEYS = new Set<CouponFieldKey>([
  "activityStartAt",
  "activityEndAt",
  "claimWindow",
  "useWindow",
]);

function sharedAiFieldCandidate(input: {
  key: CouponFieldKey;
  sheetName: string;
  candidates: ValidatedAiRecognition["fieldCandidates"] | undefined;
}): ValidatedAiRecognition["fieldCandidates"][number] | undefined {
  if (!SHARED_ACTIVITY_FIELD_KEYS.has(input.key)) return undefined;
  const candidates = (input.candidates ?? []).filter(
    (candidate) =>
      candidate.key === input.key && candidate.sheetName === input.sheetName,
  );
  if (!candidates.length) return undefined;
  const normalizedValues = new Set(
    candidates.map((candidate) =>
      JSON.stringify(safelyNormalizeOwnerValue(input.key, candidate.value)),
    ),
  );
  return normalizedValues.size === 1 ? candidates[0] : undefined;
}

function candidateForRow(
  recognition: WorkbookRecognition,
  worksheet: ExcelJS.Worksheet,
  headerRow: number,
  row: number,
  candidates: Partial<Record<CouponFieldKey, CouponFieldCandidate>>,
): CouponCandidate {
  const thresholdCandidate = candidates.thresholdYuan;
  const discountCandidate = candidates.discountAmountYuan;
  const threshold = thresholdCandidate
    ? cellText(worksheet.getRow(row).getCell(thresholdCandidate.column))
    : "";
  const discount = discountCandidate
    ? cellText(worksheet.getRow(row).getCell(discountCandidate.column))
    : "";
  const displayName =
    threshold && discount
      ? `满${threshold}减${discount}`
      : `${worksheet.name} 第 ${row} 行`;
  return {
    id: candidateId(
      recognition.sourceHash,
      "coupon-row",
      worksheet.name,
      row,
      String(headerRow),
    ),
    couponType: "regular_full_reduction",
    displayName,
    sourceHash: recognition.sourceHash,
    sheetName: worksheet.name,
    row,
    evidenceCells: Object.values(candidates)
      .map((candidate) => `${candidate.column}${row}`)
      .filter((address) => Boolean(cellText(worksheet.getCell(address)))),
    fieldCandidateIds: Object.fromEntries(
      Object.entries(candidates).map(([key, candidate]) => [key, candidate.id]),
    ),
    source: "deterministic",
  };
}

export async function discoverRegularFullReductionCoupons(input: {
  recognition: WorkbookRecognition;
  fieldCandidateIds?: Partial<Record<CouponFieldKey, string>>;
}): Promise<CouponCandidate[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(input.recognition.source.bytes) as never,
  );
  const grouped = new Map<
    string,
    Partial<Record<CouponFieldKey, CouponFieldCandidate>>
  >();
  for (const key of REGULAR_FIELD_KEYS) {
    const candidates = input.recognition.couponFieldCandidates[key] ?? [];
    const explicitlySelected = input.fieldCandidateIds?.[key];
    const selected = explicitlySelected
      ? candidates.filter((candidate) => candidate.id === explicitlySelected)
      : candidates;
    for (const candidate of selected) {
      const groupKey = `${candidate.sheetName}\u0000${candidate.headerRow}`;
      const fields = grouped.get(groupKey) ?? {};
      if (!fields[key] || explicitlySelected) fields[key] = candidate;
      grouped.set(groupKey, fields);
    }
  }

  const discovered: CouponCandidate[] = [];
  for (const [groupKey, fields] of grouped) {
    const [sheetName, headerRowText] = groupKey.split("\u0000");
    const headerRow = Number(headerRowText);
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) continue;
    for (let row = headerRow + 1; row <= worksheet.rowCount; row += 1) {
      const populated = Object.values(fields).filter((candidate) =>
        Boolean(cellText(worksheet.getRow(row).getCell(candidate.column))),
      ).length;
      if (populated < 2) continue;
      discovered.push(
        candidateForRow(input.recognition, worksheet, headerRow, row, fields),
      );
    }
  }
  return discovered;
}

export async function resolveAiPrimaryRecognition(input: {
  recognition: WorkbookRecognition;
  aiRecognition?: ValidatedAiRecognition;
}): Promise<AiPrimaryRecognitionProjection> {
  const deterministic = await discoverRegularFullReductionCoupons({
    recognition: input.recognition,
  });
  const ai =
    input.aiRecognition?.sourceHash === input.recognition.sourceHash &&
    !input.aiRecognition.issues.some((issue) =>
      issue.includes("返回结构不符合严格候选 schema"),
    )
      ? input.aiRecognition
      : undefined;
  const aiCouponPartitionValid =
    Boolean(ai?.couponCandidates.length) &&
    !ai?.issues.some((issue) => issue.includes("优惠券候选分区结构无效"));
  const couponCandidates = aiCouponPartitionValid
    ? [...(ai?.couponCandidates ?? [])]
    : deterministic;
  return {
    sourceHash: input.recognition.sourceHash,
    mode: aiCouponPartitionValid ? "ai_primary" : "rule_fallback",
    couponCandidates,
    fieldCandidates: ai?.fieldCandidates ?? [],
    templateCandidates: ai?.templateCandidates ?? [],
    tierCandidates: ai?.tierCandidates ?? [],
    skuRegionCandidates: ai?.skuRegionCandidates ?? [],
    issues: [
      ...(ai?.issues ?? []),
      ...(!aiCouponPartitionValid && input.aiRecognition
        ? ["AI 优惠券候选缺失或无效，已使用规则降级"]
        : []),
      ...input.recognition.issues,
    ],
  };
}

export function resolveCouponType(input: {
  candidates: CouponCandidate[];
  ownerConfirmedCouponType?: CouponType;
}): CouponTypeResolution {
  if (input.candidates.length > 1) {
    return {
      status: "multiple_coupons",
      candidates: input.candidates,
      issues: ["同一提报识别到多个优惠券，必须由业务员选择一个"],
    };
  }
  const supported = input.candidates.filter(
    (candidate) => candidate.couponType === "regular_full_reduction",
  );
  const unsupported = input.candidates.filter(
    (candidate) => candidate.couponType === "unsupported",
  );
  if (unsupported.length && !supported.length) {
    return {
      status: "unsupported",
      candidates: input.candidates,
      issues: ["识别到当前 P0 不支持的优惠券类型"],
    };
  }
  if (supported.length === 1) {
    return {
      status: "unique",
      couponType: "regular_full_reduction",
      candidates: supported,
      issues: [],
    };
  }
  if (input.ownerConfirmedCouponType === "regular_full_reduction") {
    return {
      status: "unique",
      couponType: "regular_full_reduction",
      candidates: input.candidates,
      issues: [],
    };
  }
  return {
    status: "unknown",
    candidates: input.candidates,
    issues: ["无法识别优惠券类型，需要业务员确认"],
  };
}

function normalizedOwnerValue(key: CouponFieldKey, value: unknown): unknown {
  if (key === "activityStartAt" || key === "activityEndAt") {
    return (
      canonicalCouponBusinessDate(value) ??
      (typeof value === "string" ? value.trim() : value)
    );
  }
  if (key === "channels") {
    return Array.isArray(value)
      ? value
      : normalizeChannels(String(value ?? ""));
  }
  if (key === "publicPromotionChannels") {
    return Array.isArray(value)
      ? value
      : String(value ?? "")
          .split(/[、，,；;]/)
          .map((item) => item.trim())
          .filter(Boolean);
  }
  if (
    [
      "thresholdYuan",
      "discountAmountYuan",
      "totalQuantity",
      "grantQuantityPerClaim",
      "dailyClaimLimit",
      "estimatedGmvYuan",
      "activityPointPercent",
    ].includes(key)
  ) {
    return typeof value === "number" ? value : number(String(value ?? ""));
  }
  if (
    ["expectedClaimRate", "expectedUseRate", "platformBearingRatio"].includes(
      key,
    )
  ) {
    return typeof value === "number"
      ? value
      : normalizeRegularRatio(String(value ?? ""));
  }
  return typeof value === "string" ? value.trim() : value;
}

function safelyNormalizeOwnerValue(
  key: CouponFieldKey,
  value: unknown,
): unknown {
  try {
    return normalizedOwnerValue(key, value);
  } catch {
    return undefined;
  }
}

export interface ConfirmRegularFullReductionCouponInput {
  recognition: WorkbookRecognition;
  ownerId: string;
  revision: number;
  couponCandidateId?: string;
  ownerConfirmedCouponType?: CouponType;
  fieldCandidateIds?: Partial<Record<CouponFieldKey, string>>;
  ownerFieldValues?: Partial<Record<CouponFieldKey, unknown>>;
  overrideReasons?: Partial<Record<CouponFieldKey, string>>;
  aiRecognition?: ValidatedAiRecognition;
}

export class MultipleCouponCandidatesError extends Error {
  readonly code = "multiple_coupon_candidates";

  constructor(readonly candidates: CouponCandidate[]) {
    super("识别到多个优惠券，必须明确选择其中一个");
    this.name = "MultipleCouponCandidatesError";
  }
}

export async function confirmRegularFullReductionCoupon(
  input: ConfirmRegularFullReductionCouponInput,
): Promise<ConfirmedCouponSource> {
  const discovered = [
    ...(await resolveAiPrimaryRecognition(input)).couponCandidates,
  ];
  const resolution = resolveCouponType({
    candidates: discovered,
    ownerConfirmedCouponType: input.ownerConfirmedCouponType,
  });
  if (resolution.status === "unsupported" || resolution.status === "unknown") {
    throw new Error(resolution.issues.join("；"));
  }
  let selected: CouponCandidate | undefined;
  if (input.couponCandidateId) {
    selected = discovered.find(
      (candidate) => candidate.id === input.couponCandidateId,
    );
    if (!selected) throw new Error("已选择的优惠券候选不存在或已过期");
  } else if (discovered.length === 1) {
    selected = discovered[0];
  } else if (discovered.length > 1) {
    throw new MultipleCouponCandidatesError(discovered);
  } else {
    throw new Error("未找到可绑定来源行的优惠券候选");
  }
  if (selected.couponType === "unsupported") {
    throw new Error("所选优惠券类型不在当前 P0 支持范围内");
  }
  if (
    selected.couponType === "unknown" &&
    input.ownerConfirmedCouponType !== "regular_full_reduction"
  ) {
    throw new Error("所选优惠券仍需业务员确认类型");
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(input.recognition.source.bytes) as never,
  );
  const worksheet = workbook.getWorksheet(selected.sheetName);
  if (!worksheet) throw new Error("已选择的优惠券来源 Sheet 不存在");
  const provenance: Partial<Record<CouponFieldKey, SourceProvenance>> = {};
  const values: Partial<Record<CouponFieldKey, unknown>> = {};
  const rawTexts: Partial<Record<CouponFieldKey, string>> = {};

  for (const key of REGULAR_FIELD_KEYS) {
    const candidateIdValue =
      input.fieldCandidateIds?.[key] ?? selected.fieldCandidateIds[key];
    const candidates = input.recognition.couponFieldCandidates[key] ?? [];
    const explicitlySelectedCandidate = candidateIdValue
      ? candidates.find((item) => item.id === candidateIdValue)
      : undefined;
    const aiCandidate =
      input.aiRecognition?.fieldCandidates.find(
        (item) =>
          item.key === key &&
          item.sheetName === selected.sheetName &&
          Number(item.valueCell.match(/\d+$/)?.[0]) === selected.row,
      ) ??
      sharedAiFieldCandidate({
        key,
        sheetName: selected.sheetName,
        candidates: input.aiRecognition?.fieldCandidates,
      });
    const candidate =
      explicitlySelectedCandidate ??
      (!aiCandidate && candidates.length === 1 ? candidates[0] : undefined);
    if (candidate && candidate.sheetName !== selected.sheetName) {
      throw new Error(`字段 ${key} 与已选择优惠券不在同一 Sheet`);
    }
    const aiColumn = aiCandidate?.valueCell.match(/^[A-Z]+/)?.[0];
    const source = candidate
      ? sourceCell(
          worksheet,
          selected.row,
          candidate.column,
          input.recognition.sourceHash,
          input.recognition.source.fileName,
        )
      : aiColumn
        ? sourceCell(
            worksheet,
            selected.row,
            aiColumn,
            input.recognition.sourceHash,
            input.recognition.source.fileName,
          )
        : undefined;
    const ownerProvided = Object.hasOwn(input.ownerFieldValues ?? {}, key);
    if (ownerProvided) {
      const ownerValue = normalizedOwnerValue(
        key,
        input.ownerFieldValues?.[key],
      );
      // Owner-provided values take precedence over explicit workbook cells;
      // the modification is fully traced in provenance (sourceKind
      // "ownerSupplement" plus before/after values, owner and revision).
      rawTexts[key] = String(input.ownerFieldValues?.[key] ?? "");
      values[key] = ownerValue;
      provenance[key] = {
        sourceHash: input.recognition.sourceHash,
        fileName: input.recognition.source.fileName,
        sheetName: selected.sheetName,
        row: selected.row,
        column: candidate?.column ?? aiColumn ?? "OWNER",
        cell:
          candidate || aiColumn
            ? `${candidate?.column ?? aiColumn}${selected.row}`
            : "OWNER",
        rawValue: String(input.ownerFieldValues?.[key] ?? ""),
        normalizedValue: String(ownerValue ?? ""),
        ruleVersion: threeSourceRuleVersion,
        sourceKind: "ownerSupplement",
        ownerId: input.ownerId,
        revision: input.revision,
        overrideReason: input.overrideReasons?.[key]?.trim() || undefined,
      };
    } else if (source?.rawValue) {
      rawTexts[key] = source.rawValue;
      values[key] = normalizedOwnerValue(key, source.rawValue);
      provenance[key] = { ...source, sourceKind: "workbook" };
    } else {
      const aiValue = aiCandidate?.value;
      const aiText =
        typeof aiValue === "string" || typeof aiValue === "number"
          ? String(aiValue).trim()
          : "";
      if (aiText) {
        // Formula cells without cached results read as empty from the
        // workbook; the validated AI candidate already derived them.
        rawTexts[key] = aiText;
        values[key] = normalizedOwnerValue(key, aiText);
        provenance[key] = {
          sourceHash: input.recognition.sourceHash,
          fileName: input.recognition.source.fileName,
          sheetName: selected.sheetName,
          row: selected.row,
          column: aiColumn ?? "AI",
          cell: aiColumn ? `${aiColumn}${selected.row}` : "AI",
          rawValue: aiText,
          normalizedValue: String(values[key] ?? ""),
          ruleVersion: threeSourceRuleVersion,
          sourceKind: "aiDerived",
        };
      }
    }
  }

  const parsed = regularFullReductionInputSchema.safeParse({
    ...values,
    couponType: "东券",
    productLimitType: "限SKU",
    claimRiskControl: "0级以下用户可领",
  });
  if (!parsed.success) {
    throwRegularFieldIssues(parsed.error.issues, rawTexts);
  }

  const activityPointRaw = input.ownerFieldValues?.activityPointPercent;
  const activityPointPercent = normalizedOwnerValue(
    "activityPointPercent",
    activityPointRaw,
  );
  if (
    typeof activityPointPercent !== "number" ||
    !Number.isFinite(activityPointPercent) ||
    activityPointPercent <= 0
  ) {
    throw new Error("活动点位必须由业务员确认且为正数");
  }
  provenance.activityPointPercent = {
    sourceHash: input.recognition.sourceHash,
    fileName: input.recognition.source.fileName,
    sheetName: selected.sheetName,
    row: selected.row,
    column: "OWNER",
    cell: "OWNER",
    rawValue: String(activityPointRaw),
    normalizedValue: String(activityPointPercent),
    ruleVersion: threeSourceRuleVersion,
    sourceKind: "ownerSupplement",
    ownerId: input.ownerId,
    revision: input.revision,
  };
  return {
    input: parsed.data,
    provenance,
    sourceHash: input.recognition.sourceHash,
    couponCandidateId: selected.id,
    couponType: "regular_full_reduction",
    activityPointPercent,
  };
}

export async function confirmRegularFullReductionCouponSet(
  input: Omit<ConfirmRegularFullReductionCouponInput, "couponCandidateId">,
): Promise<ConfirmedCouponSetSource> {
  const candidates = [
    ...(await resolveAiPrimaryRecognition(input)).couponCandidates,
  ];
  const supported = candidates
    .filter(
      (candidate) =>
        candidate.couponType === "regular_full_reduction" ||
        (candidate.couponType === "unknown" &&
          input.ownerConfirmedCouponType === "regular_full_reduction"),
    )
    .sort((left, right) =>
      left.sheetName === right.sheetName
        ? left.row - right.row
        : left.sheetName.localeCompare(right.sheetName, "zh-CN"),
    );
  if (!supported.length) {
    throw new Error("未找到当前 P0 支持的常规满减券档");
  }
  if (candidates.some((candidate) => candidate.couponType === "unsupported")) {
    throw new Error("同一配券表识别到不同模板类型，不能混合生成");
  }
  const tiers: ConfirmedCouponSource[] = [];
  for (const candidate of supported) {
    tiers.push(
      await confirmRegularFullReductionCoupon({
        ...input,
        couponCandidateId: candidate.id,
      }),
    );
  }
  const activityPointPercent = tiers[0].activityPointPercent;
  if (
    typeof activityPointPercent !== "number" ||
    tiers.some((tier) => tier.activityPointPercent !== activityPointPercent)
  ) {
    throw new Error("同一提报的活动点位必须一致");
  }
  return {
    templateKind: "regular_full_reduction",
    sourceHash: input.recognition.sourceHash,
    activityPointPercent,
    tiers,
  };
}

export async function extractRegularFullReductionInput(
  input: ExtractRegularFullReductionInput,
): Promise<ConfirmedCouponSource> {
  const { recognition } = input;
  const keys = (Object.keys(HEADER_ALIASES) as CouponFieldKey[]).filter(
    (key) => key !== "activityPointPercent",
  );
  const candidates = Object.fromEntries(
    keys.map((key) => [
      key,
      selectFieldCandidate(recognition, key, input.fieldCandidateIds?.[key]),
    ]),
  ) as Record<
    Exclude<CouponFieldKey, "activityPointPercent">,
    CouponFieldCandidate
  >;
  const headerRows = new Set(
    Object.values(candidates).map((candidate) => candidate.headerRow),
  );
  const sheets = new Set(
    Object.values(candidates).map((candidate) => candidate.sheetName),
  );
  if (headerRows.size !== 1 || sheets.size !== 1) {
    throw new Error("配券字段不在同一张表或同一表头行，需要业务员确认映射");
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(recognition.source.bytes) as never);
  const headerRow = [...headerRows][0];
  const worksheet = workbook.getWorksheet([...sheets][0]);
  if (!worksheet) throw new Error("找不到已确认的配券表 Sheet");

  let dataRow: number | undefined;
  for (let row = headerRow + 1; row <= worksheet.rowCount; row += 1) {
    const populated = Object.values(candidates).filter(
      (candidate) =>
        cellText(worksheet.getRow(row).getCell(candidate.column)) !== "",
    ).length;
    if (populated >= 10) {
      dataRow = row;
      break;
    }
  }
  if (!dataRow) throw new Error("配券表未找到完整的数据行");

  const provenance = Object.fromEntries(
    keys.map((key) => [
      key,
      sourceCell(
        worksheet,
        dataRow,
        candidates[key].column,
        recognition.sourceHash,
        recognition.source.fileName,
      ),
    ]),
  ) as Partial<Record<CouponFieldKey, SourceProvenance>>;
  const value = (key: CouponFieldKey): string => {
    const source = provenance[key];
    if (!source) throw new Error(`配券表缺少字段来源：${key}`);
    return source.rawValue;
  };
  const rawTexts = Object.fromEntries(
    keys.map((key) => [key, value(key)]),
  ) as Partial<Record<CouponFieldKey, string>>;
  const parsed = regularFullReductionInputSchema.safeParse({
    activityName: value("activityName"),
    activityBackground: value("activityBackground"),
    businessMode: value("businessMode"),
    applicantName: value("applicantName"),
    activityStartAt:
      canonicalCouponBusinessDate(value("activityStartAt")) ??
      value("activityStartAt"),
    activityEndAt:
      canonicalCouponBusinessDate(value("activityEndAt")) ??
      value("activityEndAt"),
    channels: normalizeChannels(value("channels")),
    thresholdYuan: number(value("thresholdYuan")),
    discountAmountYuan: number(value("discountAmountYuan")),
    totalQuantity: number(value("totalQuantity")),
    grantQuantityPerClaim: number(value("grantQuantityPerClaim")),
    dailyClaimLimit: number(value("dailyClaimLimit")),
    claimWindow: value("claimWindow"),
    useWindow: value("useWindow"),
    expectedClaimRate: normalizeRegularRatio(value("expectedClaimRate")),
    expectedUseRate: normalizeRegularRatio(value("expectedUseRate")),
    platformBearingRatio: normalizeRegularRatio(value("platformBearingRatio")),
    estimatedGmvYuan: number(value("estimatedGmvYuan")),
    couponType: "东券",
    productLimitType: "限SKU",
    claimRiskControl: "0级以下用户可领",
    claimRule: value("claimRule"),
    allowGift: value("allowGift"),
    promotionMode: value("promotionMode"),
    publicPromotionChannels: value("publicPromotionChannels")
      .split(/[、，,；;]/)
      .map((item) => item.trim())
      .filter(Boolean),
    overDeduction: value("overDeduction"),
    overDeductionReason: value("overDeductionReason"),
  });
  if (!parsed.success) {
    throwRegularFieldIssues(parsed.error.issues, rawTexts);
  }
  return {
    input: parsed.data,
    provenance,
    sourceHash: recognition.sourceHash,
  };
}

export function selectUniqueListCandidate(
  recognition: WorkbookRecognition,
  kind: ListColumnCandidate["kind"],
): ListColumnCandidate {
  const candidates = recognition.listCandidates.filter(
    (candidate) => candidate.kind === kind,
  );
  if (candidates.length !== 1) {
    throw new Error(
      candidates.length
        ? `${kind === "identifier" ? "ID" : "券档"} 列存在多个候选，需要业务员确认`
        : `未识别到${kind === "identifier" ? "ID" : "券档"}列`,
    );
  }
  return candidates[0];
}
