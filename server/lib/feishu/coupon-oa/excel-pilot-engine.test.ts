import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  generateRegularFullReductionWorkbook,
  generateSkuWhitelistWorkbook,
  inspectSkuWhitelistSource,
  parseSkuWhitelistSource,
  verifyRegularFullReductionWorkbook,
} from "../../excel-template-engine";
import {
  computeCouponPilotValues,
  couponPilotInputSchema,
} from "./excel-pilot-schema";

const couponTemplatePath =
  "docs/oa-ticket-reimbursement-materials/assets/templates/配券信息表-常规满减券.xlsx";
const whitelistTemplatePath =
  "docs/oa-ticket-reimbursement-materials/test-fixtures/coupon-oa-route-verification/商品明细白名单-自动填报演练.xlsx";

const input = couponPilotInputSchema.parse({
  activityName: "内网试点满减活动",
  activityBackground: "验证常规满减券自动生成",
  businessMode: "寄卖",
  applicantName: "测试业务员",
  activityStartAt: "2030-01-01",
  activityEndAt: "2030-01-02",
  channels: ["JD", "PAIPAI"],
  thresholdYuan: 100,
  discountAmountYuan: 5,
  totalQuantity: 1000,
  grantQuantityPerClaim: 1,
  dailyClaimLimit: 500,
  claimWindow: "2030-01-01 00:00 至 2030-01-02 23:59",
  useWindow: "2030-01-01 00:00 至 2030-01-02 23:59",
  expectedClaimRate: 0.2,
  expectedUseRate: 0.1,
  platformBearingRatio: 0.5,
  estimatedGmvYuan: 10000,
  claimRule: "活动期间仅可领一次",
  allowGift: "允许",
  promotionMode: "公开自动推广",
  publicPromotionChannels: ["领券中心"],
  overDeduction: "否",
});

async function invalidSkuSourceBytes(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("source");
  worksheet.getCell("A1").value = "SKUID";
  worksheet.getCell("B1").value = "备注";
  worksheet.getCell("A2").value = "SKU-001";
  worksheet.getCell("A3").value = { formula: '"SKU-002"', result: "SKU-002" };
  worksheet.getCell("A4").value = 12345;
  worksheet.getCell("A5").value = "SKU-003 SKU-004";
  worksheet.getCell("A6").value = "SKU-001";
  worksheet.getCell("B7").value = "SKU 缺失";
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe("coupon Excel template engine", () => {
  it("generates one workbook row for every canonical channel", async () => {
    const generated = await generateRegularFullReductionWorkbook({
      templateBytes: new Uint8Array(await readFile(couponTemplatePath)),
      data: input,
      computed: computeCouponPilotValues(input),
      revision: 3,
    });

    expect(generated.rowCount).toBe(2);
    expect(generated.fileName).toContain("v3.xlsx");
    expect(generated.sha256).toHaveLength(64);
    await expect(
      verifyRegularFullReductionWorkbook(generated.bytes, 2),
    ).resolves.toBeUndefined();
  });

  it("inspects and normalizes the SKU whitelist fixture", async () => {
    const bytes = new Uint8Array(await readFile(whitelistTemplatePath));
    const inspection = await inspectSkuWhitelistSource(bytes);
    expect(inspection.candidates).toContainEqual(
      expect.objectContaining({
        sheetName: "100减1",
        column: "A",
        header: "SKUID",
      }),
    );

    const parsed = await parseSkuWhitelistSource({
      bytes,
      sheetName: "100减1",
      column: "A",
    });
    expect(parsed.issues).toEqual([]);
    expect(parsed.skus).toHaveLength(2);

    const generated = await generateSkuWhitelistWorkbook({
      templateBytes: bytes,
      skus: parsed.skus,
      activityName: input.activityName,
      revision: 3,
    });
    const roundTrip = await parseSkuWhitelistSource({
      bytes: generated.bytes,
      sheetName: "100减1",
      column: "A",
    });
    expect(roundTrip.issues).toEqual([]);
    expect(roundTrip.skus).toEqual(parsed.skus);
  });

  it("rejects formulas, numeric values, blanks, duplicates, and multi-SKU cells", async () => {
    const parsed = await parseSkuWhitelistSource({
      bytes: await invalidSkuSourceBytes(),
      sheetName: "source",
      column: "A",
    });

    expect(parsed.skus).toEqual(["SKU-001"]);
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        "source!A3 不能使用公式作为 SKU",
        "source!A4 是数值格式，无法确认前导零",
        "source!A5 包含多个 SKU 或分隔符",
        "source!A6 与前序 SKU 重复：SKU-001",
        "source!A7 为空",
      ]),
    );
  });
});
