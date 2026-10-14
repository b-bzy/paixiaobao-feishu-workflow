import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  parseMultiSheetTieredIdentifierList,
  parseSingleCouponIdentifierList,
} from "./lists";
import {
  confirmRegularFullReductionCoupon,
  confirmRegularFullReductionCouponSet,
  discoverRegularFullReductionCoupons,
  inspectThreeSourceWorkbook,
  resolveAiPrimaryRecognition,
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
  it("uses validated AI candidates first and rules only for missing rows", async () => {
    const recognition = await inspectThreeSourceWorkbook(
      await couponSource([
        couponRow("活动A", "100", "20"),
        couponRow("活动B", "200", "30"),
      ]),
    );
    const projection = await resolveAiPrimaryRecognition({
      recognition,
      aiRecognition: {
        sourceHash: recognition.sourceHash,
        roleCandidates: [],
        couponCandidates: [
          {
            id: "ai-row-2",
            couponType: "regular_full_reduction",
            displayName: "AI识别活动A",
            sourceHash: recognition.sourceHash,
            sheetName: "配券表",
            row: 2,
            evidenceCells: ["A2", "H2", "I2"],
            fieldCandidateIds: {},
            source: "ai",
          },
        ],
        fieldCandidates: [],
        listCandidates: [],
        templateCandidates: [],
        tierCandidates: [],
        skuRegionCandidates: [],
        issues: [],
      },
    });
    expect(projection.mode).toBe("ai_primary");
    expect(projection.couponCandidates).toHaveLength(2);
    expect(projection.couponCandidates[0]).toMatchObject({
      id: "ai-row-2",
      source: "ai",
    });
    expect(projection.couponCandidates[1]).toMatchObject({
      row: 3,
      source: "deterministic",
    });
  });

  it("falls back to rules after an invalid AI schema", async () => {
    const recognition = await inspectThreeSourceWorkbook(
      await couponSource([couponRow("活动A", "100", "20")]),
    );
    const projection = await resolveAiPrimaryRecognition({
      recognition,
      aiRecognition: {
        sourceHash: recognition.sourceHash,
        roleCandidates: [],
        couponCandidates: [],
        fieldCandidates: [],
        listCandidates: [],
        issues: ["AI 返回结构不符合严格候选 schema"],
      },
    });
    expect(projection.mode).toBe("rule_fallback");
    expect(projection.couponCandidates[0].source).toBe("deterministic");
    expect(projection.issues).toContain("AI 识别结果无效，已使用规则降级");
  });

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

  it("confirms multiple full-reduction rows as one ordered tier set", async () => {
    const recognition = await inspectThreeSourceWorkbook(
      await couponSource([
        couponRow("活动A", "100", "20"),
        couponRow("活动B", "200", "30"),
      ]),
    );
    await discoverRegularFullReductionCoupons({ recognition });
    const confirmed = await confirmRegularFullReductionCouponSet({
      recognition,
      ownerId: "owner-1",
      revision: 1,
      ownerFieldValues: { activityPointPercent: 6 },
    });
    expect(confirmed.tiers.map((tier) => tier.input.activityName)).toEqual([
      "活动A",
      "活动B",
    ]);
    expect(confirmed.tiers.map((tier) => tier.input.thresholdYuan)).toEqual([
      100, 200,
    ]);
    expect(confirmed.activityPointPercent).toBe(6);
  });

  it("requires owner confirmation for activity point and accepts explicit-value overrides", async () => {
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
    const confirmed = await confirmRegularFullReductionCoupon({
      recognition,
      ownerId: "owner-1",
      revision: 1,
      couponCandidateId: candidate.id,
      ownerFieldValues: {
        thresholdYuan: 999,
        activityPointPercent: 6,
      },
    });
    expect(confirmed.input.thresholdYuan).toBe(999);
    expect(confirmed.provenance.thresholdYuan).toMatchObject({
      sourceKind: "ownerSupplement",
      ownerId: "owner-1",
      revision: 1,
    });
  });

  it("accepts an owner-confirmed AI inference without a separate override reason", async () => {
    const row = couponRow("活动A", "100", "20");
    row[4] = "9月30日";
    row[5] = "2030-10-10";
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
        activityStartAt: "2030-09-30 00:00",
        activityPointPercent: 6,
      },
      aiRecognition: {
        sourceHash: recognition.sourceHash,
        roleCandidates: [],
        couponCandidates: [],
        fieldCandidates: [
          {
            key: "activityStartAt",
            sheetName: "配券表",
            headerCell: "E1",
            valueCell: "E2",
            confidence: 0.8,
            reason: "缺少年份，按当前时间推测",
            value: "2030-09-30 00:00",
            origin: "ai_inferred",
          },
        ],
        listCandidates: [],
        issues: [],
      },
    });

    expect(confirmed.input.activityStartAt).toBe("2030-09-30");
    expect(confirmed.provenance.activityStartAt).toMatchObject({
      sourceKind: "ownerSupplement",
      cell: "E2",
    });
  });

  it("reuses one consistent AI activity date across multiple coupon tiers", async () => {
    const first = couponRow("活动A", "100", "20");
    const second = couponRow("活动B", "200", "30");
    first[4] = "9月30日";
    second[4] = "9月30日";
    first[5] = "2030-10-10";
    second[5] = "2030-10-10";
    const recognition = await inspectThreeSourceWorkbook(
      await couponSource([first, second]),
    );

    const confirmed = await confirmRegularFullReductionCouponSet({
      recognition,
      ownerId: "owner-1",
      revision: 3,
      ownerFieldValues: {
        activityStartAt: "2030-09-30 00:00",
        activityPointPercent: 6,
      },
      aiRecognition: {
        sourceHash: recognition.sourceHash,
        roleCandidates: [],
        couponCandidates: [],
        fieldCandidates: [
          {
            key: "activityStartAt",
            sheetName: "配券表",
            headerCell: "E1",
            valueCell: "E2",
            confidence: 0.8,
            reason: "缺少年份，按业务确认补全年份",
            value: "2030-09-30",
            origin: "ai_inferred",
          },
        ],
        listCandidates: [],
        issues: [],
      },
    });

    expect(confirmed.tiers.map((tier) => tier.input.activityStartAt)).toEqual([
      "2030-09-30",
      "2030-09-30",
    ]);
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

describe("multi-sheet identifier list", () => {
  it("normalizes exact numeric SKU cells and preserves displayed leading zeros", async () => {
    const workbook = new ExcelJS.Workbook();
    const numeric = workbook.addWorksheet("数字SKU");
    numeric.getCell("A1").value = "sku";
    numeric.getCell("A2").value = 10_071_816_016_249;
    const padded = workbook.addWorksheet("补零SKU");
    padded.getCell("A1").value = "sku";
    padded.getCell("A2").value = 123;
    padded.getCell("A2").numFmt = "000000";
    const source: OfflineSourceFile = {
      fileName: "数字格式白名单.xlsx",
      bytes: new Uint8Array(await workbook.xlsx.writeBuffer()),
    };
    const recognition = await inspectThreeSourceWorkbook(source);

    const parsed = await parseMultiSheetTieredIdentifierList({
      recognition,
      role: "whitelist",
    });

    expect(parsed.issues).toEqual([]);
    expect(parsed.entries.map((entry) => [entry.tier, entry.id])).toEqual([
      ["数字SKU", "10071816016249"],
      ["补零SKU", "000123"],
    ]);
  });

  it("rejects numeric SKU cells beyond Excel's 15-digit precision", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("超长SKU");
    sheet.getCell("A1").value = "sku";
    sheet.getCell("A2").value = 1_234_567_890_123_456;
    const source: OfflineSourceFile = {
      fileName: "超长数字白名单.xlsx",
      bytes: new Uint8Array(await workbook.xlsx.writeBuffer()),
    };
    const recognition = await inspectThreeSourceWorkbook(source);

    const parsed = await parseMultiSheetTieredIdentifierList({
      recognition,
      role: "whitelist",
    });

    expect(parsed.entries).toEqual([]);
    expect(parsed.issues.join("；")).toContain("15 位有效数字");
  });

  it("uses AI-primary SKU regions before deterministic header aliases", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("业务导出页");
    sheet.getCell("C2").value = "货号信息";
    sheet.getCell("C3").value = "00123";
    sheet.getCell("C3").numFmt = "@";
    sheet.getCell("C4").value = "00999";
    sheet.getCell("C4").numFmt = "@";
    const source: OfflineSourceFile = {
      fileName: "任意布局白名单.xlsx",
      bytes: new Uint8Array(await workbook.xlsx.writeBuffer()),
    };
    const recognition = await inspectThreeSourceWorkbook(source);

    const parsed = await parseMultiSheetTieredIdentifierList({
      recognition,
      role: "whitelist",
      aiSkuRegions: [
        {
          id: "ai-region-1",
          role: "whitelist",
          dimension: "SKU",
          tierDisplayName: "满1999减120",
          headerCell: "C2",
          confidence: 0.98,
          reason: "AI 识别为商品 SKU 数据区域",
          evidence: {
            sourceHash: recognition.sourceHash,
            sheetName: "业务导出页",
            cells: ["C2", "C3", "C4"],
            region: { startCell: "C3", endCell: "C4" },
          },
        },
      ],
    });

    expect(parsed.issues).toEqual([]);
    expect(parsed.entries.map((entry) => [entry.tier, entry.id])).toEqual([
      ["业务导出页", "00123"],
      ["业务导出页", "00999"],
    ]);
  });

  it("parses every registered tier Sheet without selecting one Sheet", async () => {
    const workbook = new ExcelJS.Workbook();
    for (const [sheetName, sku] of [
      ["满999减60", "00123"],
      ["满1999减120", "00999"],
    ] as const) {
      const sheet = workbook.addWorksheet(sheetName);
      sheet.getCell("A1").value = "sku";
      sheet.getCell("A2").value = sku;
      sheet.getCell("A2").numFmt = "@";
    }
    const source: OfflineSourceFile = {
      fileName: "商品白名单.xlsx",
      bytes: new Uint8Array(await workbook.xlsx.writeBuffer()),
    };
    const recognition = await inspectThreeSourceWorkbook(source);

    const parsed = await parseMultiSheetTieredIdentifierList({
      recognition,
      role: "whitelist",
    });

    expect(parsed.issues).toEqual([]);
    expect(parsed.entries.map((entry) => [entry.tier, entry.id])).toEqual([
      ["满999减60", "00123"],
      ["满1999减120", "00999"],
    ]);
  });

  it("accepts arbitrary sibling Sheet names without a global tier registry", async () => {
    const workbook = new ExcelJS.Workbook();
    for (const sheetName of ["满999减60", "业务临时档"]) {
      const sheet = workbook.addWorksheet(sheetName);
      sheet.getCell("A1").value = "sku";
      sheet.getCell("A2").value = `${sheetName}-sku`;
      sheet.getCell("A2").numFmt = "@";
    }
    const source: OfflineSourceFile = {
      fileName: "商品白名单.xlsx",
      bytes: new Uint8Array(await workbook.xlsx.writeBuffer()),
    };
    const recognition = await inspectThreeSourceWorkbook(source);

    const parsed = await parseMultiSheetTieredIdentifierList({
      recognition,
      role: "whitelist",
    });

    expect(parsed.issues).toEqual([]);
    expect(parsed.sheetOrder).toEqual(["满999减60", "业务临时档"]);
    expect(parsed.entries.map((entry) => [entry.tier, entry.id])).toEqual([
      ["满999减60", "满999减60-sku"],
      ["业务临时档", "业务临时档-sku"],
    ]);
  });

  it("deduplicates within each Sheet while preserving the same SKU across Sheets", async () => {
    const workbook = new ExcelJS.Workbook();
    for (const sheetName of ["100减1", "2000减20"]) {
      const sheet = workbook.addWorksheet(sheetName);
      sheet.getCell("A1").value = "sku";
      sheet.getCell("A2").value = "00123";
      sheet.getCell("A3").value = "00123";
      sheet.getColumn("A").numFmt = "@";
    }
    const source: OfflineSourceFile = {
      fileName: "含重复SKU的多券档白名单.xlsx",
      bytes: new Uint8Array(await workbook.xlsx.writeBuffer()),
    };
    const recognition = await inspectThreeSourceWorkbook(source);

    const parsed = await parseMultiSheetTieredIdentifierList({
      recognition,
      role: "whitelist",
    });

    expect(parsed.issues).toEqual([]);
    expect(parsed.entries.map((entry) => [entry.tier, entry.id])).toEqual([
      ["100减1", "00123"],
      ["2000减20", "00123"],
    ]);
  });

  it("applies per-Sheet deduplication to AI-primary SKU regions", async () => {
    const workbook = new ExcelJS.Workbook();
    for (const sheetName of ["100减1", "2000减20"]) {
      const sheet = workbook.addWorksheet(sheetName);
      sheet.getCell("C1").value = "商品编码";
      sheet.getCell("C2").value = "00123";
      sheet.getCell("C3").value = "00123";
      sheet.getColumn("C").numFmt = "@";
    }
    const source: OfflineSourceFile = {
      fileName: "AI识别多券档白名单.xlsx",
      bytes: new Uint8Array(await workbook.xlsx.writeBuffer()),
    };
    const recognition = await inspectThreeSourceWorkbook(source);

    const parsed = await parseMultiSheetTieredIdentifierList({
      recognition,
      role: "whitelist",
      aiSkuRegions: ["100减1", "2000减20"].map((sheetName, index) => ({
        id: `ai-region-${index + 1}`,
        role: "whitelist",
        dimension: "SKU",
        tierDisplayName: sheetName,
        headerCell: "C1",
        confidence: 0.99,
        reason: "AI 识别为 SKU 区域",
        evidence: {
          sourceHash: recognition.sourceHash,
          sheetName,
          cells: ["C1", "C2", "C3"],
          region: { startCell: "C2", endCell: "C3" },
        },
      })),
    });

    expect(parsed.issues).toEqual([]);
    expect(parsed.entries.map((entry) => [entry.tier, entry.id])).toEqual([
      ["100减1", "00123"],
      ["2000减20", "00123"],
    ]);
  });
});
