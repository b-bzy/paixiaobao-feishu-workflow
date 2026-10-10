import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseSingleCouponIdentifierList } from "./lists";
import {
  confirmRegularFullReductionCoupon,
  discoverRegularFullReductionCoupons,
  inspectThreeSourceWorkbook,
  resolveCouponType,
} from "./recognition";
import type { OfflineSourceFile } from "./types";

const headers = [
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

function couponRow(name: string, threshold: string, discount: string) {
  return [
    name,
    "测试背景",
    "严选",
    "测试人员",
    "2030-01-01",
    "2030-01-02",
    "拍拍二手",
    threshold,
    discount,
    "1000",
    "1",
    "1",
    "2030-01-01 至 2030-01-02",
    "2030-01-01 至 2030-01-10",
    "80%",
    "30%",
    "50%",
    "120000",
    "活动期间仅可领一次",
    "不允许",
    "公开自动推广",
    "领券中心",
    "否",
    "",
  ];
}

async function couponSource(rows: string[][]): Promise<OfflineSourceFile> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("配券表");
  sheet.getRow(1).values = headers;
  rows.forEach((row, index) => {
    sheet.getRow(index + 2).values = row;
  });
  return {
    fileName: "配券.xlsx",
    bytes: new Uint8Array(await workbook.xlsx.writeBuffer()),
  };
}

describe("single coupon confirmation", () => {
  it("discovers one row and binds confirmation to its stable ID", async () => {
    const recognition = await inspectThreeSourceWorkbook(
      await couponSource([couponRow("活动A", "100", "20")]),
    );
    const candidates = await discoverRegularFullReductionCoupons({
      recognition,
    });
    expect(candidates).toHaveLength(1);
    expect(resolveCouponType({ candidates })).toMatchObject({
      status: "unique",
      couponType: "regular_full_reduction",
    });
    const confirmed = await confirmRegularFullReductionCoupon({
      recognition,
      ownerId: "owner-1",
      revision: 3,
      couponCandidateId: candidates[0].id,
      ownerFieldValues: { activityPointPercent: 6 },
    });
    expect(confirmed.input.activityName).toBe("活动A");
    expect(confirmed.couponCandidateId).toBe(candidates[0].id);
    expect(confirmed.activityPointPercent).toBe(6);
    expect(confirmed.provenance.activityPointPercent).toMatchObject({
      sourceKind: "ownerSupplement",
      ownerId: "owner-1",
      revision: 3,
    });
  });

  it("does not default to the first row when multiple coupons exist", async () => {
    const recognition = await inspectThreeSourceWorkbook(
      await couponSource([
        couponRow("活动A", "100", "20"),
        couponRow("活动B", "200", "30"),
      ]),
    );
    const candidates = await discoverRegularFullReductionCoupons({
      recognition,
    });
    expect(resolveCouponType({ candidates }).status).toBe("multiple_coupons");
    await expect(
      confirmRegularFullReductionCoupon({
        recognition,
        ownerId: "owner-1",
        revision: 1,
        ownerFieldValues: { activityPointPercent: 6 },
      }),
    ).rejects.toThrow("必须明确选择其中一个");

    const selected = await confirmRegularFullReductionCoupon({
      recognition,
      ownerId: "owner-1",
      revision: 1,
      couponCandidateId: candidates[1].id,
      ownerFieldValues: { activityPointPercent: 6 },
    });
    expect(selected.input.activityName).toBe("活动B");
  });

  it("requires owner confirmation for activity point and override reasons", async () => {
    const recognition = await inspectThreeSourceWorkbook(
      await couponSource([couponRow("活动A", "100", "20")]),
    );
    const [candidate] = await discoverRegularFullReductionCoupons({
      recognition,
    });
    await expect(
      confirmRegularFullReductionCoupon({
        recognition,
        ownerId: "owner-1",
        revision: 1,
        couponCandidateId: candidate.id,
      }),
    ).rejects.toThrow("活动点位必须由业务员确认");
    await expect(
      confirmRegularFullReductionCoupon({
        recognition,
        ownerId: "owner-1",
        revision: 1,
        couponCandidateId: candidate.id,
        ownerFieldValues: {
          activityName: "覆盖活动",
          activityPointPercent: 6,
        },
      }),
    ).rejects.toThrow("覆盖来源字段 activityName 时必须填写原因");
  });

  it("allows validated owner supplements for a missing source field", async () => {
    const row = couponRow("活动A", "100", "20");
    row[3] = "";
    const recognition = await inspectThreeSourceWorkbook(
      await couponSource([row]),
    );
    const [candidate] = await discoverRegularFullReductionCoupons({
      recognition,
    });
    const confirmed = await confirmRegularFullReductionCoupon({
      recognition,
      ownerId: "owner-1",
      revision: 2,
      couponCandidateId: candidate.id,
      ownerFieldValues: {
        applicantName: "补充人员",
        activityPointPercent: 6,
      },
    });
    expect(confirmed.input.applicantName).toBe("补充人员");
    expect(confirmed.provenance.applicantName?.sourceKind).toBe(
      "ownerSupplement",
    );
  });
});

describe("single coupon identifier list", () => {
  it("parses exactly the selected Sheet and keeps coupon name as metadata", async () => {
    const workbook = new ExcelJS.Workbook();
    const first = workbook.addWorksheet("任意业务命名");
    first.getRow(1).values = ["sku"];
    first.getCell("A2").value = "00123";
    first.getCell("A2").numFmt = "@";
    const second = workbook.addWorksheet("另一券档");
    second.getRow(1).values = ["sku"];
    second.getCell("A2").value = "00999";
    second.getCell("A2").numFmt = "@";
    const source: OfflineSourceFile = {
      fileName: "白名单.xlsx",
      bytes: new Uint8Array(await workbook.xlsx.writeBuffer()),
    };
    const recognition = await inspectThreeSourceWorkbook(source);
    const candidate = recognition.listCandidates.find(
      (item) => item.sheetName === "任意业务命名",
    );
    const parsed = await parseSingleCouponIdentifierList({
      recognition,
      role: "whitelist",
      confirmedCouponName: "满100减20",
      identifierCandidateId: candidate?.id,
      selectedSheetName: "任意业务命名",
    });
    expect(parsed.confirmedCouponName).toBe("满100减20");
    expect(parsed.selectedSheetName).toBe("任意业务命名");
    expect(parsed.entries.map((entry) => entry.id)).toEqual(["00123"]);
  });
});
