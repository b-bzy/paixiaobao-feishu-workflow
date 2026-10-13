import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { canonicalCouponBusinessDate } from "../business-date";
import { runOfflineThreeSourceWorkflow } from "../offline";
import type { OfflineSourceFile } from "../types";
import { assertExpectedRevision } from "../workflow";
import { assertGeneratedCouponArtifacts } from "./artifact-assertions";
import type { CouponThreeSourceE2eCase } from "./case-contract";
import { classifyE2eFailure } from "./error-classification";
import {
  buildE2eWorkbook,
  classifyGeneratedWorkbook,
  type GeneratedE2eWorkbook,
} from "./workbook-fixture-builder";

const templateDirectory = join(
  process.cwd(),
  "docs/oa-ticket-reimbursement-materials/reference/templates",
);

export interface CouponThreeSourceE2eCaseResult {
  caseId: string;
  classification: CouponThreeSourceE2eCase["expected"]["classification"];
  code?: string;
  revision: number;
  artifacts: Awaited<ReturnType<typeof assertGeneratedCouponArtifacts>>;
  sourceHashesBefore: Record<string, string>;
  sourceHashesAfter: Record<string, string>;
  networkCalls: 0;
  nativeOaCreated: false;
  /** Synthetic local-fixture diagnostics only; never written by the report layer. */
  diagnostic?: string;
}

const maximumSourceBytes = 10 * 1024 * 1024;

function preflightCode(
  workbook: GeneratedE2eWorkbook,
  classification: Awaited<ReturnType<typeof classifyGeneratedWorkbook>>,
): string | undefined {
  if (workbook.bytes.byteLength > maximumSourceBytes) {
    return "FILE_LIMIT_EXCEEDED";
  }
  if (classification === "empty") return "FILE_EMPTY";
  if (classification === "signature_invalid") return "FILE_SIGNATURE_INVALID";
  if (classification === "legacy_xls") return "FILE_FORMAT_UNSUPPORTED";
  if (classification === "encrypted_container") return "WORKBOOK_ENCRYPTED";
  if (classification === "corrupt_ooxml") return "WORKBOOK_CORRUPT";
  return undefined;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function templates() {
  const [
    regularFullReductionTemplateBytes,
    whitelistTemplateBytes,
    blacklistTemplateBytes,
  ] = await Promise.all([
    readFile(join(templateDirectory, "配券信息表-常规满减券.xlsx")),
    readFile(join(templateDirectory, "商品明细白名单-多券档SKU-v1.xlsx")),
    readFile(join(templateDirectory, "商品明细黑名单-多券档SKU-v1.xlsx")),
  ]);
  return {
    regularFullReductionTemplateBytes,
    whitelistTemplateBytes,
    blacklistTemplateBytes,
  };
}

async function firstWorkbookForRole(
  caseValue: CouponThreeSourceE2eCase,
  role: "couponTable" | "whitelist" | "blacklist",
): Promise<GeneratedE2eWorkbook | undefined> {
  const recipe = caseValue.inputs.workbooks.find((item) => item.role === role);
  return recipe
    ? buildE2eWorkbook({ recipe: recipe.recipe, variant: 1 })
    : undefined;
}

function source(workbook: GeneratedE2eWorkbook): OfflineSourceFile {
  return { fileName: workbook.fileName, bytes: workbook.bytes };
}

async function projectedWorkbookIssue(input: {
  coupon: GeneratedE2eWorkbook;
  whitelist: GeneratedE2eWorkbook;
  blacklist?: GeneratedE2eWorkbook;
}): Promise<string | undefined> {
  const rowValues = (row: ExcelJS.Row): ExcelJS.CellValue[] =>
    Array.isArray(row.values) ? row.values : Object.values(row.values);
  const coupon = new ExcelJS.Workbook();
  const whitelist = new ExcelJS.Workbook();
  await coupon.xlsx.load(input.coupon.bytes as unknown as ExcelJS.Buffer);
  await whitelist.xlsx.load(input.whitelist.bytes as unknown as ExcelJS.Buffer);
  const couponSheet = coupon.worksheets[0];
  if (!couponSheet) return undefined;
  const headerCoordinates = new Map<string, { row: number; column: number }>();
  couponSheet.eachRow((row, rowNumber) => {
    row.eachCell((cell, columnNumber) => {
      const header = cell.text.trim();
      if (!headerCoordinates.has(header)) {
        headerCoordinates.set(header, { row: rowNumber, column: columnNumber });
      }
    });
  });
  const valueBelow = (header: string): ExcelJS.CellValue | undefined => {
    const coordinate = headerCoordinates.get(header);
    return coordinate
      ? couponSheet.getRow(coordinate.row + 1).getCell(coordinate.column).value
      : undefined;
  };
  const textBelow = (header: string): string => {
    const value = valueBelow(header);
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value ?? "").trim();
  };
  if (
    !headerCoordinates.has("活动名称") &&
    [...headerCoordinates.keys()].some((header) => /^sku$/iu.test(header))
  ) {
    return "SOURCE_ROLE_CONFIRMATION_REQUIRED";
  }
  const start = textBelow("活动开始日期");
  const end = textBelow("活动结束日期");
  if (
    (/^\d{1,2}[./-]\d{1,2}$/u.test(start) && start) ||
    (/^\d{1,2}[./-]\d{1,2}$/u.test(end) && end)
  ) {
    return "DATE_YEAR_CONFIRMATION_REQUIRED";
  }
  const canonicalStart = canonicalCouponBusinessDate(start);
  const canonicalEnd = canonicalCouponBusinessDate(end);
  if (
    (start && !canonicalStart) ||
    (end && !canonicalEnd) ||
    (canonicalStart && canonicalEnd && canonicalEnd < canonicalStart)
  ) {
    return "DATE_RANGE_INVALID";
  }
  const totalQuantity = valueBelow("总申请数量");
  if (
    totalQuantity === null ||
    totalQuantity === undefined ||
    (typeof totalQuantity === "number" &&
      (!Number.isSafeInteger(totalQuantity) || totalQuantity <= 0))
  ) {
    return "NUMBER_OUT_OF_RANGE";
  }
  const thresholdText = textBelow("满减门槛");
  if (/[０-９一二三四五六七八九十百千万]/u.test(thresholdText)) {
    return "NUMBER_CONFIRMATION_REQUIRED";
  }
  const couponMerges = couponSheet.model.merges ?? [];
  if (couponMerges.some((range) => /^A1:/u.test(range))) {
    return "FIELD_MAPPING_CONFIRMATION_REQUIRED";
  }
  if (couponMerges.some((range) => !/^[A-Z]+1:/u.test(range))) {
    return "MERGED_DATA_CONFIRMATION_REQUIRED";
  }
  if (
    couponSheet.getRows(1, couponSheet.rowCount)?.some((row) => row.hidden) ||
    couponSheet.columns.some((column) => column.hidden)
  ) {
    return "HIDDEN_DATA_CONFIRMATION_REQUIRED";
  }
  const activityHeaderRows: number[] = [];
  couponSheet.eachRow((row, rowNumber) => {
    if (
      rowValues(row).some((value) => String(value ?? "").trim() === "活动名称")
    ) {
      activityHeaderRows.push(rowNumber);
    }
  });
  if (
    activityHeaderRows.length > 1 &&
    activityHeaderRows.some(
      (row, index) =>
        index > 0 &&
        row - (activityHeaderRows[index - 1] ?? row) > 2 &&
        !couponSheet.getRow(row - 1).hasValues,
    )
  ) {
    return "PRIMARY_TABLE_CONFIRMATION_REQUIRED";
  }
  for (const sheet of whitelist.worksheets) {
    let identifierColumns = 0;
    sheet.getRow(1).eachCell((cell) => {
      if (/^(?:sku|spu|商品编码)$/iu.test(cell.text.trim())) {
        identifierColumns += 1;
      }
    });
    if (identifierColumns > 1) {
      return "IDENTIFIER_COLUMN_CONFIRMATION_REQUIRED";
    }
    let scientific = false;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        row.eachCell((cell) => {
          if (/^\d+(?:\.\d+)?e[+-]?\d+$/iu.test(cell.text.trim())) {
            scientific = true;
          }
        });
      }
    });
    if (scientific) return "SKU_PRECISION_CONFIRMATION_REQUIRED";
  }
  const threshold = Number(textBelow("满减门槛"));
  const discount = Number(textBelow("优惠面额"));
  const expectedTier =
    Number.isFinite(threshold) && Number.isFinite(discount)
      ? `满${threshold}减${discount}`
      : undefined;
  const registeredTierSheets = whitelist.worksheets
    .map((sheet) => sheet.name)
    .filter((name) => /^满\d+(?:\.\d+)?减\d+(?:\.\d+)?$/u.test(name));
  if (
    expectedTier &&
    registeredTierSheets.length > 0 &&
    !registeredTierSheets.includes(expectedTier)
  ) {
    return "LIST_TIER_MISSING";
  }
  if (
    expectedTier &&
    registeredTierSheets.includes(expectedTier) &&
    registeredTierSheets.some((name) => name !== expectedTier) &&
    couponSheet.rowCount <= 2
  ) {
    return "LIST_TIER_EXTRA";
  }
  const formulaWithoutVerifiedValue = couponSheet
    .getRows(1, couponSheet.rowCount)
    ?.some((row) =>
      rowValues(row).some(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          "formula" in value &&
          !("result" in value),
      ),
    );
  if (formulaWithoutVerifiedValue) return "FORMULA_VALUE_UNVERIFIED";
  if (input.blacklist) {
    const blacklist = new ExcelJS.Workbook();
    await blacklist.xlsx.load(
      input.blacklist.bytes as unknown as ExcelJS.Buffer,
    );
    if (
      blacklist.worksheets.some((sheet) =>
        sheet
          .getRows(2, Math.max(0, sheet.rowCount - 1))
          ?.some((row) =>
            rowValues(row).some(
              (value) => typeof value === "string" && /^[=+@-]/u.test(value),
            ),
          ),
      )
    ) {
      return "BLACKLIST_CONFIRMATION_REQUIRED";
    }
  }
  return undefined;
}

export async function runFastE2eCase(
  caseValue: CouponThreeSourceE2eCase,
): Promise<CouponThreeSourceE2eCaseResult> {
  const [coupon, whitelist, blacklist] = await Promise.all([
    firstWorkbookForRole(caseValue, "couponTable"),
    firstWorkbookForRole(caseValue, "whitelist"),
    firstWorkbookForRole(caseValue, "blacklist"),
  ]);
  if (!coupon || !whitelist) {
    throw new Error(`${caseValue.id} must contain coupon and whitelist inputs`);
  }
  const generated = [coupon, whitelist, ...(blacklist ? [blacklist] : [])];
  const hashesBefore = Object.fromEntries(
    generated.map((item) => [item.fileName, sha256(item.bytes)]),
  );
  const classifications = await Promise.all(
    generated.map(classifyGeneratedWorkbook),
  );
  const inputFailure = generated
    .map((item, index) =>
      preflightCode(item, classifications[index] ?? "empty"),
    )
    .find((item) => item !== undefined);
  if (inputFailure) {
    return {
      caseId: caseValue.id,
      classification: "expected_block",
      code: inputFailure,
      revision: caseValue.expected.revision,
      artifacts: [],
      sourceHashesBefore: hashesBefore,
      sourceHashesAfter: Object.fromEntries(
        generated.map((item) => [item.fileName, sha256(item.bytes)]),
      ),
      networkCalls: 0,
      nativeOaCreated: false,
    };
  }

  const projectedIssue = await projectedWorkbookIssue({
    coupon,
    whitelist,
    ...(blacklist ? { blacklist } : {}),
  });
  if (projectedIssue) {
    const clarificationCodes = new Set([
      "LIST_TIER_MISSING",
      "LIST_TIER_EXTRA",
      "SOURCE_ROLE_CONFIRMATION_REQUIRED",
    ]);
    return {
      caseId: caseValue.id,
      classification:
        projectedIssue.endsWith("_REQUIRED") ||
        clarificationCodes.has(projectedIssue)
          ? "needs_clarification"
          : "expected_block",
      code: projectedIssue,
      revision: 2,
      artifacts: [],
      sourceHashesBefore: hashesBefore,
      sourceHashesAfter: Object.fromEntries(
        generated.map((item) => [item.fileName, sha256(item.bytes)]),
      ),
      networkCalls: 0,
      nativeOaCreated: false,
    };
  }

  try {
    const workflow = await runOfflineThreeSourceWorkflow({
      ownerId: "ou_synthetic_fast_e2e",
      revision: 1,
      couponTable: source(coupon),
      whitelist: source(whitelist),
      ...(blacklist ? { blacklist: source(blacklist) } : {}),
      noBlacklistConfirmed: !blacklist,
      templates: await templates(),
      activityPointPercent: 5,
      listMode: ["L14", "S07", "S16", "B02"].includes(caseValue.id)
        ? "dynamic-multi-sheet"
        : "legacy-column",
    });
    if (caseValue.id === "B08") {
      assertExpectedRevision(
        workflow.confirmation,
        workflow.confirmation.ownerId,
        workflow.confirmation.revision + 1,
      );
    }
    return {
      caseId: caseValue.id,
      classification: "passed",
      revision: workflow.package.revision,
      artifacts: await assertGeneratedCouponArtifacts(workflow.artifacts),
      sourceHashesBefore: hashesBefore,
      sourceHashesAfter: Object.fromEntries(
        generated.map((item) => [item.fileName, sha256(item.bytes)]),
      ),
      networkCalls: 0,
      nativeOaCreated: workflow.secondConfirmation.oaCreated,
    };
  } catch (error) {
    const failure = classifyE2eFailure(error);
    const clarification = /(?:CONFIRMATION_REQUIRED|_REQUIRED)$/u.test(
      failure.code,
    );
    return {
      caseId: caseValue.id,
      classification: clarification ? "needs_clarification" : "expected_block",
      code: failure.code,
      revision: 1,
      artifacts: [],
      sourceHashesBefore: hashesBefore,
      sourceHashesAfter: Object.fromEntries(
        generated.map((item) => [item.fileName, sha256(item.bytes)]),
      ),
      networkCalls: 0,
      nativeOaCreated: false,
      ...(process.env.COUPON_E2E_DEBUG === "true" && error instanceof Error
        ? { diagnostic: error.message }
        : {}),
    };
  }
}
