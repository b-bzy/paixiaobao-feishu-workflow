import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  singleCouponSkuBlacklistManifest,
  singleCouponSkuWhitelistManifest,
} from "./template-manifests";
import {
  generateSingleCouponSkuListWorkbook,
  verifySingleCouponSkuListWorkbook,
} from "./three-source";

const templatesDirectory = join(
  process.cwd(),
  "docs/oa-ticket-reimbursement-materials/reference/templates",
);

describe("single coupon SKU list generator", () => {
  it("keeps one renamed blueprint Sheet and writes exact text IDs", async () => {
    const templateBytes = new Uint8Array(
      await readFile(
        join(templatesDirectory, singleCouponSkuWhitelistManifest.assetName),
      ),
    );
    const generated = await generateSingleCouponSkuListWorkbook({
      templateBytes,
      manifest: singleCouponSkuWhitelistManifest,
      couponName: "满100减1",
      ids: ["00123", "00999"],
      activityName: "P0测试",
      revision: 2,
      role: "whitelist",
    });
    expect(generated.fileName).toBe("商品明细白名单_P0测试_v2.xlsx");
    expect(generated.rowCount).toBe(2);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(generated.bytes) as never);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "满100减1",
    ]);
    expect(workbook.worksheets[0].getCell("A1").text).toBe("sku");
    expect(workbook.worksheets[0].getCell("A2").value).toBe("00123");
    expect(workbook.worksheets[0].getCell("A2").numFmt).toBe("@");
    await expect(
      verifySingleCouponSkuListWorkbook({
        bytes: generated.bytes,
        manifest: singleCouponSkuWhitelistManifest,
        expectedSheetName: "满100减1",
        expectedIds: ["00123", "00999"],
      }),
    ).resolves.toBeUndefined();
  });

  it("uses the blacklist filename and fails closed on invalid inputs", async () => {
    const templateBytes = new Uint8Array(
      await readFile(
        join(templatesDirectory, singleCouponSkuBlacklistManifest.assetName),
      ),
    );
    const generated = await generateSingleCouponSkuListWorkbook({
      templateBytes,
      manifest: singleCouponSkuBlacklistManifest,
      couponName: "满100减1",
      ids: ["00123"],
      activityName: "P0测试",
      revision: 1,
      role: "blacklist",
    });
    expect(generated.fileName).toBe("商品明细黑名单_P0测试_v1.xlsx");

    await expect(
      generateSingleCouponSkuListWorkbook({
        templateBytes: new Uint8Array([1]),
        manifest: singleCouponSkuWhitelistManifest,
        couponName: "满100减1",
        ids: ["00123"],
        activityName: "P0测试",
        revision: 1,
        role: "whitelist",
      }),
    ).rejects.toThrow("fingerprint 不匹配");
    await expect(
      generateSingleCouponSkuListWorkbook({
        templateBytes,
        manifest: singleCouponSkuBlacklistManifest,
        couponName: "无效/券名",
        ids: ["00123"],
        activityName: "P0测试",
        revision: 1,
        role: "blacklist",
      }),
    ).rejects.toThrow("不能作为 Excel Sheet");
    await expect(
      generateSingleCouponSkuListWorkbook({
        templateBytes,
        manifest: singleCouponSkuBlacklistManifest,
        couponName: "满100减1",
        ids: ["=1+1"],
        activityName: "P0测试",
        revision: 1,
        role: "blacklist",
      }),
    ).rejects.toThrow("不能使用公式前缀");
  });
});
