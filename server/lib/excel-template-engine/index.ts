import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import type {
  CouponPilotChannel,
  CouponPilotComputedValues,
  CouponPilotInput,
} from "~/lib/feishu/coupon-oa/excel-pilot-schema";
import {
  regularFullReductionManifest,
  skuWhitelistPilotManifest,
} from "./template-manifests";

const xlsxMimeType =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface GeneratedWorkbook {
  bytes: Uint8Array;
  mimeType: typeof xlsxMimeType;
  fileName: string;
  sha256: string;
  rowCount: number;
}

export interface WhitelistColumnCandidate {
  sheetName: string;
  column: string;
  header: string;
  nonEmptyCount: number;
  sampleValues: string[];
}

export interface WhitelistSourceInspection {
  sheets: Array<{ name: string; rowCount: number }>;
  candidates: WhitelistColumnCandidate[];
}

export interface ParsedSkuList {
  skus: string[];
  issues: string[];
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function xlsxBytes(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

function safeText(value: string): string {
  const text = value.trim();
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function columnName(index: number): string {
  let output = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    current = Math.floor((current - 1) / 26);
  }
  return output;
}

function copyCellStyle(source: ExcelJS.Cell, target: ExcelJS.Cell): void {
  target.style = structuredClone(source.style);
  target.dataValidation = structuredClone(source.dataValidation);
  target.protection = structuredClone(source.protection);
}

function copyBlueprintRow(
  worksheet: ExcelJS.Worksheet,
  sourceRowNumber: number,
  targetRowNumber: number,
): void {
  const sourceRow = worksheet.getRow(sourceRowNumber);
  const targetRow = worksheet.getRow(targetRowNumber);
  targetRow.height = sourceRow.height;
  for (let column = 1; column <= sourceRow.cellCount; column += 1) {
    copyCellStyle(sourceRow.getCell(column), targetRow.getCell(column));
  }
}

function channelLabel(channel: CouponPilotChannel): string {
  return channel === "JD" ? "京东商城" : "拍拍二手";
}

function setFormula(
  cell: ExcelJS.Cell,
  formula: string,
  result: string | number,
): void {
  cell.value = { formula, result };
}

function setCouponRow(
  worksheet: ExcelJS.Worksheet,
  rowNumber: number,
  input: CouponPilotInput,
  computed: CouponPilotComputedValues,
  channel: CouponPilotChannel,
): void {
  const row = worksheet.getRow(rowNumber);
  const setText = (column: string, value: string) => {
    row.getCell(column).value = safeText(value);
  };
  const setNumber = (column: string, value: number) => {
    row.getCell(column).value = value;
  };

  for (const column of regularFullReductionManifest.futureBackfillColumns) {
    row.getCell(column).value = null;
  }

  setText("F", channelLabel(channel));
  setText("G", input.applicantName);
  setText("H", input.claimWindow);
  setText("I", input.useWindow);
  setText("K", input.activityName);
  setNumber("L", input.totalQuantity);
  setNumber("M", input.grantQuantityPerClaim);
  setNumber("N", input.dailyClaimLimit);
  setNumber("O", input.discountAmountYuan);
  setNumber("P", input.thresholdYuan);
  setNumber("R", input.expectedClaimRate);
  setNumber("S", input.expectedUseRate);
  setNumber("T", input.platformBearingRatio);
  setNumber("W", input.estimatedGmvYuan);
  setText("X", input.couponType);
  setText("Y", input.productLimitType);
  setText("Z", input.claimRiskControl);
  setText("AA", input.claimRule);
  setText("AB", input.allowGift);
  setText("AC", input.promotionMode);
  setText("AD", input.publicPromotionChannels.join("、"));

  setFormula(
    row.getCell("J"),
    `"满"&P${rowNumber}&"减"&O${rowNumber}`,
    computed.couponName,
  );
  setFormula(
    row.getCell("Q"),
    `O${rowNumber}/P${rowNumber}`,
    computed.discountRatio,
  );
  setFormula(
    row.getCell("V"),
    `L${rowNumber}*O${rowNumber}*S${rowNumber}*T${rowNumber}`,
    computed.estimatedCostYuan,
  );
  setFormula(
    row.getCell("U"),
    `W${rowNumber}/V${rowNumber}`,
    computed.estimatedRoi,
  );
  row.commit();
}

function removeInstructionRows(worksheet: ExcelJS.Worksheet): void {
  worksheet.spliceRows(3, 3);
}

export async function generateRegularFullReductionWorkbook(input: {
  templateBytes: Uint8Array;
  data: CouponPilotInput;
  computed: CouponPilotComputedValues;
  revision: number;
}): Promise<GeneratedWorkbook> {
  return generateRegularFullReductionWorkbookSet({
    templateBytes: input.templateBytes,
    tiers: [{ data: input.data, computed: input.computed }],
    revision: input.revision,
  });
}

export async function generateRegularFullReductionWorkbookSet(input: {
  templateBytes: Uint8Array;
  tiers: Array<{
    data: CouponPilotInput;
    computed: CouponPilotComputedValues;
  }>;
  revision: number;
}): Promise<GeneratedWorkbook> {
  if (!input.tiers.length) throw new Error("配券表至少需要一个券档");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(input.templateBytes) as never);
  const worksheet = workbook.getWorksheet(
    regularFullReductionManifest.sheetName,
  );
  if (!worksheet) throw new Error("常规满减券模板缺少工作表“满减券”");

  removeInstructionRows(worksheet);
  const rows = input.tiers.flatMap((tier) =>
    tier.data.channels.map((channel) => ({ ...tier, channel })),
  );
  for (let index = 1; index < rows.length; index += 1) {
    const targetRowNumber = 2 + index;
    worksheet.insertRow(targetRowNumber, []);
    copyBlueprintRow(worksheet, 2, targetRowNumber);
  }
  for (const [index, row] of rows.entries()) {
    setCouponRow(worksheet, 2 + index, row.data, row.computed, row.channel);
  }

  const bytes = xlsxBytes(await workbook.xlsx.writeBuffer());
  await verifyRegularFullReductionWorkbook(bytes, rows.length);
  const activitySlug = input.tiers[0].data.activityName.replace(
    /[\\/:*?"<>|]/g,
    "-",
  );
  return {
    bytes,
    mimeType: xlsxMimeType,
    fileName: `配券信息表_${activitySlug}_v${input.revision}.xlsx`,
    sha256: sha256(bytes),
    rowCount: rows.length,
  };
}

export async function verifyRegularFullReductionWorkbook(
  bytes: Uint8Array,
  expectedRows: number,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as never);
  const worksheet = workbook.getWorksheet(
    regularFullReductionManifest.sheetName,
  );
  if (!worksheet) throw new Error("生成的配券表缺少工作表“满减券”");
  if (worksheet.getRow(1).getCell("F").text !== "用券渠道") {
    throw new Error("生成的配券表表头不匹配");
  }
  for (let rowNumber = 2; rowNumber < 2 + expectedRows; rowNumber += 1) {
    for (const column of regularFullReductionManifest.futureBackfillColumns) {
      if (worksheet.getRow(rowNumber).getCell(column).value !== null) {
        throw new Error(
          `生成的配券表第 ${rowNumber} 行回填列 ${column} 必须为空`,
        );
      }
    }
    for (const column of regularFullReductionManifest.formulaColumns) {
      const value = worksheet.getRow(rowNumber).getCell(column).value;
      if (!value || typeof value !== "object" || !("formula" in value)) {
        throw new Error(`生成的配券表第 ${rowNumber} 行缺少公式列 ${column}`);
      }
    }
  }
}

function textFromCell(cell: ExcelJS.Cell): string | undefined {
  if (cell.type === ExcelJS.ValueType.Formula) return undefined;
  if (typeof cell.value === "string") return cell.value.trim() || undefined;
  if (typeof cell.value === "number") return String(cell.value);
  return undefined;
}

export async function inspectSkuWhitelistSource(
  bytes: Uint8Array,
): Promise<WhitelistSourceInspection> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as never);
  const sheets: WhitelistSourceInspection["sheets"] = [];
  const candidates: WhitelistColumnCandidate[] = [];
  for (const worksheet of workbook.worksheets) {
    sheets.push({ name: worksheet.name, rowCount: worksheet.rowCount });
    const header = worksheet.getRow(1);
    for (let index = 1; index <= header.cellCount; index += 1) {
      const headerText = textFromCell(header.getCell(index));
      if (!headerText) continue;
      const values: string[] = [];
      let nonEmptyCount = 0;
      for (let row = 2; row <= worksheet.rowCount; row += 1) {
        const text = textFromCell(worksheet.getRow(row).getCell(index));
        if (!text) continue;
        nonEmptyCount += 1;
        if (values.length < 3) values.push(text);
      }
      if (nonEmptyCount) {
        candidates.push({
          sheetName: worksheet.name,
          column: columnName(index),
          header: headerText,
          nonEmptyCount,
          sampleValues: values,
        });
      }
    }
  }
  return { sheets, candidates };
}

export async function parseSkuWhitelistSource(input: {
  bytes: Uint8Array;
  sheetName: string;
  column: string;
}): Promise<ParsedSkuList> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(input.bytes) as never);
  const worksheet = workbook.getWorksheet(input.sheetName);
  if (!worksheet) throw new Error(`找不到白名单工作表：${input.sheetName}`);
  const columnIndex = worksheet.getColumn(input.column).number;
  const issues: string[] = [];
  const skus: string[] = [];
  const seen = new Set<string>();
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    if (!row.hasValues) continue;
    const cell = row.getCell(columnIndex);
    if (
      cell.value === null ||
      cell.value === undefined ||
      cell.text.trim() === ""
    ) {
      issues.push(`${worksheet.name}!${input.column}${rowNumber} 为空`);
      continue;
    }
    if (cell.type === ExcelJS.ValueType.Formula) {
      issues.push(
        `${worksheet.name}!${input.column}${rowNumber} 不能使用公式作为 SKU`,
      );
      continue;
    }
    if (typeof cell.value === "number") {
      issues.push(
        `${worksheet.name}!${input.column}${rowNumber} 是数值格式，无法确认前导零`,
      );
      continue;
    }
    const sku = String(cell.value).trim();
    if (/[\s,，、;；\n]/.test(sku)) {
      issues.push(
        `${worksheet.name}!${input.column}${rowNumber} 包含多个 SKU 或分隔符`,
      );
      continue;
    }
    if (seen.has(sku)) {
      issues.push(
        `${worksheet.name}!${input.column}${rowNumber} 与前序 SKU 重复：${sku}`,
      );
      continue;
    }
    seen.add(sku);
    skus.push(sku);
  }
  return { skus, issues };
}

export async function generateSkuWhitelistWorkbook(input: {
  templateBytes: Uint8Array;
  skus: string[];
  activityName: string;
  revision: number;
}): Promise<GeneratedWorkbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(input.templateBytes) as never);
  const worksheet = workbook.getWorksheet(skuWhitelistPilotManifest.sheetName);
  if (!worksheet) {
    throw new Error(
      `SKU 白名单模板缺少工作表“${skuWhitelistPilotManifest.sheetName}”`,
    );
  }
  if (
    worksheet.getRow(1).getCell(1).text !== skuWhitelistPilotManifest.header
  ) {
    throw new Error("SKU 白名单模板首列不是 SKUID");
  }
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    worksheet.getRow(rowNumber).values = [];
  }
  for (const [index, sku] of input.skus.entries()) {
    const row = worksheet.getRow(index + 2);
    row.getCell(1).value = safeText(sku);
    row.getCell(1).numFmt = "@";
    row.commit();
  }
  const bytes = xlsxBytes(await workbook.xlsx.writeBuffer());
  const verified = await parseSkuWhitelistSource({
    bytes,
    sheetName: skuWhitelistPilotManifest.sheetName,
    column: "A",
  });
  if (verified.issues.length || verified.skus.length !== input.skus.length) {
    throw new Error(
      `生成的 SKU 白名单校验失败：${verified.issues.join("；")}（${verified.skus.length}/${input.skus.length}）`,
    );
  }
  const activitySlug = input.activityName.replace(/[\\/:*?"<>|]/g, "-");
  return {
    bytes,
    mimeType: xlsxMimeType,
    fileName: `商品明细白名单_${activitySlug}_v${input.revision}.xlsx`,
    sha256: sha256(bytes),
    rowCount: input.skus.length,
  };
}

export * from "./three-source";
