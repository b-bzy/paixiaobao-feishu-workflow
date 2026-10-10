import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { classifyCouponTemplate } from "./template-classification";

async function workbook(input: {
  fileName: string;
  headers: string[];
  rows: Array<Array<string | number>>;
}): Promise<{ fileName: string; bytes: Uint8Array }> {
  const value = new ExcelJS.Workbook();
  const sheet = value.addWorksheet(
    input.headers.includes("折扣力度") ? "折扣券" : "满减券",
  );
  sheet.addRow(input.headers);
  for (const row of input.rows) sheet.addRow(row);
  return {
    fileName: input.fileName,
    bytes: new Uint8Array(await value.xlsx.writeBuffer()),
  };
}

const regularHeaders = [
  "用券渠道",
  "申请人",
  "可领时间",
  "可用时间",
  "优惠券名称",
  "活动名称",
  "总申请数量",
  "单次发放到账张数",
  "每日领取次数",
  "面额",
  "限额",
  "优惠比例",
  "预计领用率",
  "预计使用率",
  "拍拍平台承担比例",
  "预估ROI",
  "预计费用",
  "预计引入GMV",
  "优惠券类型",
  "限品类型",
  "领券用户风控",
  "用户领券规则",
  "优惠券赠送",
  "推广途径",
  "公开推广渠道",
];

describe("coupon template classification", () => {
  it("groups different threshold and discount rows under one regular-full-reduction template", async () => {
    const source = await workbook({
      fileName: "活动配券.xlsx",
      headers: regularHeaders,
      rows: [
        ["京东", "业务员", "1月", "1月", "满999减60", "活动", 1, 1, 1, 60, 999],
        ["京东", "业务员", "1月", "1月", "满1999减120", "活动", 1, 1, 1, 120, 1999],
      ],
    });

    const result = await classifyCouponTemplate(source);

    expect(result.status).toBe("unique_template");
    expect(result.templateKind).toBe("regular_full_reduction");
    expect(result.tierRows).toHaveLength(2);
  });

  it("uses structural fingerprint over a misleading file name", async () => {
    const source = await workbook({
      fileName: "常规满减券.xlsx",
      headers: [
        ...regularHeaders.filter((header) => !["优惠券名称", "面额"].includes(header)),
        "折扣名称",
        "折扣力度",
        "折扣限额",
        "最高减额",
      ],
      rows: [["京东", "业务员", "1月", "1月", "活动"]],
    });

    const result = await classifyCouponTemplate(source);

    expect(result.templateKind).toBe("regular_discount");
    expect(result.status).toBe("unsupported_template");
  });

  it("recognizes a plus template as unsupported", async () => {
    const source = await workbook({
      fileName: "PLUS满减券.xlsx",
      headers: ["领券用户", ...regularHeaders],
      rows: [["PLUS会员", "京东", "业务员", "1月", "1月", "满100减10"]],
    });

    const result = await classifyCouponTemplate(source);

    expect(result.templateKind).toBe("plus_full_reduction");
    expect(result.status).toBe("unsupported_template");
  });
});
