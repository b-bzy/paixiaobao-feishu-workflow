import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import {
  normalizeRegularRatio,
  regularFullReductionInputSchema,
} from "../calculation";
import type {
  ConfirmedCouponSource,
  ConfirmedCouponSetSource,
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
  thresholdYuan: ["满减门槛", "限额", "门槛"],
  discountAmountYuan: ["优惠面额", "面额", "优惠金额"],
  activityPointPercent: ["活动点位", "活动点位（%）", "活动点位%"],
  totalQuantity: ["总申请数量", "申请数量", "总数量"],
  grantQuantityPerClaim: ["单次发放到账张数", "单次到账张数"],
  dailyClaimLimit: ["每日领取次数", "日领取次数"],
  claimWindow: ["可领时间", "领券时间"],
  useWindow: ["可用时间", "用券时间"],
  expectedClaimRate: ["预计领用率", "预计券率", "领用率"],
  expectedUseRate: ["预计使用率", "使用率"],
  platformBearingRatio: ["拍拍平台承担比例", "平台承担比例"],
  estimatedGmvYuan: ["预计引入GMV", "预估GMV", "预计GMV"],
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

function cellText(cell: ExcelJS.Cell): string {
  if (cell.value === null || cell.value === undefined) return "";
  if (typeof cell.value === "object" && "richText" in cell.value) {
    return cell.value.richText
      .map((item) => item.text)
      .join("")
      .trim();
  }
  return String(cell.text || cell.value).trim();
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
    if (worksheetText.includes(marker)) {
      return { score: 80, reason: `识别到名单标记“${marker}”和有效 ID 列` };
    }
    if (fileName.includes(marker)) {
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
        const normalized = normalize(cell.text);
        for (const [key, aliases] of Object.entries(HEADER_ALIASES) as Array<
          [CouponFieldKey, readonly string[]]
        >) {
          if (!aliases.some((alias) => normalize(alias) === normalized))
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
            !identifier.aliases.some((alias) => normalize(alias) === normalized)
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
        if (TIER_ALIASES.some((alias) => normalize(alias) === normalized)) {
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
  if (candidates.length !== 1) {
    throw new Error(
      candidates.length
        ? `字段 ${key} 存在多个候选，需要业务员确认`
        : `配券表缺少字段：${key}`,
    );
  }
  return candidates[0];
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
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export interface ExtractRegularFullReductionInput {
  recognition: WorkbookRecognition;
  fieldCandidateIds?: Partial<Record<CouponFieldKey, string>>;
}

const REGULAR_FIELD_KEYS = (
  Object.keys(HEADER_ALIASES) as CouponFieldKey[]
).filter((key) => key !== "activityPointPercent");

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
  const deterministic = await discoverRegularFullReductionCoupons(input);
  const aiCandidates =
    input.aiRecognition?.sourceHash === input.recognition.sourceHash
      ? input.aiRecognition.couponCandidates
      : [];
  const discovered = [...deterministic];
  for (const candidate of aiCandidates) {
    if (
      !discovered.some(
        (item) =>
          item.sheetName === candidate.sheetName && item.row === candidate.row,
      )
    ) {
      discovered.push(candidate);
    }
  }
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

  for (const key of REGULAR_FIELD_KEYS) {
    const candidateIdValue =
      input.fieldCandidateIds?.[key] ?? selected.fieldCandidateIds[key];
    const candidates = input.recognition.couponFieldCandidates[key] ?? [];
    const candidate = candidateIdValue
      ? candidates.find((item) => item.id === candidateIdValue)
      : candidates.length === 1
        ? candidates[0]
        : undefined;
    if (candidate && candidate.sheetName !== selected.sheetName) {
      throw new Error(`字段 ${key} 与已选择优惠券不在同一 Sheet`);
    }
    const aiCandidate =
      !candidate && input.aiRecognition
        ? input.aiRecognition.fieldCandidates.find(
            (item) =>
              item.key === key &&
              item.sheetName === selected.sheetName &&
              Number(item.valueCell.match(/\d+$/)?.[0]) === selected.row,
          )
        : undefined;
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
      if (source?.rawValue && !input.overrideReasons?.[key]?.trim()) {
        throw new Error(`覆盖来源字段 ${key} 时必须填写原因`);
      }
      const ownerValue = normalizedOwnerValue(
        key,
        input.ownerFieldValues?.[key],
      );
      values[key] = ownerValue;
      provenance[key] = {
        sourceHash: input.recognition.sourceHash,
        fileName: input.recognition.source.fileName,
        sheetName: selected.sheetName,
        row: selected.row,
        column: candidate?.column ?? "OWNER",
        cell: candidate ? `${candidate.column}${selected.row}` : "OWNER",
        rawValue: String(input.ownerFieldValues?.[key] ?? ""),
        normalizedValue: String(ownerValue ?? ""),
        ruleVersion: threeSourceRuleVersion,
        sourceKind: "ownerSupplement",
        ownerId: input.ownerId,
        revision: input.revision,
        overrideReason: input.overrideReasons?.[key]?.trim() || undefined,
      };
    } else if (source?.rawValue) {
      values[key] = normalizedOwnerValue(key, source.rawValue);
      provenance[key] = { ...source, sourceKind: "workbook" };
    }
  }

  const parsed = regularFullReductionInputSchema.safeParse({
    ...values,
    couponType: "东券",
    productLimitType: "限SKU",
    claimRiskControl: "0级以下用户可领",
  });
  if (!parsed.success) {
    throw new Error(
      `配券表字段不符合常规满减券规则：${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("；")}`,
    );
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
  const deterministic = await discoverRegularFullReductionCoupons(input);
  const aiCandidates =
    input.aiRecognition?.sourceHash === input.recognition.sourceHash
      ? input.aiRecognition.couponCandidates
      : [];
  const candidates = [...deterministic];
  for (const candidate of aiCandidates) {
    if (
      !candidates.some(
        (item) =>
          item.sheetName === candidate.sheetName && item.row === candidate.row,
      )
    ) {
      candidates.push(candidate);
    }
  }
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
  const parsed = regularFullReductionInputSchema.safeParse({
    activityName: value("activityName"),
    activityBackground: value("activityBackground"),
    businessMode: value("businessMode"),
    applicantName: value("applicantName"),
    activityStartAt: value("activityStartAt"),
    activityEndAt: value("activityEndAt"),
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
    throw new Error(
      `配券表字段不符合常规满减券规则：${parsed.error.issues.map((issue) => issue.message).join("；")}`,
    );
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
