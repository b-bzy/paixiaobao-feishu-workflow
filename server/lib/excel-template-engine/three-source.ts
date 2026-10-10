import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import type {
  MultiTierSkuListWorkbookManifest,
  MultiTierSkuSheetName,
  SingleCouponSkuListWorkbookManifest,
} from "./template-manifests";

const xlsxMimeType =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface MultiTierSkuListWorkbook {
  bytes: Uint8Array;
  mimeType: typeof xlsxMimeType;
  fileName: string;
  sha256: string;
  rowCount: number;
  rowsByTier: Record<MultiTierSkuSheetName, number>;
}

export interface SingleCouponSkuListWorkbook {
  bytes: Uint8Array;
  mimeType: typeof xlsxMimeType;
  fileName: string;
  sha256: string;
  rowCount: number;
  sheetName: string;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeText(value: string): string {
  const text = value.trim();
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function filenameSlug(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-");
}

function assertTemplateBytes(
  bytes: Uint8Array,
  manifest: MultiTierSkuListWorkbookManifest,
): void {
  if (sha256(bytes) !== manifest.sha256) {
    throw new Error(
      `名单模板 fingerprint 不匹配：${manifest.assetName}，请重新登记模板版本`,
    );
  }
}

function assertTierRows(
  tiers: Partial<Record<MultiTierSkuSheetName, readonly string[]>>,
  manifest: MultiTierSkuListWorkbookManifest,
): Record<MultiTierSkuSheetName, string[]> {
  const rows = {} as Record<MultiTierSkuSheetName, string[]>;
  const known = new Set<string>(manifest.sheets);
  for (const key of Object.keys(tiers)) {
    if (!known.has(key)) {
      throw new Error(`名单包含未登记券档 Sheet：${key}`);
    }
  }

  const seen = new Set<string>();
  for (const tier of manifest.sheets) {
    const ids = [...(tiers[tier] ?? [])];
    if (ids.length > manifest.dataEndRow - manifest.dataStartRow + 1) {
      throw new Error(`${tier} 超过名单模板最大行数`);
    }
    for (const id of ids) {
      if (!id.trim()) throw new Error(`${tier} 包含空 SKU`);
      if (/[\s,，、;；\n]/.test(id)) {
        throw new Error(`${tier} 的 SKU 必须一格一个，不能包含分隔符`);
      }
      if (seen.has(id)) {
        throw new Error(`SKU 不能同时出现在多个券档：${id}`);
      }
      seen.add(id);
    }
    rows[tier] = ids;
  }
  return rows;
}

function nonEmptyIds(
  worksheet: ExcelJS.Worksheet,
  manifest: MultiTierSkuListWorkbookManifest,
): string[] {
  const ids: string[] = [];
  for (
    let rowNumber = manifest.dataStartRow;
    rowNumber <= manifest.dataEndRow;
    rowNumber += 1
  ) {
    const cell = worksheet.getRow(rowNumber).getCell(1);
    if (
      cell.value === null ||
      cell.value === undefined ||
      cell.text.trim() === ""
    ) {
      continue;
    }
    if (cell.type === ExcelJS.ValueType.Formula) {
      throw new Error(`${worksheet.name}!A${rowNumber} 不能使用公式作为 SKU`);
    }
    if (typeof cell.value !== "string") {
      throw new Error(`${worksheet.name}!A${rowNumber} 必须使用文本格式 SKU`);
    }
    ids.push(cell.value);
  }
  return ids;
}

export async function verifyMultiTierSkuListWorkbook(input: {
  bytes: Uint8Array;
  manifest: MultiTierSkuListWorkbookManifest;
  expectedTiers: Partial<Record<MultiTierSkuSheetName, readonly string[]>>;
}): Promise<void> {
  const expected = assertTierRows(input.expectedTiers, input.manifest);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(input.bytes) as never);

  const actualSheetNames = workbook.worksheets.map(
    (worksheet) => worksheet.name,
  );
  if (
    JSON.stringify(actualSheetNames) !== JSON.stringify(input.manifest.sheets)
  ) {
    throw new Error("生成的名单 Sheet 顺序或名称不匹配");
  }

  for (const tier of input.manifest.sheets) {
    const worksheet = workbook.getWorksheet(tier);
    if (!worksheet) throw new Error(`生成的名单缺少 Sheet：${tier}`);
    if (worksheet.getCell("A1").text !== input.manifest.header) {
      throw new Error(`${tier} 的 A1 必须为 ${input.manifest.header}`);
    }
    const actual = nonEmptyIds(worksheet, input.manifest);
    if (JSON.stringify(actual) !== JSON.stringify(expected[tier])) {
      throw new Error(`${tier} 生成的 SKU 与确认数据不一致`);
    }
    for (let index = 0; index < actual.length; index += 1) {
      const cell = worksheet
        .getRow(input.manifest.dataStartRow + index)
        .getCell(1);
      if (cell.numFmt !== "@") {
        throw new Error(`${tier} 的 SKU 必须以文本格式写入`);
      }
    }
  }
}

export async function generateMultiTierSkuListWorkbook(input: {
  templateBytes: Uint8Array;
  manifest: MultiTierSkuListWorkbookManifest;
  tiers: Partial<Record<MultiTierSkuSheetName, readonly string[]>>;
  activityName: string;
  revision: number;
  role: "whitelist" | "blacklist";
}): Promise<MultiTierSkuListWorkbook> {
  assertTemplateBytes(input.templateBytes, input.manifest);
  const expected = assertTierRows(input.tiers, input.manifest);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(input.templateBytes) as never);

  for (const tier of input.manifest.sheets) {
    const worksheet = workbook.getWorksheet(tier);
    if (!worksheet) throw new Error(`名单模板缺少 Sheet：${tier}`);
    if (worksheet.getCell("A1").text !== input.manifest.header) {
      throw new Error(`${tier} 的 A1 必须为 ${input.manifest.header}`);
    }
    for (
      let rowNumber = input.manifest.dataStartRow;
      rowNumber <= input.manifest.dataEndRow;
      rowNumber += 1
    ) {
      const cell = worksheet.getRow(rowNumber).getCell(1);
      cell.value = null;
      cell.numFmt = "@";
    }
    for (const [index, sku] of expected[tier].entries()) {
      const cell = worksheet
        .getRow(input.manifest.dataStartRow + index)
        .getCell(1);
      cell.value = safeText(sku);
      cell.numFmt = "@";
    }
  }

  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  await verifyMultiTierSkuListWorkbook({
    bytes,
    manifest: input.manifest,
    expectedTiers: expected,
  });

  const rowCount = Object.values(expected).reduce(
    (total, ids) => total + ids.length,
    0,
  );
  const prefix =
    input.role === "whitelist" ? "商品明细白名单" : "商品明细黑名单";
  return {
    bytes,
    mimeType: xlsxMimeType,
    fileName: `${prefix}_${filenameSlug(input.activityName)}_v${input.revision}.xlsx`,
    sha256: sha256(bytes),
    rowCount,
    rowsByTier: Object.fromEntries(
      input.manifest.sheets.map((tier) => [tier, expected[tier].length]),
    ) as Record<MultiTierSkuSheetName, number>,
  };
}

function assertSingleSheetName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 31 || /[\\/*?:[\]]/.test(name)) {
    throw new Error(`优惠券名称不能作为 Excel Sheet：${name || "（空）"}`);
  }
  return name;
}

function assertSingleIds(
  ids: readonly string[],
  manifest: SingleCouponSkuListWorkbookManifest,
): string[] {
  if (ids.length > manifest.dataEndRow - manifest.dataStartRow + 1) {
    throw new Error("名单超过模板最大行数");
  }
  const seen = new Set<string>();
  return ids.map((id) => {
    if (!id.trim()) throw new Error("名单包含空 SKU");
    if (/^[=+@-]/.test(id) || /[\s,，、;；\n]/.test(id)) {
      throw new Error(`SKU 必须一格一个且不能使用公式前缀：${id}`);
    }
    if (seen.has(id)) throw new Error(`名单包含重复 SKU：${id}`);
    seen.add(id);
    return id;
  });
}

export async function verifySingleCouponSkuListWorkbook(input: {
  bytes: Uint8Array;
  manifest: SingleCouponSkuListWorkbookManifest;
  expectedSheetName: string;
  expectedIds: readonly string[];
}): Promise<void> {
  const expectedSheetName = assertSingleSheetName(input.expectedSheetName);
  const expectedIds = assertSingleIds(input.expectedIds, input.manifest);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(input.bytes) as never);
  if (
    workbook.worksheets.length !== 1 ||
    workbook.worksheets[0].name !== expectedSheetName
  ) {
    throw new Error("生成的名单必须只包含一个已确认优惠券 Sheet");
  }
  const worksheet = workbook.worksheets[0];
  if (worksheet.getCell("A1").text !== input.manifest.header) {
    throw new Error(`名单 A1 必须为 ${input.manifest.header}`);
  }
  const actual: string[] = [];
  for (
    let rowNumber = input.manifest.dataStartRow;
    rowNumber <= input.manifest.dataEndRow;
    rowNumber += 1
  ) {
    const cell = worksheet.getRow(rowNumber).getCell(1);
    if (cell.value === null || cell.value === undefined || !cell.text.trim()) {
      continue;
    }
    if (
      cell.type === ExcelJS.ValueType.Formula ||
      typeof cell.value !== "string"
    ) {
      throw new Error(`${worksheet.name}!A${rowNumber} 必须为文本 SKU`);
    }
    if (cell.numFmt !== "@") {
      throw new Error(`${worksheet.name}!A${rowNumber} 必须使用文本格式`);
    }
    actual.push(cell.value);
  }
  if (JSON.stringify(actual) !== JSON.stringify(expectedIds)) {
    throw new Error("生成的名单与确认数据顺序或内容不一致");
  }
}

export async function generateSingleCouponSkuListWorkbook(input: {
  templateBytes: Uint8Array;
  manifest: SingleCouponSkuListWorkbookManifest;
  couponName: string;
  ids: readonly string[];
  activityName: string;
  revision: number;
  role: "whitelist" | "blacklist";
}): Promise<SingleCouponSkuListWorkbook> {
  if (sha256(input.templateBytes) !== input.manifest.sha256) {
    throw new Error(
      `名单模板 fingerprint 不匹配：${input.manifest.assetName}，请重新登记模板版本`,
    );
  }
  const sheetName = assertSingleSheetName(input.couponName);
  const ids = assertSingleIds(input.ids, input.manifest);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(input.templateBytes) as never);
  const blueprint = workbook.getWorksheet(input.manifest.blueprintSheet);
  if (!blueprint) {
    throw new Error(`名单模板缺少蓝本 Sheet：${input.manifest.blueprintSheet}`);
  }
  for (const worksheet of [...workbook.worksheets]) {
    if (worksheet.id !== blueprint.id) workbook.removeWorksheet(worksheet.id);
  }
  blueprint.name = sheetName;
  if (blueprint.getCell("A1").text !== input.manifest.header) {
    throw new Error(`蓝本 Sheet 的 A1 必须为 ${input.manifest.header}`);
  }
  for (
    let rowNumber = input.manifest.dataStartRow;
    rowNumber <= input.manifest.dataEndRow;
    rowNumber += 1
  ) {
    const cell = blueprint.getRow(rowNumber).getCell(1);
    cell.value = null;
    cell.numFmt = "@";
  }
  ids.forEach((id, index) => {
    const cell = blueprint
      .getRow(input.manifest.dataStartRow + index)
      .getCell(1);
    cell.value = id;
    cell.numFmt = "@";
  });
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  await verifySingleCouponSkuListWorkbook({
    bytes,
    manifest: input.manifest,
    expectedSheetName: sheetName,
    expectedIds: ids,
  });
  const prefix =
    input.role === "whitelist" ? "商品明细白名单" : "商品明细黑名单";
  return {
    bytes,
    mimeType: xlsxMimeType,
    fileName: `${prefix}_${filenameSlug(input.activityName)}_v${input.revision}.xlsx`,
    sha256: sha256(bytes),
    rowCount: ids.length,
    sheetName,
  };
}
