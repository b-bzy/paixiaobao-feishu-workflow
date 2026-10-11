import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { computeRegularFullReductionValues } from "../coupon-oa/calculation";
import { generateRegularFullReductionWorkbookSet } from "./index";

const templatePath = join(
  process.cwd(),
  "docs/oa-ticket-reimbursement-materials/reference/templates/配券信息表-常规满减券.xlsx",
);

function tier(thresholdYuan: number, discountAmountYuan: number) {
  const data = {
    activityName: "多券档活动",
    activityBackground: "测试多券档",
    businessMode: "严选" as const,
    applicantName: "测试人员",
    activityStartAt: "2030-01-01",
    activityEndAt: "2030-01-02",
    channels: ["JD", "PAIPAI"] as Array<"JD" | "PAIPAI">,
    thresholdYuan,
    discountAmountYuan,
    totalQuantity: 100,
    grantQuantityPerClaim: 1,
    dailyClaimLimit: 1,
    claimWindow: "2030-01-01至2030-01-02",
    useWindow: "2030-01-01至2030-01-02",
    expectedClaimRate: 0.5,
    expectedUseRate: 0.5,
    platformBearingRatio: 1,
    estimatedGmvYuan: 10000,
    couponType: "东券" as const,
    productLimitType: "限SKU" as const,
    claimRiskControl: "0级以下用户可领" as const,
    claimRule: "活动期间仅可领一次" as const,
    allowGift: "允许" as const,
    promotionMode: "非公开推广" as const,
    publicPromotionChannels: [] as string[],
    overDeduction: "否" as const,
    overDeductionReason: "",
  };
  return { data, computed: computeRegularFullReductionValues(data) };
}

describe("multi-tier regular full-reduction workbook", () => {
  it("generates one row per tier and channel with row-local formulas", async () => {
    const generated = await generateRegularFullReductionWorkbookSet({
      templateBytes: new Uint8Array(await readFile(templatePath)),
      tiers: [tier(999, 60), tier(1999, 120)],
      revision: 7,
    });

    expect(generated.rowCount).toBe(4);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(generated.bytes) as never);
    const sheet = workbook.getWorksheet("满减券");
    expect(sheet?.getCell("J2").value).toMatchObject({
      formula: expect.any(String),
    });
    expect(sheet?.getCell("J5").value).toMatchObject({
      formula: expect.any(String),
    });
    expect([2, 3, 4, 5].map((row) => sheet?.getCell(`P${row}`).value)).toEqual([
      999, 999, 1999, 1999,
    ]);
    expect([2, 3, 4, 5].map((row) => sheet?.getCell(`F${row}`).text)).toEqual([
      "京东商城",
      "拍拍二手",
      "京东商城",
      "拍拍二手",
    ]);
  });
});
