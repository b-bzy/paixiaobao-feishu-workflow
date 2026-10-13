import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  generateDynamicSkuListWorkbook,
  verifyDynamicSkuListWorkbook,
} from "./dynamic-sku-list";

describe("dynamic SKU list workbook", () => {
  it("preserves arbitrary Sheet names, order, and text SKU rows", async () => {
    const tiers = {
      "100减1": ["00123", "00124"],
      "2000减20": ["00999"],
      "3000减30": ["01000"],
      "3000减60": ["01001"],
    };
    const result = await generateDynamicSkuListWorkbook({
      tiers,
      activityName: "动态名单测试",
      revision: 3,
      role: "whitelist",
    });

    expect(result.rowsBySheet).toEqual({
      "100减1": 2,
      "2000减20": 1,
      "3000减30": 1,
      "3000减60": 1,
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(result.bytes) as never);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(
      Object.keys(tiers),
    );
    expect(workbook.getWorksheet("100减1")?.getCell("A2").value).toBe("00123");
    expect(workbook.getWorksheet("100减1")?.getCell("A2").numFmt).toBe("@");
    await verifyDynamicSkuListWorkbook({
      bytes: result.bytes,
      expectedTiers: tiers,
    });
  });

  it("rejects duplicate SKU values across Sheets", async () => {
    await expect(
      generateDynamicSkuListWorkbook({
        tiers: { "100减1": ["00123"], "2000减20": ["00123"] },
        activityName: "重复测试",
        revision: 1,
        role: "whitelist",
      }),
    ).rejects.toThrow("SKU 不能同时出现在多个 Sheet");
  });

  it("rejects invalid and duplicate Sheet names", async () => {
    await expect(
      generateDynamicSkuListWorkbook({
        tiers: { "非法/Sheet": ["00123"] },
        activityName: "非法测试",
        revision: 1,
        role: "whitelist",
      }),
    ).rejects.toThrow("Sheet 名称不合法");
    await expect(
      generateDynamicSkuListWorkbook({
        tiers: { Test: ["00123"], test: ["00124"] },
        activityName: "重名测试",
        revision: 1,
        role: "whitelist",
      }),
    ).rejects.toThrow("Sheet 名称重复");
  });
});
