import { createHash } from "node:crypto";
import ExcelJS from "exceljs";

const xlsxMimeType =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const maximumRowsPerSheet = 3_000;

export type DynamicListDimension = "SKU" | "MERCHANT_ID";

const listHeaderByDimension: Record<DynamicListDimension, string> = {
  SKU: "sku",
  MERCHANT_ID: "商家id",
};

const listPrefixByRoleAndDimension: Record<
  "whitelist" | "blacklist",
  Record<DynamicListDimension, string>
> = {
  whitelist: { SKU: "商品明细白名单", MERCHANT_ID: "商家ID白名单" },
  blacklist: { SKU: "商品明细黑名单", MERCHANT_ID: "商家ID黑名单" },
};

export interface DynamicSkuListWorkbook {
  bytes: Uint8Array;
  mimeType: typeof xlsxMimeType;
  fileName: string;
  sha256: string;
  rowCount: number;
  rowsBySheet: Record<string, number>;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertSheetName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 31 || /[\\/*?:[\]]/u.test(name)) {
    throw new Error(`名单 Sheet 名称不合法：${name || "（空）"}`);
  }
  return name;
}

function assertRows(tiers: Record<string, readonly string[]>): Array<{
  name: string;
  ids: string[];
}> {
  const sheets: Array<{ name: string; ids: string[] }> = [];
  const names = new Set<string>();
  for (const [rawName, values] of Object.entries(tiers)) {
    const name = assertSheetName(rawName);
    const normalizedName = name.toLocaleLowerCase("zh-CN");
    if (names.has(normalizedName))
      throw new Error(`名单 Sheet 名称重复：${name}`);
    names.add(normalizedName);
    if (values.length > maximumRowsPerSheet) {
      throw new Error(`${name} 超过名单最大行数`);
    }
    const idsInSheet = new Set<string>();
    const rows = values.map((value) => {
      const id = value.trim();
      if (!id || /^[=+@-]/u.test(id) || /[\s,，、;；\n]/u.test(id)) {
        throw new Error(`${name} 的名单 ID 必须是一格一个的安全文本`);
      }
      if (idsInSheet.has(id))
        throw new Error(`${name} 内存在重复名单 ID：${id}`);
      idsInSheet.add(id);
      return id;
    });
    sheets.push({ name, ids: rows });
  }
  if (!sheets.length) throw new Error("名单至少需要一个 Sheet");
  return sheets;
}

export async function verifyDynamicSkuListWorkbook(input: {
  bytes: Uint8Array;
  expectedTiers: Record<string, readonly string[]>;
  dimension?: DynamicListDimension;
}): Promise<void> {
  const dimension = input.dimension ?? "SKU";
  const header = listHeaderByDimension[dimension];
  const expected = assertRows(input.expectedTiers);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(input.bytes) as never);
  expectEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    expected.map((sheet) => sheet.name),
    "生成的名单 Sheet 顺序或名称不匹配",
  );
  for (const expectedSheet of expected) {
    const sheet = workbook.getWorksheet(expectedSheet.name);
    if (!sheet) throw new Error(`生成的名单缺少 Sheet：${expectedSheet.name}`);
    if (sheet.getCell("A1").text !== header) {
      throw new Error(`${expectedSheet.name} 的 A1 必须为 ${header}`);
    }
    const actual: string[] = [];
    for (let row = 2; row <= sheet.rowCount; row += 1) {
      const cell = sheet.getRow(row).getCell(1);
      if (!cell.text.trim()) continue;
      if (typeof cell.value !== "string" || cell.numFmt !== "@") {
        throw new Error(`${expectedSheet.name}!A${row} 必须是文本名单 ID`);
      }
      actual.push(cell.value);
      for (let column = 2; column <= sheet.columnCount; column += 1) {
        if (sheet.getRow(row).getCell(column).text.trim()) {
          throw new Error(`${expectedSheet.name} 只能包含 ${header} 一列`);
        }
      }
    }
    expectEqual(
      actual,
      expectedSheet.ids,
      `${expectedSheet.name} 的名单 ID 不匹配`,
    );
  }
}

function expectEqual(left: unknown, right: unknown, message: string): void {
  if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error(message);
}

export async function generateDynamicSkuListWorkbook(input: {
  tiers: Record<string, readonly string[]>;
  activityName: string;
  revision: number;
  role: "whitelist" | "blacklist";
  dimension?: DynamicListDimension;
}): Promise<DynamicSkuListWorkbook> {
  const dimension = input.dimension ?? "SKU";
  const header = listHeaderByDimension[dimension];
  const expected = assertRows(input.tiers);
  const workbook = new ExcelJS.Workbook();
  for (const { name, ids } of expected) {
    const sheet = workbook.addWorksheet(name);
    sheet.getCell("A1").value = header;
    sheet.getCell("A1").font = { bold: true };
    sheet.getColumn(1).width = 24;
    ids.forEach((id, index) => {
      const cell = sheet.getRow(index + 2).getCell(1);
      cell.value = id;
      cell.numFmt = "@";
    });
  }
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  await verifyDynamicSkuListWorkbook({
    bytes,
    expectedTiers: input.tiers,
    dimension,
  });
  const prefix = listPrefixByRoleAndDimension[input.role][dimension];
  const safeActivityName = input.activityName.replace(/[\\/:*?"<>|]/gu, "-");
  return {
    bytes,
    mimeType: xlsxMimeType,
    fileName: `${prefix}_${safeActivityName}_v${input.revision}.xlsx`,
    sha256: sha256(bytes),
    rowCount: expected.reduce((total, sheet) => total + sheet.ids.length, 0),
    rowsBySheet: Object.fromEntries(
      expected.map((sheet) => [sheet.name, sheet.ids.length]),
    ),
  };
}
