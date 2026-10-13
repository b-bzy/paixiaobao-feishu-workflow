import { createHash } from "node:crypto";
import ExcelJS from "exceljs";

const xlsxContentType =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const oleSignature = Uint8Array.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);

export interface E2eWorkbookRecipe {
  recipe: string;
  variant: number;
}

export interface GeneratedE2eWorkbook {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  sha256: string;
  semanticFingerprint: string;
  recipe: string;
  variant: number;
}

export type GeneratedWorkbookClassification =
  | "xlsx"
  | "empty"
  | "signature_invalid"
  | "legacy_xls"
  | "encrypted_container"
  | "corrupt_ooxml";

function hash(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function roleFrom(recipe: string): "coupon" | "whitelist" | "blacklist" {
  const role = recipe.split(":").at(-1);
  if (role === "coupon" || role === "whitelist" || role === "blacklist") {
    return role;
  }
  throw new Error(`E2E workbook recipe has an invalid role: ${recipe}`);
}

function baseRecipe(recipe: string): string {
  return recipe.slice(0, recipe.lastIndexOf(":"));
}

function specialBytes(input: E2eWorkbookRecipe): Uint8Array | undefined {
  const base = baseRecipe(input.recipe);
  if (base === "zero-byte") return new Uint8Array();
  if (base === "fake-xlsx-signature") {
    return input.variant === 2
      ? bytes(
          "<html><body><table><tr><td>synthetic</td></tr></table></body></html>",
        )
      : bytes("sku\nSYNTHETIC-001\n");
  }
  if (base === "legacy-xls") {
    return new Uint8Array([...oleSignature, ...bytes("SYNTHETIC-LEGACY-XLS")]);
  }
  if (base === "encrypted") {
    return new Uint8Array([
      ...oleSignature,
      ...bytes("EncryptedPackageSYNTHETIC"),
    ]);
  }
  if (base === "missing-workbook-part") {
    return new Uint8Array([
      0x50,
      0x4b,
      0x03,
      0x04,
      ...bytes("SYNTHETIC-NO-WORKBOOK-PART"),
    ]);
  }
  if (base === "oversized") {
    const value = new Uint8Array(10 * 1024 * 1024 + input.variant);
    value.set([0x50, 0x4b, 0x03, 0x04]);
    return value;
  }
  return undefined;
}

function headerRowFor(base: string): number {
  if (base === "header-row-2") return 2;
  if (base === "header-row-10") return 10;
  if (base === "merged-two-level-header") return 2;
  return 1;
}

function couponHeaders(): string[] {
  return [
    "活动名称",
    "活动背景",
    "业务模式",
    "申请人",
    "活动开始日期",
    "活动结束日期",
    "用券渠道",
    "满减门槛",
    "优惠面额",
    "总申请数量",
    "单次发放到账张数",
    "每日领取次数",
    "可领时间",
    "可用时间",
    "预计领用率",
    "预计使用率",
    "拍拍平台承担比例",
    "预计引入GMV",
    "用户领券规则",
    "优惠券赠送",
    "推广途径",
    "公开推广渠道",
    "是否超扣点",
    "超扣点原因",
  ];
}

function addCouponSheet(
  workbook: ExcelJS.Workbook,
  base: string,
  variant: number,
): void {
  const sheet = workbook.addWorksheet(
    base === "arbitrary-sheet-names" ? "秋季档期配置" : "配券表",
  );
  const headerRow = headerRowFor(base);
  if (headerRow > 1) {
    sheet.getCell("A1").value = "合成测试材料，请勿用于真实业务";
  }
  const headers = couponHeaders();
  const row = sheet.getRow(headerRow);
  headers.forEach((header, index) => {
    row.getCell(index + 1).value = header;
  });
  const data = [
    "2026 双十一优惠券申请",
    "双十一期间京东商城及拍拍二手优惠券活动",
    "严选",
    "合成测试提报人",
    "2026-09-30",
    "2026-10-10",
    "京东商城、拍拍二手",
    999,
    60,
    1000,
    1,
    1,
    "2026-09-30 00:00:00 至 2026-10-10 23:59:59",
    "2026-09-30 00:00:00 至 2026-10-10 23:59:59",
    "80%",
    "30%",
    "50%",
    120000,
    "活动期间仅可领一次",
    "不允许",
    "公开自动推广",
    "领券中心",
    "否",
    "",
  ];
  data.forEach((value, index) => {
    sheet.getRow(headerRow + 1).getCell(index + 1).value = value;
  });

  if (base === "invalid-date-order") {
    sheet.getRow(headerRow + 1).getCell(5).value =
      variant === 1 ? "2026-02-30" : "2026-10-10";
    sheet.getRow(headerRow + 1).getCell(6).value =
      variant === 1 ? "2026-03-01" : "2026-09-30";
  }
  if (base === "numeric-boundaries") {
    sheet.getRow(headerRow + 1).getCell(10).value =
      variant === 1
        ? null
        : variant === 2
          ? 0
          : variant === 3
            ? -1
            : Number.MAX_SAFE_INTEGER;
  }
  if (base === "invalid-coupon-rules") {
    if (variant === 1) sheet.getRow(headerRow + 1).getCell(9).value = 999;
    if (variant === 2) sheet.getRow(headerRow + 1).getCell(11).value = 1001;
    if (variant === 3) {
      sheet.getRow(headerRow + 1).getCell(23).value = "是";
      sheet.getRow(headerRow + 1).getCell(24).value = "";
    }
  }
  if (base === "formula-cache") {
    const cell = sheet.getRow(headerRow + 1).getCell(10);
    cell.value =
      variant === 1
        ? { formula: "=500+500" }
        : variant === 2
          ? { formula: "=500+500", result: 1000 }
          : "=500+500";
  }
  if (base === "localized-numbers") {
    sheet.getRow(headerRow + 1).getCell(8).value =
      variant === 1 ? "９９９" : variant === 2 ? "九百九十九" : " 999 ";
  }

  if (base === "missing-activity-name")
    sheet.getRow(headerRow + 1).getCell(1).value = null;
  if (base === "missing-activity-background")
    sheet.getRow(headerRow + 1).getCell(2).value = null;
  if (base === "missing-start-date")
    sheet.getRow(headerRow + 1).getCell(5).value = null;
  if (base === "missing-end-date")
    sheet.getRow(headerRow + 1).getCell(6).value = null;
  if (base === "date-without-year") {
    sheet.getRow(headerRow + 1).getCell(5).value = "9.30";
    sheet.getRow(headerRow + 1).getCell(6).value = "10.10";
  }
  if (base === "cross-year-date") {
    sheet.getRow(headerRow + 1).getCell(5).value = "12.20";
    sheet.getRow(headerRow + 1).getCell(6).value = "1.5";
  }
  if (base === "mixed-date-formats") {
    sheet.getRow(headerRow + 1).getCell(5).value =
      variant === 1
        ? "2026年9月30日"
        : variant === 2
          ? new Date("2026-09-30T00:00:00Z")
          : 46365;
  }
  if (base === "merged-two-level-header") {
    sheet.mergeCells(1, 1, 1, 7);
    sheet.mergeCells(1, 8, 1, 24);
    sheet.getCell(1, 1).value = "活动信息";
    sheet.getCell(1, 8).value = "券档与规则";
  }
  if (base === "vertical-merge") {
    sheet.addRow([...data]);
    sheet.mergeCells(headerRow + 1, 1, headerRow + 2, 1);
  }
  if (base === "repeated-header") {
    sheet.addRow(headers);
    sheet.addRow(data);
  }
  if (base === "hidden-business-data") {
    sheet.getRow(headerRow + 1).hidden = true;
    sheet.getColumn(2).hidden = true;
  }
  if (base === "hidden-cover-sheets") {
    const cover = workbook.addWorksheet("说明");
    cover.state = "hidden";
    cover.getCell("A1").value = "合成说明";
  }
  if (base === "two-tables") {
    sheet.addRow([]);
    sheet.addRow(headers);
    const conflicting = [...data];
    conflicting[0] = "2026 另一场优惠券申请";
    conflicting[4] = "2026-11-01";
    conflicting[5] = "2026-11-11";
    sheet.addRow(conflicting);
  }
  if (base === "formatted-tail") {
    sheet.getCell("AZ5000").numFmt = "@";
  }
  if (base === "ten-tiers-shuffled") {
    sheet.getRow(headerRow + 1).getCell(8).value = 100;
    sheet.getRow(headerRow + 1).getCell(9).value = 1;
    for (let index = 1; index < 10; index += 1) {
      const tier = [...data];
      tier[7] = (index + 1) * 100;
      tier[8] = index + 1;
      sheet.addRow(tier);
    }
  }
  if (base === "cross-sheet-duplicates") {
    sheet.getRow(headerRow + 1).getCell(8).value = 100;
    sheet.getRow(headerRow + 1).getCell(9).value = 1;
    const secondTier = [...data];
    secondTier[7] = 200;
    secondTier[8] = 2;
    sheet.addRow(secondTier);
  }
  if (base === "conflicting-columns") {
    const conflictColumn = headers.length + 1;
    sheet.getRow(headerRow).getCell(conflictColumn).value = "活动开始日期";
    sheet.getRow(headerRow + 1).getCell(conflictColumn).value = "2026-10-01";
  }
}

function sheetCount(base: string, variant: number): number {
  if (base === "dynamic-list-sheets") return [1, 4, 5, 10][variant - 1] ?? 1;
  if (base === "ten-tiers-shuffled") return 10;
  if (base === "extra-list-tier") return 2;
  return base === "cross-sheet-duplicates" ? 2 : 1;
}

function skuColumn(base: string, variant: number): number {
  if (base !== "sku-column-position") return 1;
  return [1, 3, 26][variant - 1] ?? 1;
}

function skuValues(
  base: string,
  variant: number,
  sheetIndex: number,
): Array<string | number> {
  if (base === "leading-zero-sku") return ["001234567890", "000000000007"];
  if (base === "safe-numeric-sku") return [123456789012345, 987654321];
  if (base === "unsafe-numeric-sku") return [12345678901234568];
  if (base === "same-sheet-duplicates")
    return ["SYN-001", "SYN-001", "SYN-002"];
  if (base === "cross-sheet-duplicates")
    return ["CROSS-001", `SHEET-${sheetIndex + 1}`];
  if (base === "scientific-sku")
    return variant === 1 ? ["1.2345E+11"] : [123450000000];
  if (base === "blank-sku-values")
    return ["SYN-001", "", " ", "N/A", "SYN-002"];
  if (base === "multi-value-cell") {
    return [variant === 1 ? "A,B" : variant === 2 ? "A B" : "A\nB"];
  }
  return ["SYN-000001", "SYN-000002", "SYN-000003"];
}

function addListSheets(
  workbook: ExcelJS.Workbook,
  base: string,
  variant: number,
  role: "whitelist" | "blacklist",
): void {
  const count = sheetCount(base, variant);
  for (let sheetIndex = 0; sheetIndex < count; sheetIndex += 1) {
    const name =
      base === "missing-list-tier"
        ? "满2000减20"
        : base === "extra-list-tier"
          ? sheetIndex === 0
            ? "满999减60"
            : "满2000减20"
          : base === "arbitrary-sheet-names" || base === "dynamic-list-sheets"
            ? `业务券档-${sheetIndex + 1}`
            : count > 1
              ? `满${(sheetIndex + 1) * 100}减${sheetIndex + 1}`
              : role === "blacklist"
                ? "商品黑名单"
                : "商品白名单";
    const sheet = workbook.addWorksheet(name);
    const column = skuColumn(base, variant);
    sheet.getRow(1).getCell(column).value = "sku";
    sheet.getRow(1).getCell(column + 1).value = "券档";
    const values = skuValues(base, variant, sheetIndex);
    values.forEach((value, index) => {
      const cell = sheet.getRow(index + 2).getCell(column);
      cell.value = value;
      if (typeof value === "string") cell.numFmt = "@";
      sheet.getRow(index + 2).getCell(column + 1).value = "满999减60";
    });
    if (base === "merged-sku-cells") sheet.mergeCells(2, column, 3, column);
    if (base === "identifier-column-conflict") {
      sheet.getRow(1).getCell(column + 2).value = "spu";
      sheet.getRow(2).getCell(column + 2).value = "SPU-001";
    }
    if (base === "blacklist-states" && role === "blacklist") {
      sheet.getRow(2).getCell(column).value = "=100+1";
      sheet.getRow(3).getCell(column).value = null;
      sheet.getRow(4).getCell(column).value = null;
    }
    if (base === "formula-and-link-sku") {
      sheet.getRow(2).getCell(column).value = {
        formula: '="SYN-001"',
        result: "SYN-001",
      };
      sheet.getRow(3).getCell(column).value =
        '=HYPERLINK("https://example.invalid")';
      sheet.getRow(4).getCell(column).value = {
        text: "SYN-003",
        hyperlink: "https://example.invalid/item",
      };
    }
    if (base === "wide-list") {
      for (let extra = 3; extra <= 30; extra += 1) {
        sheet.getRow(1).getCell(extra).value = `额外字段${extra}`;
        sheet.getRow(2).getCell(extra).value = `合成值${extra}`;
      }
    }
  }
}

async function workbookBytes(input: E2eWorkbookRecipe): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "coupon-three-source-e2e";
  workbook.created = new Date("2026-01-01T00:00:00.000Z");
  workbook.modified = new Date("2026-01-01T00:00:00.000Z");
  workbook.calcProperties.fullCalcOnLoad = false;
  const role = roleFrom(input.recipe);
  const base = baseRecipe(input.recipe);
  if (base === "swapped-source-roles") {
    if (role === "coupon")
      addListSheets(workbook, "standard", input.variant, "whitelist");
    else addCouponSheet(workbook, "standard", input.variant);
  } else if (role === "coupon") addCouponSheet(workbook, base, input.variant);
  else addListSheets(workbook, base, input.variant, role);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function buildE2eWorkbook(
  input: E2eWorkbookRecipe,
): Promise<GeneratedE2eWorkbook> {
  if (!Number.isInteger(input.variant) || input.variant < 1) {
    throw new Error("E2E workbook variant must be a positive integer");
  }
  const role = roleFrom(input.recipe);
  const base = baseRecipe(input.recipe);
  const special = specialBytes(input);
  const value = special ?? (await workbookBytes(input));
  const extension = base === "legacy-xls" ? "xls" : "xlsx";
  const semanticFingerprint = hash(
    JSON.stringify({ recipe: input.recipe, variant: input.variant }),
  );
  return {
    fileName: `${base}-${role}-v${input.variant}.${extension}`,
    contentType:
      extension === "xls" ? "application/vnd.ms-excel" : xlsxContentType,
    bytes: value,
    sha256: hash(value),
    semanticFingerprint,
    recipe: input.recipe,
    variant: input.variant,
  };
}

export async function classifyGeneratedWorkbook(
  workbook: GeneratedE2eWorkbook,
): Promise<GeneratedWorkbookClassification> {
  if (!workbook.bytes.byteLength) return "empty";
  const leading = workbook.bytes.slice(0, 8);
  const isOle = leading.every((value, index) => value === oleSignature[index]);
  if (isOle) {
    return new TextDecoder().decode(workbook.bytes).includes("EncryptedPackage")
      ? "encrypted_container"
      : "legacy_xls";
  }
  if (workbook.bytes[0] !== 0x50 || workbook.bytes[1] !== 0x4b) {
    return "signature_invalid";
  }
  try {
    const parsed = new ExcelJS.Workbook();
    await parsed.xlsx.load(workbook.bytes as unknown as ExcelJS.Buffer);
    return "xlsx";
  } catch {
    return "corrupt_ooxml";
  }
}
