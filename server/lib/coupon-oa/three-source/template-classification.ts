import ExcelJS from "exceljs";
import type {
  CouponTemplateCandidate,
  CouponTemplateKind,
  CouponTemplateResolution,
  CouponTierRowReference,
  OfflineSourceFile,
} from "./types";

const COMMON_HEADERS = [
  "用券渠道",
  "申请人",
  "可领时间",
  "可用时间",
  "活动名称",
  "总申请数量",
] as const;
const FULL_REDUCTION_HEADERS = ["优惠券名称", "面额", "限额"] as const;
const DISCOUNT_HEADERS = [
  "折扣名称",
  "折扣力度",
  "折扣限额",
  "最高减额",
] as const;

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

function columnName(index: number): string {
  let value = index;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function kindFor(input: {
  discount: boolean;
  plus: boolean;
  campaign: boolean;
  redemption: boolean;
}): CouponTemplateKind {
  if (input.redemption) {
    return input.discount ? "redemption_discount" : "redemption_full_reduction";
  }
  if (input.campaign && input.plus) {
    return input.discount
      ? "campaign_plus_discount"
      : "campaign_plus_full_reduction";
  }
  if (input.campaign) {
    return input.discount
      ? "campaign_regular_discount"
      : "campaign_regular_full_reduction";
  }
  if (input.plus) {
    return input.discount ? "plus_discount" : "plus_full_reduction";
  }
  return input.discount ? "regular_discount" : "regular_full_reduction";
}

function fileNameHint(fileName: string): string | undefined {
  const name = fileName.replace(/\.xlsx$/i, "").trim();
  return name || undefined;
}

function tierRows(input: {
  worksheet: ExcelJS.Worksheet;
  headerRow: number;
  columns: Map<string, number>;
  discount: boolean;
}): CouponTierRowReference[] {
  const identifyingHeaders = input.discount
    ? DISCOUNT_HEADERS
    : FULL_REDUCTION_HEADERS;
  const result: CouponTierRowReference[] = [];
  for (
    let rowNumber = input.headerRow + 1;
    rowNumber <= input.worksheet.rowCount;
    rowNumber += 1
  ) {
    const evidenceCells = identifyingHeaders.flatMap((header) => {
      const column = input.columns.get(header);
      if (!column) return [];
      const value = cellText(input.worksheet.getRow(rowNumber).getCell(column));
      return value ? [`${columnName(column)}${rowNumber}`] : [];
    });
    if (evidenceCells.length >= 2) {
      result.push({
        sheetName: input.worksheet.name,
        row: rowNumber,
        evidenceCells,
      });
    }
  }
  return result;
}

export async function classifyCouponTemplate(
  source: OfflineSourceFile,
): Promise<CouponTemplateResolution> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(source.bytes) as never);
  const candidates: CouponTemplateCandidate[] = [];
  const tiersByCandidate = new Map<
    CouponTemplateKind,
    CouponTierRowReference[]
  >();

  for (const worksheet of workbook.worksheets) {
    for (
      let rowNumber = 1;
      rowNumber <= Math.min(worksheet.rowCount, 20);
      rowNumber += 1
    ) {
      const columns = new Map<string, number>();
      const row = worksheet.getRow(rowNumber);
      for (let column = 1; column <= worksheet.columnCount; column += 1) {
        const value = cellText(row.getCell(column));
        if (value) columns.set(value, column);
      }
      const commonCount = COMMON_HEADERS.filter((header) =>
        columns.has(header),
      ).length;
      if (commonCount < 4) continue;
      const fullCount = FULL_REDUCTION_HEADERS.filter((header) =>
        columns.has(header),
      ).length;
      const discountCount = DISCOUNT_HEADERS.filter((header) =>
        columns.has(header),
      ).length;
      const variants: Array<{
        discount: boolean;
        count: number;
        total: number;
      }> = [];
      if (fullCount >= 2) {
        variants.push({
          discount: false,
          count: fullCount,
          total: FULL_REDUCTION_HEADERS.length,
        });
      }
      if (discountCount >= 3) {
        variants.push({
          discount: true,
          count: discountCount,
          total: DISCOUNT_HEADERS.length,
        });
      }
      for (const variant of variants) {
        const templateKind = kindFor({
          discount: variant.discount,
          plus: columns.has("领券用户"),
          campaign: columns.has("特殊业务标签"),
          redemption: columns.has("兑换类型"),
        });
        const identifyingHeaders = variant.discount
          ? DISCOUNT_HEADERS
          : FULL_REDUCTION_HEADERS;
        const evidenceCells = [
          ...COMMON_HEADERS,
          ...identifyingHeaders,
        ].flatMap((header) => {
          const column = columns.get(header);
          return column ? [`${columnName(column)}${rowNumber}`] : [];
        });
        const rows = tierRows({
          worksheet,
          headerRow: rowNumber,
          columns,
          discount: variant.discount,
        });
        candidates.push({
          templateKind,
          score:
            commonCount * 10 +
            Math.round((variant.count / variant.total) * 100),
          supported: templateKind === "regular_full_reduction",
          headerRow: rowNumber,
          sheetName: worksheet.name,
          evidenceCells,
          reasons: [
            `匹配 ${commonCount} 个通用字段和 ${variant.count} 个券型字段`,
          ],
          fileNameHint: fileNameHint(source.fileName),
        });
        tiersByCandidate.set(templateKind, rows);
      }
    }
  }

  const ordered = candidates.sort((left, right) => right.score - left.score);
  if (!ordered.length) {
    return {
      status: "unknown_template",
      candidates: [],
      tierRows: [],
      issues: ["无法根据已登记模板字段识别配券表类型"],
    };
  }
  const bestScore = ordered[0].score;
  const best = ordered.filter((candidate) => candidate.score === bestScore);
  const kinds = [...new Set(best.map((candidate) => candidate.templateKind))];
  if (kinds.length > 1) {
    return {
      status: "ambiguous_template",
      candidates: best,
      tierRows: [],
      issues: ["配券表同时匹配多个不同模板类型，需要业务员确认"],
    };
  }
  const selected = best[0];
  const tierRowsValue = tiersByCandidate.get(selected.templateKind) ?? [];
  return {
    status: selected.supported ? "unique_template" : "unsupported_template",
    templateKind: selected.templateKind,
    candidates: best,
    tierRows: tierRowsValue,
    issues: selected.supported
      ? []
      : ["已识别配券表模板，但当前 P0 尚未开放该模板生成"],
  };
}
