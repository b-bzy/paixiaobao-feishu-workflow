import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import {
  type MultiTierSkuSheetName,
  multiTierSkuSheetNames,
} from "../../excel-template-engine/template-manifests";
import { selectUniqueListCandidate } from "./recognition";
import type {
  AiSkuRegionCandidate,
  ListColumnCandidate,
  MultiSheetListSelection,
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
const EMPTY_IDENTIFIER_MARKERS = new Set(["n/a", "na", "无", "空", "-"]);

function isEmptyIdentifierMarker(value: string): boolean {
  return EMPTY_IDENTIFIER_MARKERS.has(
    value.normalize("NFKC").trim().toLowerCase(),
  );
}

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

function identifierValue(cell: ExcelJS.Cell): {
  rawValue: string;
  normalizedValue?: string;
  issue?: string;
} {
  let rawValue = cellText(cell);
  if (typeof cell.value !== "number") {
    return { rawValue, normalizedValue: rawValue };
  }
  if (!Number.isSafeInteger(cell.value) || cell.value < 0) {
    return {
      rawValue,
      issue: "是数值格式，但不是可无损转换的非负整数 SKU",
    };
  }
  if (/^0+$/u.test(cell.numFmt)) {
    rawValue = String(cell.value).padStart(cell.numFmt.length, "0");
  }
  if (!/^\d+$/u.test(rawValue)) {
    return {
      rawValue,
      issue: "是数值格式，但显示值不是纯整数 SKU",
    };
  }
  const significantDigits = rawValue.replace(/^0+/u, "") || "0";
  if (
    significantDigits.length > 15 ||
    Number.parseInt(rawValue, 10) !== cell.value
  ) {
    return {
      rawValue,
      issue: "超过 Excel 15 位有效数字，可能已经丢失精度",
    };
  }
  return { rawValue, normalizedValue: rawValue };
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

function columnNumber(column: string): number {
  return [...column].reduce(
    (value, character) => value * 26 + character.charCodeAt(0) - 64,
    0,
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
  identifierDimensionConfirmation?: IdentifierDimensionConfirmation;
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
  const offlineDimension = resolveListDimension({
    detected: identifier.dimension ?? "UNKNOWN",
    headerless: identifier.header === "",
    confirmation: input.identifierDimensionConfirmation,
    sourceHash:
      input.recognition.sourceHash || sourceHash(input.recognition.source),
  });
  if (!offlineDimension) {
    throw new Error(
      `当前离线切片只支持 SKU 或商家 ID 名单，不支持 ${identifier.dimension}，请先确认标识类型`,
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
    const idValue = identifierValue(idCell);
    const idRaw = idValue.rawValue;
    const normalizedId = idValue.normalizedValue;
    const tierCell = tierColumn ? row.getCell(tierColumn) : undefined;
    const tierRaw = tierCell ? cellText(tierCell) : (input.defaultTier ?? "");
    const location = `${worksheet.name}!${identifier.column}${rowNumber}`;

    if (!idRaw || isEmptyIdentifierMarker(idRaw)) continue;
    if (isFormula(idCell)) {
      issues.push(`${location} 不能使用公式作为名单 ID`);
      continue;
    }
    if (/^[=+@-]/.test(idRaw)) {
      issues.push(`${location} 不能以公式前缀开头`);
      continue;
    }
    if (idValue.issue || !normalizedId) {
      issues.push(`${location} ${idValue.issue ?? "不是有效 SKU"}`);
      continue;
    }
    if (MULTIPLE_IDENTIFIER_SEPARATOR.test(idRaw)) {
      issues.push(`${location} 包含多个名单 ID 或分隔符`);
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
    if (seen.has(normalizedId)) {
      continue;
    }
    seen.add(normalizedId);
    entries.push({
      id: normalizedId,
      tier: resolvedTier,
      provenance: provenance({
        source: input.recognition.source,
        sourceHash: hashValue,
        worksheet,
        row: rowNumber,
        column: identifier.column,
        rawValue: idRaw,
        normalizedValue: normalizedId,
      }),
    });
  }

  if (!entries.length && !issues.length) {
    issues.push(`${worksheet.name} 未发现任何名单数据`);
  }
  return {
    role: input.role,
    sourceHash: hashValue,
    dimension: offlineDimension,
    entries,
    issues,
  };
}

export interface IdentifierDimensionConfirmation {
  sourceSha256: string;
  detectedDimension: "SKU" | "SPU" | "MERCHANT_ID" | "UNKNOWN";
  confirmedAs: "SKU" | "MERCHANT_ID";
}

export interface IdentifierDimensionEvidenceColumn {
  dimension: "SKU" | "MERCHANT_ID";
  source: "ai" | "deterministic";
  header: string;
  column?: string;
  sheetName?: string;
  rowCount?: number;
}

export interface IdentifierDimensionEvidence {
  /** 去重后的标识维度集合（只统计受支持的 SKU / 商家 ID）。 */
  dimensions: Array<"SKU" | "MERCHANT_ID">;
  /** 同一来源同时存在 ≥2 种受支持标识维度（如 店铺id+sku 双列）。 */
  multiDimension: boolean;
  columns: IdentifierDimensionEvidenceColumn[];
}

/**
 * bug-fix-6 的唯一判定源：把 AI 区域候选与确定性列候选的标识维度证据取并集。
 * 卡片渲染（要不要出二选一确认）、提交校验（拦不拦）与解析守卫（选路）
 * 三处必须消费同一份探测结果,保证"提交能过 = 生成能过"。
 */
export function detectIdentifierDimensionEvidence(input: {
  listCandidates: ListColumnCandidate[];
  aiRegions?: AiSkuRegionCandidate[];
  role?: "whitelist" | "blacklist";
}): IdentifierDimensionEvidence {
  const columns: IdentifierDimensionEvidenceColumn[] = [];
  for (const candidate of input.listCandidates) {
    if (candidate.kind !== "identifier") continue;
    if (candidate.dimension !== "SKU" && candidate.dimension !== "MERCHANT_ID")
      continue;
    columns.push({
      dimension: candidate.dimension,
      source: "deterministic",
      header: candidate.header,
      column: candidate.column,
      sheetName: candidate.sheetName,
    });
  }
  for (const region of input.aiRegions ?? []) {
    if (input.role && region.role !== input.role) continue;
    if (region.dimension !== "SKU" && region.dimension !== "MERCHANT_ID")
      continue;
    const bounds = region.evidence?.region;
    const startRow = Number(bounds?.startCell?.match(/\d+$/)?.[0]);
    const endRow = Number(bounds?.endCell?.match(/\d+$/)?.[0]);
    columns.push({
      dimension: region.dimension,
      source: "ai",
      header: region.headerCell?.match(/^[A-Z]+/)?.[0] ?? region.headerCell,
      column: region.headerCell?.match(/^[A-Z]+/)?.[0],
      sheetName: region.evidence?.sheetName,
      rowCount:
        Number.isInteger(startRow) &&
        Number.isInteger(endRow) &&
        endRow >= startRow
          ? endRow - startRow + 1
          : undefined,
    });
  }
  const dimensions = [
    ...new Set(columns.map((column) => column.dimension)),
  ] as Array<"SKU" | "MERCHANT_ID">;
  return {
    dimensions,
    multiDimension: dimensions.length >= 2,
    columns,
  };
}

function dimensionLabel(
  dimension: "SKU" | "MERCHANT_ID" | "SPU" | "UNKNOWN",
): string {
  if (dimension === "MERCHANT_ID") return "商家 ID";
  if (dimension === "SPU") return "SPU";
  if (dimension === "UNKNOWN") return "未知";
  return "SKU";
}

/**
 * Resolves the effective parse dimension for one detected dimension: a
 * matching owner confirmation overrides it in either direction (including
 * “按 SKU 使用” overrides); headerless sources always require an explicit
 * confirmation; headed SKU columns pass through without one.
 */
function resolveListDimension(input: {
  detected: string;
  headerless: boolean;
  confirmation: IdentifierDimensionConfirmation | undefined;
  sourceHash: string;
}): "SKU" | "MERCHANT_ID" | undefined {
  const confirmation = input.confirmation;
  if (
    confirmation &&
    confirmation.sourceSha256 === input.sourceHash &&
    (confirmation.detectedDimension === input.detected ||
      confirmation.detectedDimension === "UNKNOWN")
  ) {
    return confirmation.confirmedAs;
  }
  if (input.headerless) return undefined;
  return input.detected === "SKU" || input.detected === "MERCHANT_ID"
    ? input.detected
    : undefined;
}

export async function parseMultiSheetTieredIdentifierList(input: {
  recognition: WorkbookRecognition;
  role: "whitelist" | "blacklist";
  selection?: MultiSheetListSelection;
  aiSkuRegions?: AiSkuRegionCandidate[];
  identifierDimensionConfirmation?: IdentifierDimensionConfirmation;
}): Promise<ParsedTieredIdentifierList> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(input.recognition.source.bytes) as never,
  );
  const sourceHashValue =
    input.recognition.sourceHash || sourceHash(input.recognition.source);
  const entries: ParsedTieredIdentifierList["entries"] = [];
  const issues: string[] = [];
  const seenIdsBySheet = new Map<string, Set<string>>();
  const seenTiers = new Set<string>();
  const sheetOrder: string[] = [];
  const identifierCandidates = input.recognition.listCandidates.filter(
    (candidate) => candidate.kind === "identifier",
  );
  const aiRegions = (input.aiSkuRegions ?? []).filter(
    (candidate) => candidate.role === input.role,
  );
  const aiCoveredSheets = new Set<string>();
  let listDimension: "SKU" | "MERCHANT_ID" | undefined;
  // bug-fix-6：多维度来源（如 店铺id+sku 双列）走“选择式解析”——owner 的
  // 确认是选择而非改写：只采所选维度的列,其余列忽略并记入 notes。选择
  // 模式下不落 resolveListDimension 的改写路径,从结构上杜绝两列混采。
  const evidence = detectIdentifierDimensionEvidence({
    listCandidates: identifierCandidates,
    aiRegions: input.aiSkuRegions,
    role: input.role,
  });
  const dimensionSelection = !evidence.multiDimension
    ? ({ mode: "single" } as const)
    : input.identifierDimensionConfirmation?.sourceSha256 === sourceHashValue
      ? ({
          mode: "selection",
          dimension: input.identifierDimensionConfirmation.confirmedAs,
        } as const)
      : ({ mode: "blocked" } as const);
  if (dimensionSelection.mode === "blocked") {
    return {
      role: input.role,
      sourceHash: sourceHashValue,
      dimension: "UNKNOWN",
      entries: [],
      sheetOrder: [],
      issues: [
        `同一来源同时检测到多种标识列（${evidence.dimensions
          .map(dimensionLabel)
          .join("、")}），请先选择本单使用的标识类型`,
      ],
    };
  }
  const notes: string[] = [];
  const dimensionGate = (detected: string, headerless: boolean) => {
    if (dimensionSelection.mode === "selection") {
      // 到达守卫的区域/候选已按选择过滤；owner 的选择本身就是显式确认,
      // 不再要求 headerless 二次确认,也不会出现维度冲突。
      if (detected !== dimensionSelection.dimension) return undefined;
      listDimension = dimensionSelection.dimension;
      return dimensionSelection.dimension;
    }
    const resolved = resolveListDimension({
      detected,
      headerless,
      confirmation: input.identifierDimensionConfirmation,
      sourceHash: sourceHashValue,
    });
    if (!resolved) {
      issues.push("当前只支持 SKU 或商家 ID 名单，请先确认标识类型");
      return undefined;
    }
    if (listDimension && listDimension !== resolved) {
      issues.push("同一来源解析出不同标识维度，请重新确认标识类型");
      return undefined;
    }
    listDimension = resolved;
    return resolved;
  };

  if (aiRegions.length) {
    for (const region of aiRegions) {
      const worksheet = workbook.getWorksheet(region.evidence.sheetName);
      const bounds = region.evidence.region;
      if (!worksheet || !bounds) {
        issues.push("系统识别的名单区域已失效，请重新上传材料");
        continue;
      }
      if (
        dimensionSelection.mode === "selection" &&
        region.dimension !== dimensionSelection.dimension
      ) {
        const regionColumn = region.headerCell.match(/^[A-Z]+/)?.[0];
        const regionRows = (() => {
          const startRow = Number(bounds.startCell.match(/\d+$/)?.[0]);
          const endRow = Number(bounds.endCell.match(/\d+$/)?.[0]);
          return Number.isInteger(startRow) &&
            Number.isInteger(endRow) &&
            endRow >= startRow
            ? endRow - startRow + 1
            : undefined;
        })();
        const headerText =
          worksheet.getCell(region.headerCell).text.trim() ||
          `${regionColumn ?? "?"} 列`;
        notes.push(
          `已按【${dimensionLabel(dimensionSelection.dimension)}】生成：忽略 ${worksheet.name} 的 ${headerText} 列（${dimensionLabel(region.dimension)}${regionRows ? `，${regionRows} 行` : ""}）`,
        );
        continue;
      }
      // Headerless regions anchor on the first data cell, so headerCell and
      // startCell coincide; they always require an explicit confirmation.
      const headerless = region.headerCell === bounds.startCell;
      if (!dimensionGate(region.dimension, headerless)) {
        continue;
      }
      const headerColumnName = region.headerCell.match(/^[A-Z]+/)?.[0];
      const startColumnName = bounds.startCell.match(/^[A-Z]+/)?.[0];
      const endColumnName = bounds.endCell.match(/^[A-Z]+/)?.[0];
      const startRow = Number(bounds.startCell.match(/\d+$/)?.[0]);
      const endRow = Number(bounds.endCell.match(/\d+$/)?.[0]);
      if (
        !headerColumnName ||
        !startColumnName ||
        !endColumnName ||
        !Number.isInteger(startRow) ||
        !Number.isInteger(endRow)
      ) {
        issues.push(`${worksheet.name} 的名单坐标无法通过服务端校验`);
        continue;
      }
      const headerColumn = columnNumber(headerColumnName);
      const startColumn = columnNumber(startColumnName);
      const endColumn = columnNumber(endColumnName);
      if (
        startRow > endRow ||
        headerColumn < Math.min(startColumn, endColumn) ||
        headerColumn > Math.max(startColumn, endColumn)
      ) {
        issues.push(`${worksheet.name} 的名单区域无法通过服务端校验`);
        continue;
      }
      aiCoveredSheets.add(worksheet.name);
      const resolvedTier = worksheet.name;
      if (!sheetOrder.includes(resolvedTier)) sheetOrder.push(resolvedTier);
      const seenIds = seenIdsBySheet.get(worksheet.name) ?? new Set<string>();
      seenIdsBySheet.set(worksheet.name, seenIds);
      for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
        const cell = worksheet.getRow(rowNumber).getCell(headerColumn);
        const identifier = identifierValue(cell);
        const raw = identifier.rawValue;
        const normalized = identifier.normalizedValue;
        if (!raw || isEmptyIdentifierMarker(raw)) continue;
        const location = `${worksheet.name}!${cell.address}`;
        if (isFormula(cell) || /^[=+@-]/.test(raw)) {
          issues.push(`${location} 不能使用公式作为名单 ID`);
          continue;
        }
        if (identifier.issue || !normalized) {
          issues.push(`${location} ${identifier.issue ?? "不是有效名单 ID"}`);
          continue;
        }
        if (MULTIPLE_IDENTIFIER_SEPARATOR.test(raw)) {
          issues.push(`${location} 包含多个名单 ID 或分隔符`);
          continue;
        }
        if (seenIds.has(normalized)) {
          continue;
        }
        seenIds.add(normalized);
        entries.push({
          id: normalized,
          tier: resolvedTier,
          provenance: provenance({
            source: input.recognition.source,
            sourceHash: sourceHashValue,
            worksheet,
            row: rowNumber,
            column: headerColumnName,
            rawValue: raw,
            normalizedValue: normalized,
          }),
        });
      }
    }
  }

  for (const worksheet of workbook.worksheets) {
    if (aiCoveredSheets.has(worksheet.name)) continue;
    const seenIds = new Set<string>();
    let sheetCandidates = identifierCandidates.filter(
      (candidate) => candidate.sheetName === worksheet.name,
    );
    if (!sheetCandidates.length) continue;
    if (dimensionSelection.mode === "selection") {
      // 选择模式：候选集先按 owner 选定的维度过滤;被过滤掉的受支持维度列
      // （以及整表无匹配的 Sheet）记入 notes,不注册空券档,也避免 sku 优先
      // 的候选挑选逻辑在 MERCHANT_ID 选择下误采错误列。
      const supported = sheetCandidates.filter(
        (candidate) =>
          candidate.dimension === "SKU" ||
          candidate.dimension === "MERCHANT_ID",
      );
      const matching = supported.filter(
        (candidate) => candidate.dimension === dimensionSelection.dimension,
      );
      const skippedHeaders = [
        ...new Set(
          supported
            .filter(
              (candidate) =>
                candidate.dimension !== dimensionSelection.dimension,
            )
            .map(
              (candidate) =>
                `${candidate.header || `${candidate.column} 列`} 列（${dimensionLabel(candidate.dimension ?? "UNKNOWN")}）`,
            ),
        ),
      ];
      if (skippedHeaders.length) {
        notes.push(
          `已按【${dimensionLabel(dimensionSelection.dimension)}】生成：忽略 ${worksheet.name} 的 ${skippedHeaders.join("、")} 列`,
        );
      }
      if (!matching.length) {
        continue;
      }
      sheetCandidates = matching;
    }
    const selected = input.selection?.sheets?.[worksheet.name];
    const resolvedTier = selected?.templateTier?.trim() || worksheet.name;
    if (seenTiers.has(resolvedTier)) {
      issues.push(
        `${worksheet.name} 与其他 Sheet 重复映射券档 ${resolvedTier}`,
      );
      continue;
    }
    seenTiers.add(resolvedTier);
    sheetOrder.push(resolvedTier);
    const skuCandidates = sheetCandidates.filter(
      (candidate) => candidate.dimension === "SKU",
    );
    const identifier = selected?.identifierCandidateId
      ? sheetCandidates.find(
          (candidate) => candidate.id === selected.identifierCandidateId,
        )
      : skuCandidates.length === 1
        ? skuCandidates[0]
        : sheetCandidates.length === 1
          ? sheetCandidates[0]
          : undefined;
    if (!identifier) {
      issues.push(`${worksheet.name} 存在多个 SKU 列候选，需要业务员确认`);
      continue;
    }
    if (
      !dimensionGate(
        identifier.dimension ?? "UNKNOWN",
        identifier.header === "",
      )
    ) {
      continue;
    }
    const column = worksheet.getColumn(identifier.column).number;
    for (
      let rowNumber = identifier.headerRow + 1;
      rowNumber <= worksheet.rowCount;
      rowNumber += 1
    ) {
      const cell = worksheet.getRow(rowNumber).getCell(column);
      const identifierValueResult = identifierValue(cell);
      const raw = identifierValueResult.rawValue;
      const normalized = identifierValueResult.normalizedValue;
      if (!raw || isEmptyIdentifierMarker(raw)) continue;
      const location = `${worksheet.name}!${identifier.column}${rowNumber}`;
      if (isFormula(cell) || /^[=+@-]/.test(raw)) {
        issues.push(`${location} 不能使用公式作为名单 ID`);
        continue;
      }
      if (identifierValueResult.issue || !normalized) {
        issues.push(
          `${location} ${identifierValueResult.issue ?? "不是有效名单 ID"}`,
        );
        continue;
      }
      if (MULTIPLE_IDENTIFIER_SEPARATOR.test(raw)) {
        issues.push(`${location} 包含多个名单 ID 或分隔符`);
        continue;
      }
      if (seenIds.has(normalized)) {
        continue;
      }
      seenIds.add(normalized);
      entries.push({
        id: normalized,
        tier: resolvedTier,
        provenance: provenance({
          source: input.recognition.source,
          sourceHash: sourceHashValue,
          worksheet,
          row: rowNumber,
          column: identifier.column,
          rawValue: raw,
          normalizedValue: normalized,
        }),
      });
    }
  }
  if (!entries.length && !issues.length) {
    issues.push("未发现任何可用名单 Sheet");
  }
  return {
    role: input.role,
    sourceHash: sourceHashValue,
    dimension: listDimension ?? "UNKNOWN",
    entries,
    sheetOrder,
    issues,
    ...(notes.length ? { notes } : {}),
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
  if (identifier.dimension === "MERCHANT_ID") {
    throw new Error("单券路径暂不支持商家 ID 名单");
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
    const parsedIdentifier = identifierValue(cell);
    const raw = parsedIdentifier.rawValue;
    const normalized = parsedIdentifier.normalizedValue;
    const location = `${worksheet.name}!${identifier.column}${rowNumber}`;
    if (!raw || isEmptyIdentifierMarker(raw)) continue;
    if (isFormula(cell)) {
      issues.push(`${location} 不能使用公式作为名单 ID`);
      continue;
    }
    if (/^[=+@-]/.test(raw)) {
      issues.push(`${location} 不能以公式前缀开头`);
      continue;
    }
    if (parsedIdentifier.issue || !normalized) {
      issues.push(`${location} ${parsedIdentifier.issue ?? "不是有效 SKU"}`);
      continue;
    }
    if (MULTIPLE_IDENTIFIER_SEPARATOR.test(raw)) {
      issues.push(`${location} 包含多个名单 ID 或分隔符`);
      continue;
    }
    if (seen.has(normalized)) {
      issues.push(`${location} 与前序 SKU 重复：${normalized}`);
      continue;
    }
    seen.add(normalized);
    entries.push({
      id: normalized,
      provenance: provenance({
        source: input.recognition.source,
        sourceHash: hashValue,
        worksheet,
        row: rowNumber,
        column: identifier.column,
        rawValue: raw,
        normalizedValue: normalized,
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
): Record<string, string[]> {
  if (list.dimension !== "SKU" && list.dimension !== "MERCHANT_ID") {
    throw new Error(
      `标准附件不支持 ${list.dimension} 维度，当前只支持 SKU 或商家 ID 名单`,
    );
  }
  if (list.issues.length) {
    throw new Error(
      `${list.role} 存在未解决的数据问题：${list.issues.join("；")}`,
    );
  }
  const result: Record<string, string[]> = {};
  for (const tier of list.sheetOrder ?? []) result[tier] = [];
  for (const entry of list.entries) {
    result[entry.tier] ??= [];
    result[entry.tier].push(entry.id);
  }
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
