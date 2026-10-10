import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import {
  type MultiTierSkuSheetName,
  multiTierSkuSheetNames,
} from "../../excel-template-engine/template-manifests";
import { selectUniqueListCandidate } from "./recognition";
import type {
  ListColumnCandidate,
  OfflineSourceFile,
  OverlapDecision,
  OverlapSnapshot,
  ParsedSingleCouponIdentifierList,
  ParsedTieredIdentifierList,
  SourceProvenance,
  WorkbookRecognition,
} from "./types";
import { threeSourceRuleVersion } from "./types";

const MULTIPLE_IDENTIFIER_SEPARATOR = /[\s,，、;；\n]/;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceHash(source: OfflineSourceFile): string {
  return createHash("sha256").update(source.bytes).digest("hex");
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

function isFormula(cell: ExcelJS.Cell): boolean {
  return (
    cell.type === ExcelJS.ValueType.Formula ||
    (typeof cell.value === "object" &&
      cell.value !== null &&
      "formula" in cell.value)
  );
}

function tierName(value: string): MultiTierSkuSheetName | undefined {
  const normalized = value.toLowerCase().replace(/[\s_\-－—（）()：:]/g, "");
  return multiTierSkuSheetNames.find(
    (tier) =>
      tier.toLowerCase().replace(/[\s_\-－—（）()：:]/g, "") === normalized,
  );
}

function candidateById(
  candidates: ListColumnCandidate[],
  candidateId: string | undefined,
  kind: ListColumnCandidate["kind"],
): ListColumnCandidate {
  if (!candidateId) {
    const recognition = {
      listCandidates: candidates,
    } as WorkbookRecognition;
    return selectUniqueListCandidate(recognition, kind);
  }
  const candidate = candidates.find(
    (item) => item.id === candidateId && item.kind === kind,
  );
  if (!candidate) {
    throw new Error(
      `未找到已确认的${kind === "identifier" ? "ID" : "券档"}列候选`,
    );
  }
  return candidate;
}

function provenance(input: {
  source: OfflineSourceFile;
  sourceHash: string;
  worksheet: ExcelJS.Worksheet;
  row: number;
  column: string;
  rawValue: string;
  normalizedValue: string;
}): SourceProvenance {
  return {
    sourceHash: input.sourceHash,
    fileName: input.source.fileName,
    sheetName: input.worksheet.name,
    row: input.row,
    column: input.column,
    cell: `${input.column}${input.row}`,
    rawValue: input.rawValue,
    normalizedValue: input.normalizedValue,
    ruleVersion: threeSourceRuleVersion,
  };
}

export interface ParseTieredIdentifierListInput {
  recognition: WorkbookRecognition;
  role: "whitelist" | "blacklist";
  identifierCandidateId?: string;
  tierCandidateId?: string;
  defaultTier?: MultiTierSkuSheetName;
}

/**
 * Parses a business source list only after its candidate columns have been
 * selected. Invalid source values remain issues; callers must not reinterpret
 * an invalid blacklist as an explicitly absent blacklist.
 */
export async function parseTieredIdentifierList(
  input: ParseTieredIdentifierListInput,
): Promise<ParsedTieredIdentifierList> {
  const identifier = candidateById(
    input.recognition.listCandidates,
    input.identifierCandidateId,
    "identifier",
  );
  const tier = input.tierCandidateId
    ? candidateById(
        input.recognition.listCandidates,
        input.tierCandidateId,
        "tier",
      )
    : input.defaultTier
      ? undefined
      : candidateById(input.recognition.listCandidates, undefined, "tier");
  if (!tier && !input.defaultTier) {
    throw new Error("名单没有可确认的券档列，也没有确认默认券档");
  }
  if (tier && tier.sheetName !== identifier.sheetName) {
    throw new Error("名单 ID 列和券档列不在同一 Sheet，需要业务员确认映射");
  }
  if (identifier.dimension !== "SKU") {
    throw new Error(
      `当前离线切片只支持 SKU 名单，不支持 ${identifier.dimension}`,
    );
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(input.recognition.source.bytes) as never,
  );
  const worksheet = workbook.getWorksheet(identifier.sheetName);
  if (!worksheet) throw new Error("找不到已确认的名单 Sheet");
  const headerRow = Math.max(identifier.headerRow, tier?.headerRow ?? 0);
  const idColumn = worksheet.getColumn(identifier.column).number;
  const tierColumn = tier ? worksheet.getColumn(tier.column).number : undefined;
  const issues: string[] = [];
  const entries: ParsedTieredIdentifierList["entries"] = [];
  const seen = new Set<string>();
  const hashValue =
    input.recognition.sourceHash || sourceHash(input.recognition.source);

  for (
    let rowNumber = headerRow + 1;
    rowNumber <= worksheet.rowCount;
    rowNumber += 1
  ) {
    const row = worksheet.getRow(rowNumber);
    if (!row.hasValues) continue;
    const idCell = row.getCell(idColumn);
    const idRaw = cellText(idCell);
    const tierCell = tierColumn ? row.getCell(tierColumn) : undefined;
    const tierRaw = tierCell ? cellText(tierCell) : (input.defaultTier ?? "");
    const location = `${worksheet.name}!${identifier.column}${rowNumber}`;

    if (!idRaw && !tierRaw) continue;
    if (!idRaw) {
      issues.push(`${location} 为空`);
      continue;
    }
    if (isFormula(idCell)) {
      issues.push(`${location} 不能使用公式作为 SKU`);
      continue;
    }
    if (/^[=+@-]/.test(idRaw)) {
      issues.push(`${location} 不能以公式前缀开头`);
      continue;
    }
    if (typeof idCell.value === "number") {
      issues.push(`${location} 是数值格式，无法确认前导零`);
      continue;
    }
    if (MULTIPLE_IDENTIFIER_SEPARATOR.test(idRaw)) {
      issues.push(`${location} 包含多个 SKU 或分隔符`);
      continue;
    }
    if (tier && tierCell && isFormula(tierCell)) {
      issues.push(
        `${worksheet.name}!${tier.column}${rowNumber} 不能使用公式作为券档`,
      );
      continue;
    }
    const resolvedTier = tierName(tierRaw);
    if (!resolvedTier) {
      issues.push(
        `${tier ? `${worksheet.name}!${tier.column}${rowNumber}` : location} 不是已登记的券档：${tierRaw || "（空）"}`,
      );
      continue;
    }
    if (seen.has(idRaw)) {
      issues.push(`${location} 与前序 SKU 重复：${idRaw}`);
      continue;
    }
    seen.add(idRaw);
    entries.push({
      id: idRaw,
      tier: resolvedTier,
      provenance: provenance({
        source: input.recognition.source,
        sourceHash: hashValue,
        worksheet,
        row: rowNumber,
        column: identifier.column,
        rawValue: idRaw,
        normalizedValue: idRaw,
      }),
    });
  }

  if (!entries.length && !issues.length) {
    issues.push(`${worksheet.name} 未发现任何名单数据`);
  }
  return {
    role: input.role,
    sourceHash: hashValue,
    dimension: identifier.dimension,
    entries,
    issues,
  };
}

export interface ParseSingleCouponIdentifierListInput {
  recognition: WorkbookRecognition;
  role: "whitelist" | "blacklist";
  confirmedCouponName: string;
  identifierCandidateId?: string;
  selectedSheetName?: string;
}

/**
 * Reads exactly one identifier column from exactly one owner-confirmed Sheet.
 * The Sheet name is never treated as the coupon fact source.
 */
export async function parseSingleCouponIdentifierList(
  input: ParseSingleCouponIdentifierListInput,
): Promise<ParsedSingleCouponIdentifierList> {
  const identifier = candidateById(
    input.recognition.listCandidates,
    input.identifierCandidateId,
    "identifier",
  );
  if (
    input.selectedSheetName &&
    identifier.sheetName !== input.selectedSheetName
  ) {
    throw new Error("已选择的名单列不属于业务员确认的 Sheet");
  }
  if (identifier.dimension !== "SKU") {
    throw new Error(`当前 P0 只支持 SKU 名单，不支持 ${identifier.dimension}`);
  }
  const confirmedCouponName = input.confirmedCouponName.trim();
  if (!confirmedCouponName) throw new Error("必须先确认唯一优惠券名称");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(input.recognition.source.bytes) as never,
  );
  const worksheet = workbook.getWorksheet(identifier.sheetName);
  if (!worksheet) throw new Error("找不到已确认的名单 Sheet");
  const idColumn = worksheet.getColumn(identifier.column).number;
  const issues: string[] = [];
  const entries: ParsedSingleCouponIdentifierList["entries"] = [];
  const seen = new Set<string>();
  const hashValue =
    input.recognition.sourceHash || sourceHash(input.recognition.source);

  for (
    let rowNumber = identifier.headerRow + 1;
    rowNumber <= worksheet.rowCount;
    rowNumber += 1
  ) {
    const row = worksheet.getRow(rowNumber);
    if (!row.hasValues) continue;
    const cell = row.getCell(idColumn);
    const raw = cellText(cell);
    const location = `${worksheet.name}!${identifier.column}${rowNumber}`;
    if (!raw) continue;
    if (isFormula(cell)) {
      issues.push(`${location} 不能使用公式作为 SKU`);
      continue;
    }
    if (/^[=+@-]/.test(raw)) {
      issues.push(`${location} 不能以公式前缀开头`);
      continue;
    }
    if (typeof cell.value === "number") {
      issues.push(`${location} 是数值格式，无法确认前导零`);
      continue;
    }
    if (MULTIPLE_IDENTIFIER_SEPARATOR.test(raw)) {
      issues.push(`${location} 包含多个 SKU 或分隔符`);
      continue;
    }
    if (seen.has(raw)) {
      issues.push(`${location} 与前序 SKU 重复：${raw}`);
      continue;
    }
    seen.add(raw);
    entries.push({
      id: raw,
      provenance: provenance({
        source: input.recognition.source,
        sourceHash: hashValue,
        worksheet,
        row: rowNumber,
        column: identifier.column,
        rawValue: raw,
        normalizedValue: raw,
      }),
    });
  }
  if (!entries.length && !issues.length) {
    issues.push(`${worksheet.name} 未发现任何名单数据`);
  }
  return {
    role: input.role,
    sourceHash: hashValue,
    dimension: identifier.dimension,
    selectedSheetName: worksheet.name,
    selectedColumn: identifier.column,
    confirmedCouponName,
    entries,
    issues,
  };
}

export function groupIdentifiersByTier(
  list: ParsedTieredIdentifierList,
): Record<MultiTierSkuSheetName, string[]> {
  if (list.dimension !== "SKU") {
    throw new Error(`标准 SKU 附件不支持 ${list.dimension} 维度`);
  }
  if (list.issues.length) {
    throw new Error(
      `${list.role} 存在未解决的数据问题：${list.issues.join("；")}`,
    );
  }
  const result = multiTierSkuSheetNames.reduce(
    (tiers, tier) => {
      tiers[tier] = [];
      return tiers;
    },
    {} as Record<MultiTierSkuSheetName, string[]>,
  );
  for (const entry of list.entries) result[entry.tier].push(entry.id);
  return result;
}

export function computeOverlap(
  whitelist: ParsedTieredIdentifierList,
  blacklist: ParsedTieredIdentifierList | undefined,
): OverlapSnapshot {
  if (!blacklist) {
    return {
      ids: [],
      sha256: hash(`${threeSourceRuleVersion}:no-blacklist`),
    };
  }
  if (whitelist.dimension !== blacklist.dimension) {
    throw new Error(
      `白黑名单 ID 维度不一致：${whitelist.dimension} 与 ${blacklist.dimension}`,
    );
  }
  const blacklistIds = new Set(blacklist.entries.map((entry) => entry.id));
  const ids = [...new Set(whitelist.entries.map((entry) => entry.id))]
    .filter((id) => blacklistIds.has(id))
    .sort((left, right) => left.localeCompare(right, "en"));
  return {
    ids,
    sha256: hash(`${threeSourceRuleVersion}:${JSON.stringify(ids)}`),
  };
}

export function applyOverlapDecision(input: {
  whitelist: ParsedTieredIdentifierList;
  blacklist?: ParsedTieredIdentifierList;
  decision?: OverlapDecision;
}): {
  whitelist: ParsedTieredIdentifierList;
  blacklist?: ParsedTieredIdentifierList;
  overlap: OverlapSnapshot;
} {
  const overlap = computeOverlap(input.whitelist, input.blacklist);
  if (!overlap.ids.length) {
    return { whitelist: input.whitelist, blacklist: input.blacklist, overlap };
  }
  if (!input.decision) {
    throw new Error("白黑名单存在重叠 SKU，必须由业务员选择处理方式");
  }
  if (input.decision === "source_replacement_required") {
    throw new Error("业务员要求返回修改源文件，不能生成标准附件");
  }
  const overlapIds = new Set(overlap.ids);
  const whitelist =
    input.decision === "blacklist_wins"
      ? {
          ...input.whitelist,
          entries: input.whitelist.entries.filter(
            (entry) => !overlapIds.has(entry.id),
          ),
        }
      : input.whitelist;
  const blacklist =
    input.blacklist && input.decision === "whitelist_wins"
      ? {
          ...input.blacklist,
          entries: input.blacklist.entries.filter(
            (entry) => !overlapIds.has(entry.id),
          ),
        }
      : input.blacklist;
  return {
    whitelist,
    blacklist,
    overlap: { ...overlap, decision: input.decision },
  };
}
