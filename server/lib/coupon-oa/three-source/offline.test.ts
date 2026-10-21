import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyDynamicSkuListWorkbook } from "../../excel-template-engine";
import {
  bindCouponApprovalSchema,
  type CouponApprovalDefinition,
  diffSubmittedApprovalForm,
  encodeCouponOaForm,
  parseApprovalFormValues,
} from "../../feishu/coupon-oa/approval-schema";
import {
  parseMultiSheetTieredIdentifierList,
  parseTieredIdentifierList,
} from "./lists";
import { runOfflineThreeSourceWorkflow } from "./offline";
import {
  confirmRegularFullReductionCouponSet,
  extractRegularFullReductionInput,
  inspectThreeSourceWorkbook,
} from "./recognition";
import type { OfflineSourceFile } from "./types";
import {
  assertExpectedRevision,
  buildOaPrefillSnapshot,
  createCanonicalPackage,
  createCouponSetCanonicalPackage,
  generateOfflineArtifacts,
} from "./workflow";

const templatesDirectory = join(
  process.cwd(),
  "docs/oa-ticket-reimbursement-materials/reference/templates",
);

async function workbookBytes(workbook: ExcelJS.Workbook): Promise<Uint8Array> {
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

async function couponSource(
  input: { businessMode?: string } = {},
): Promise<OfflineSourceFile> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("任意配券布局");
  sheet.getCell("A1").value = "仅用于本地离线验收的合成配券表";
  sheet.getCell("A2").value = "说明行不应被识别为数据";
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
  sheet.getRow(4).values = headers;
  sheet.getRow(5).values = [
    "合成满减活动",
    "离线测试活动背景",
    input.businessMode ?? "pop",
    "测试提报人",
    "2030-01-01",
    "2030-01-03",
    "京东商城、拍拍二手",
    "999",
    "60",
    "1000",
    "1",
    "1",
    "2030-01-01 00:00:00 至 2030-01-03 23:59:59",
    "2030-01-01 00:00:00 至 2030-01-10 23:59:59",
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
  return {
    fileName: "任意格式-合成配券表.xlsx",
    bytes: await workbookBytes(workbook),
  };
}

async function listSource(input: {
  role: "白名单" | "黑名单";
  rows: Array<[string, string, string]>;
}): Promise<OfflineSourceFile> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("业务侧自定义名单");
  sheet.getCell("A1").value = `合成${input.role}，仅用于本地测试`;
  sheet.getCell("A2").value = "此表具有商品名和链接等无关列";
  sheet.getRow(3).values = ["商品名称", "SKU", "券档", "商品链接"];
  input.rows.forEach(([name, sku, tier], index) => {
    sheet.getRow(index + 4).values = [
      name,
      sku,
      tier,
      "https://example.test/item",
    ];
    sheet.getRow(index + 4).getCell(2).numFmt = "@";
  });
  return {
    fileName: `任意格式-合成${input.role}.xlsx`,
    bytes: await workbookBytes(workbook),
  };
}

async function headerlessMerchantIdSource(): Promise<OfflineSourceFile> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.getColumn(1).numFmt = "@";
  sheet.getCell("A1").value = "162203631";
  sheet.getCell("A2").value = "147993477";
  sheet.getCell("A3").value = "20062984";
  return {
    fileName: "商家ID_白名单.xlsx",
    bytes: await workbookBytes(workbook),
  };
}

async function invalidBlacklistSource(): Promise<OfflineSourceFile> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("黑名单源表");
  sheet.getCell("A1").value = "合成黑名单";
  sheet.getRow(3).values = ["商品名称", "SKU", "券档"];
  sheet.getRow(4).values = ["公式 SKU", { formula: '"00001"' }, "满999减60"];
  return {
    fileName: "损坏黑名单.xlsx",
    bytes: await workbookBytes(workbook),
  };
}

async function templates() {
  const [
    regularFullReductionTemplateBytes,
    whitelistTemplateBytes,
    blacklistTemplateBytes,
  ] = await Promise.all([
    readFile(join(templatesDirectory, "配券信息表-常规满减券.xlsx")),
    readFile(join(templatesDirectory, "商品明细白名单-多券档SKU-v1.xlsx")),
    readFile(join(templatesDirectory, "商品明细黑名单-多券档SKU-v1.xlsx")),
  ]);
  return {
    regularFullReductionTemplateBytes,
    whitelistTemplateBytes,
    blacklistTemplateBytes,
  };
}

const screenshotRenderer = {
  async render(input: {
    couponArtifact: {
      fileName: string;
      sha256: string;
      template: { id: string; version: string };
    };
    revision: number;
  }) {
    const bytes = new Uint8Array([137, 80, 78, 71, input.revision]);
    return [
      {
        artifactId: `calc-image-${input.revision}-1`,
        order: 0,
        role: "calcImage" as const,
        provenance: "generated" as const,
        fileName: `${input.couponArtifact.fileName}.png`,
        bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sourceArtifactSha256: input.couponArtifact.sha256,
        templateId: input.couponArtifact.template.id,
        templateVersion: input.couponArtifact.template.version,
        renderRange: "A1:Z200",
        contentType: "image/png" as const,
        rendererVersion: "test-renderer-v1",
        page: 1,
        pageCount: 1,
        displayedValuesSha256: createHash("sha256")
          .update("values")
          .digest("hex"),
      },
    ];
  },
};

async function happyPathInput(
  overlapDecision: "whitelist_wins" | "blacklist_wins" = "whitelist_wins",
  businessMode = "pop",
) {
  return {
    ownerId: "offline-owner-001",
    revision: 1,
    couponTable: await couponSource({ businessMode }),
    whitelist: await listSource({
      role: "白名单",
      rows: [
        ["前导零商品", "00123", "满999减60"],
        ["第二档商品", "00124", "满1999减120"],
        ["重叠商品", "00999", "满2999减120"],
      ],
    }),
    blacklist: await listSource({
      role: "黑名单",
      rows: [
        ["重叠商品", "00999", "满3999减240"],
        ["黑名单独有商品", "00888", "满4999减300"],
      ],
    }),
    overlapDecision,
    screenshotRenderer,
    templates: await templates(),
    activityPointPercent: 6,
  } as const;
}

function localApprovalDefinition(): CouponApprovalDefinition {
  const expected = [
    ["部门", "department"],
    ["申请人", "contact"],
    ["申请类型", "radioV2"],
    ["业务模式", "radioV2"],
    ["活动名称", "input"],
    ["活动背景", "textarea"],
    ["修改类型", "radioV2"],
    ["修改背景&原因描述", "textarea"],
    ["活动点位(%)", "number"],
    ["平台承担比例(%)", "number"],
    ["是否超扣点", "radioV2"],
    ["超扣点原因", "textarea"],
    ["预估GMV", "amount"],
    ["预估费用", "amount"],
    ["ROI", "formula"],
    ["配置渠道", "checkboxV2"],
    ["DateInterval", "dateInterval"],
    ["请上传具体满减测算图片", "image"],
    ["请上传配券信息表（按模版填写）", "attachmentV2"],
    ["请上传商品明细白名单", "attachmentV2"],
    ["请上传商品明细黑名单", "attachmentV2"],
    ["关联优惠券申请审批", "connect"],
    ["涉及修改批次ID", "textarea"],
    ["请上传增加商家id或sku明细", "attachmentV2"],
    ["请上传剔除商家id或sku明细", "attachmentV2"],
  ] as const;
  const options = {
    申请类型: ["优惠券申请", "优惠券修改"],
    业务模式: ["严选", "寄卖", "pop"],
    修改类型: ["关闭优惠券批次", "增加商家id或sku", "剔除商家id或sku"],
    是否超扣点: ["是", "否"],
    配置渠道: ["京东渠道", "严选APP及小程序"],
  } as const;
  return {
    approvalCode: "offline-contract-only",
    form: JSON.stringify(
      expected.map(([name, type], index) => ({
        id: `offline-control-${index}`,
        name,
        type,
        option:
          name in options
            ? options[name as keyof typeof options].map((text) => ({
                text,
                value: `${name}-${text}`,
              }))
            : undefined,
      })),
    ),
  };
}

describe("three-source coupon OA offline workflow", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    delete process.env.DEEPSEEK_API_KEY;
    fetchSpy = vi.fn(() => {
      throw new Error("offline test attempted network call");
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recognizes arbitrary layouts, resolves overlap, and only produces local artifacts", async () => {
    const result = await runOfflineThreeSourceWorkflow(await happyPathInput());

    expect(
      result.recognitions.couponTable.couponFieldCandidates.activityName,
    ).toHaveLength(1);
    expect(result.confirmation.overlap.ids).toEqual(["00999"]);
    expect(result.package.overlap.decision).toBe("whitelist_wins");
    expect(result.package.whitelistByTier.满999减60).toEqual(["00123"]);
    expect(result.package.blacklistByTier?.满3999减240).toBeUndefined();
    expect(result.package.blacklistByTier?.满4999减300).toEqual(["00888"]);
    expect(result.package.computed.estimatedCostYuan).toBe(9000);
    expect(result.package.computed.estimatedRoi).toBeCloseTo(120000 / 9000);
    expect(result.artifacts.map((artifact) => artifact.role)).toEqual([
      "couponTable",
      "productWhitelist",
      "productBlacklist",
    ]);
    const couponArtifact = result.artifacts.find(
      (artifact) => artifact.role === "couponTable",
    );
    expect(couponArtifact).toBeDefined();
    expect(result.screenshots).toHaveLength(1);
    expect(result.screenshots[0].sourceArtifactSha256).toBe(
      couponArtifact?.sha256,
    );
    expect(result.screenshots[0].renderRange).toBe("A1:Z200");
    expect(
      result.oaPrefill.attachments.find(
        (attachment) => attachment.role === "calcImage",
      ),
    ).toMatchObject({
      sourceArtifactSha256: couponArtifact?.sha256,
      renderRange: "A1:Z200",
    });
    expect(
      result.oaPrefill.attachments.map((attachment) => attachment.fileName),
    ).not.toContain("任意格式-合成白名单.xlsx");
    expect(result.oaPrefill.values.durationDays).toBe(3);
    expect(result.oaPrefill.values.activityPointPercent).toBe(6);
    expect(result.oaPrefill.values.applicant).toEqual({
      source: "feishuIdentity",
      status: "resolved_on_final_confirmation",
    });
    expect(result.oaPrefill.values.department).toEqual({
      source: "feishuIdentity",
      status: "resolved_on_final_confirmation",
    });
    expect(result.secondConfirmation.oaCreated).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();

    const whitelistArtifact = result.artifacts.find(
      (artifact) => artifact.role === "productWhitelist",
    );
    const blacklistArtifact = result.artifacts.find(
      (artifact) => artifact.role === "productBlacklist",
    );
    if (
      !whitelistArtifact ||
      !blacklistArtifact ||
      !result.package.blacklistByTier
    ) {
      throw new Error("测试未生成预期的白名单或黑名单附件");
    }
    await verifyDynamicSkuListWorkbook({
      bytes: whitelistArtifact.bytes,
      expectedTiers: result.package.whitelistByTier,
    });
    await verifyDynamicSkuListWorkbook({
      bytes: blacklistArtifact.bytes,
      expectedTiers: result.package.blacklistByTier,
    });
  });

  it("requires an explicit owner-selected field candidate when coupon recognition is ambiguous", async () => {
    const source = await couponSource();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(source.bytes) as never);
    const sheet = workbook.getWorksheet("任意配券布局");
    if (!sheet) throw new Error("测试配券 Sheet 不存在");
    sheet.getCell("Y4").value = "活动名称";
    sheet.getCell("Y5").value = "业务员确认的活动名称";
    const recognition = await inspectThreeSourceWorkbook({
      fileName: source.fileName,
      bytes: await workbookBytes(workbook),
    });
    const candidates = recognition.couponFieldCandidates.activityName ?? [];
    expect(candidates).toHaveLength(2);

    await expect(
      extractRegularFullReductionInput({ recognition }),
    ).rejects.toThrow("存在多个候选");
    await expect(
      extractRegularFullReductionInput({
        recognition,
        fieldCandidateIds: { activityName: "not-a-candidate" },
      }),
    ).rejects.toThrow("未找到已确认的");
    await expect(
      extractRegularFullReductionInput({
        recognition,
        fieldCandidateIds: { activityName: candidates[1].id },
      }),
    ).resolves.toMatchObject({
      input: { activityName: "业务员确认的活动名称" },
    });
  });

  it("allows 严选 to build the OA prefill without a screenshot but rejects non-严选", async () => {
    const strictInput = await happyPathInput("whitelist_wins", "严选");
    const { screenshotRenderer: _renderer, ...withoutRenderer } = strictInput;
    const strictResult = await runOfflineThreeSourceWorkflow(withoutRenderer);
    expect(strictResult.screenshots).toEqual([]);
    expect(
      strictResult.oaPrefill.attachments.some(
        (attachment) => attachment.role === "calcImage",
      ),
    ).toBe(false);

    const nonStrictInput = await happyPathInput();
    const {
      screenshotRenderer: _nonStrictRenderer,
      ...nonStrictWithoutRenderer
    } = nonStrictInput;
    await expect(
      runOfflineThreeSourceWorkflow(nonStrictWithoutRenderer),
    ).rejects.toThrow("标准配券表截图");
  });

  it("requires an explicit no-blacklist confirmation and does not generate a fake empty blacklist", async () => {
    const input = await happyPathInput();
    const { blacklist: _blacklist, ...withoutBlacklist } = input;
    await expect(
      runOfflineThreeSourceWorkflow({
        ...withoutBlacklist,
        noBlacklistConfirmed: false,
      }),
    ).rejects.toThrow("必须明确确认“本次无黑名单”");

    const result = await runOfflineThreeSourceWorkflow({
      ...withoutBlacklist,
      noBlacklistConfirmed: true,
    });
    expect(result.confirmation.blacklistStatus).toBe("absent_confirmed");
    expect(result.artifacts.map((artifact) => artifact.role)).toEqual([
      "couponTable",
      "productWhitelist",
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed for uploaded invalid blacklists and unresolved overlap", async () => {
    const invalidInput = await happyPathInput();
    await expect(
      runOfflineThreeSourceWorkflow({
        ...invalidInput,
        blacklist: await invalidBlacklistSource(),
      }),
    ).rejects.toThrow("已上传黑名单无效");

    const overlapInput = await happyPathInput();
    const { overlapDecision: _decision, ...unresolvedOverlap } = overlapInput;
    await expect(
      runOfflineThreeSourceWorkflow(unresolvedOverlap),
    ).rejects.toThrow("白黑名单存在重叠 SKU");

    await expect(
      runOfflineThreeSourceWorkflow({
        ...(await happyPathInput()),
        overlapDecision: "source_replacement_required",
      }),
    ).rejects.toThrow("返回修改源文件");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports unsafe identifiers while skipping duplicates and blank rows", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("白名单错误数据");
    sheet.getCell("A1").value = "合成白名单";
    sheet.getRow(3).values = ["商品", "SKU", "券档"];
    sheet.getRow(4).values = ["公式", { formula: '"00101"' }, "满999减60"];
    sheet.getRow(5).values = ["公式前缀", "+00105", "满999减60"];
    sheet.getRow(6).values = ["超长数值", 1_234_567_890_123_456, "满999减60"];
    sheet.getRow(7).values = ["多值", "00102,00103", "满999减60"];
    sheet.getRow(8).values = ["有效", "00104", "满999减60"];
    sheet.getRow(9).values = ["重复", "00104", "满999减60"];
    sheet.getRow(10).values = ["空值", "", "满999减60"];
    const recognition = await inspectThreeSourceWorkbook({
      fileName: "错误白名单.xlsx",
      bytes: await workbookBytes(workbook),
    });
    const parsed = await parseTieredIdentifierList({
      recognition,
      role: "whitelist",
    });
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.issues).toHaveLength(4);
    expect(parsed.issues.join("；")).toContain("不能使用公式");
    expect(parsed.issues.join("；")).toContain("公式前缀");
    expect(parsed.issues.join("；")).not.toContain("与前序 SKU 重复");
    expect(parsed.issues.join("；")).toContain("15 位有效数字");
    expect(parsed.issues.join("；")).toContain("包含多个名单 ID");
    expect(parsed.issues.join("；")).not.toContain("为空");
  });

  it("sums estimated GMV/cost/ROI across coupon tiers for the OA prefill (bug-fix-7)", async () => {
    // 两档配券表复刻线上案例形态：卡片曾只显示第一档的 GMV/费用。
    // 每档费用 = 数量×面额×使用率×承担比例：两档各 25,200，合计 50,400。
    const couponWorkbook = new ExcelJS.Workbook();
    const couponSheet = couponWorkbook.addWorksheet("多档配券表");
    couponSheet.getCell("A1").value = "本地多档合计口径回归用合成配券表";
    const couponHeaders = [
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
    couponSheet.getRow(4).values = couponHeaders;
    couponSheet.getRow(5).values = [
      "多档合计活动",
      "离线测试活动背景",
      "严选",
      "测试提报人",
      "2030-01-01",
      "2030-01-03",
      "拍拍二手",
      "999",
      "60",
      "2800",
      "1",
      "1",
      "2030-01-01 00:00:00 至 2030-01-03 23:59:59",
      "2030-01-01 00:00:00 至 2030-01-10 23:59:59",
      "80%",
      "30%",
      "50%",
      "50000",
      "活动期间仅可领一次",
      "不允许",
      "公开自动推广",
      "领券中心",
      "否",
      "",
    ];
    couponSheet.getRow(6).values = [
      "多档合计活动",
      "离线测试活动背景",
      "严选",
      "测试提报人",
      "2030-01-01",
      "2030-01-03",
      "拍拍二手",
      "1999",
      "120",
      "1400",
      "1",
      "1",
      "2030-01-01 00:00:00 至 2030-01-03 23:59:59",
      "2030-01-01 00:00:00 至 2030-01-10 23:59:59",
      "80%",
      "30%",
      "50%",
      "240000",
      "活动期间仅可领一次",
      "不允许",
      "公开自动推广",
      "领券中心",
      "否",
      "",
    ];
    const couponSourceFile: OfflineSourceFile = {
      fileName: "任意格式-多档合成配券表.xlsx",
      bytes: await workbookBytes(couponWorkbook),
    };
    const recognition = await inspectThreeSourceWorkbook(couponSourceFile);
    const couponSet = await confirmRegularFullReductionCouponSet({
      recognition,
      ownerId: "offline-owner-001",
      revision: 1,
      ownerFieldValues: { activityPointPercent: 6 },
    });
    const whitelistRecognition = await inspectThreeSourceWorkbook(
      await listSource({
        role: "白名单",
        rows: [
          ["第一档商品", "00123", "满999减60"],
          ["第二档商品", "00124", "满1999减120"],
        ],
      }),
    );
    const whitelist = await parseTieredIdentifierList({
      recognition: whitelistRecognition,
      role: "whitelist",
    });
    const packageValue = createCouponSetCanonicalPackage({
      ownerId: "offline-owner-001",
      revision: 1,
      couponSet,
      whitelist,
      blacklistStatus: "absent_confirmed",
    });
    expect(packageValue.summary).toEqual({
      estimatedGmvYuan: 290_000,
      estimatedCostYuan: 50_400,
      estimatedRoi: 5.75,
    });
    const artifacts = await generateOfflineArtifacts({
      package: packageValue,
      templates: await templates(),
    });
    const snapshot = buildOaPrefillSnapshot({
      package: packageValue,
      artifacts,
      screenshots: [],
      activityPointPercent: 6,
    });
    expect(snapshot.values.estimatedGmvYuan).toBe(290_000);
    expect(snapshot.values.estimatedCostYuan).toBe(50_400);
    expect(snapshot.values.estimatedRoi).toBe(5.75);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("applies the business-selected blacklist-wins decision without changing tiers", async () => {
    const result = await runOfflineThreeSourceWorkflow(
      await happyPathInput("blacklist_wins"),
    );
    expect(result.package.whitelistByTier.满2999减120).toBeUndefined();
    expect(result.package.blacklistByTier?.满3999减240).toEqual(["00999"]);
    expect(result.package.overlap).toMatchObject({
      ids: ["00999"],
      decision: "blacklist_wins",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed when a source list has ambiguous ID-column candidates", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("候选歧义");
    sheet.getCell("A1").value = "合成白名单";
    sheet.getRow(3).values = ["SKU", "SKU", "券档"];
    sheet.getRow(4).values = ["00101", "00102", "满999减60"];
    const recognition = await inspectThreeSourceWorkbook({
      fileName: "ID 列歧义.xlsx",
      bytes: await workbookBytes(workbook),
    });
    await expect(
      parseTieredIdentifierList({ recognition, role: "whitelist" }),
    ).rejects.toThrow("ID 列存在多个候选");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("invalidates stale revisions and changed mappings without depending on a fixed list template", async () => {
    const result = await runOfflineThreeSourceWorkflow(await happyPathInput());
    expect(() =>
      assertExpectedRevision(result.confirmation, "offline-owner-001", 2),
    ).toThrow("确认版本已过期");

    result.confirmation.whitelist.entries[0].provenance.column = "C";
    expect(() =>
      createCanonicalPackage({
        confirmation: result.confirmation,
        ownerId: "offline-owner-001",
        expectedRevision: 1,
        overlapDecision: "whitelist_wins",
      }),
    ).toThrow("源材料、映射或确认状态已变化");

    const currentTemplates = await templates();
    const changedWhitelistTemplate = new Uint8Array(
      currentTemplates.whitelistTemplateBytes,
    );
    changedWhitelistTemplate[0] ^= 1;
    const regenerated = await generateOfflineArtifacts({
      package: result.package,
      templates: {
        ...currentTemplates,
        whitelistTemplateBytes: changedWhitelistTemplate,
      },
    });
    expect(
      regenerated.find((artifact) => artifact.role === "productWhitelist")
        ?.template.id,
    ).toBe("coupon-dynamic-sku-whitelist-v1");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("encodes and compares the approval form locally without creating an approval", async () => {
    const result = await runOfflineThreeSourceWorkflow(await happyPathInput());
    const artifacts = Object.fromEntries(
      result.artifacts.map((artifact) => [artifact.role, artifact]),
    );
    const schema = bindCouponApprovalSchema(localApprovalDefinition());
    const encoded = encodeCouponOaForm(
      schema,
      {
        applicationType: "优惠券申请",
        businessMode: result.oaPrefill.values.businessMode,
        activityName: result.oaPrefill.values.activityName,
        activityBackground: result.oaPrefill.values.activityBackground,
        activityPointPercent: result.oaPrefill.values.activityPointPercent,
        platformBearingPercent: result.oaPrefill.values.platformBearingPercent,
        overDeduction: result.oaPrefill.values.overDeduction,
        overDeductionReason: result.oaPrefill.values.overDeductionReason,
        estimatedGmvYuan: result.oaPrefill.values.estimatedGmvYuan,
        estimatedCostYuan: result.oaPrefill.values.estimatedCostYuan,
        channels: result.oaPrefill.values.channels.map((channel) =>
          channel === "JD" ? "京东渠道" : "严选APP及小程序",
        ),
        activityStartAt: result.oaPrefill.values.activityStartAt,
        activityEndAt: result.oaPrefill.values.activityEndAt,
        calcImageFileCodes: ["offline-calc-image"],
        couponTableFileCodes: [`offline-${artifacts.couponTable.sha256}`],
        productWhitelistFileCodes: [
          `offline-${artifacts.productWhitelist.sha256}`,
        ],
        productBlacklistFileCodes: [
          `offline-${artifacts.productBlacklist.sha256}`,
        ],
      },
      { openId: "offline-open-id", userId: "offline-user-id" },
    );
    const parsed = parseApprovalFormValues(JSON.stringify(encoded));
    expect(diffSubmittedApprovalForm(schema, encoded, parsed)).toEqual({
      issues: [],
      needsReview: [],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("parses a headerless merchant-id list only with an owner confirmation", async () => {
    const source = await headerlessMerchantIdSource();
    const recognition = await inspectThreeSourceWorkbook(source);

    const unconfirmed = await parseMultiSheetTieredIdentifierList({
      recognition,
      role: "whitelist",
    });
    expect(unconfirmed.dimension).toBe("UNKNOWN");
    expect(unconfirmed.entries).toEqual([]);
    expect(unconfirmed.issues).toContain(
      "当前只支持 SKU 或商家 ID 名单，请先确认标识类型",
    );

    const confirmed = await parseMultiSheetTieredIdentifierList({
      recognition,
      role: "whitelist",
      identifierDimensionConfirmation: {
        sourceSha256: recognition.sourceHash,
        detectedDimension: "UNKNOWN",
        confirmedAs: "MERCHANT_ID",
      },
    });
    expect(confirmed.issues).toEqual([]);
    expect(confirmed.dimension).toBe("MERCHANT_ID");
    expect(confirmed.entries.map((entry) => entry.id)).toEqual([
      "162203631",
      "147993477",
      "20062984",
    ]);

    const overridden = await parseMultiSheetTieredIdentifierList({
      recognition,
      role: "whitelist",
      identifierDimensionConfirmation: {
        sourceSha256: recognition.sourceHash,
        detectedDimension: "UNKNOWN",
        confirmedAs: "SKU",
      },
    });
    expect(overridden.dimension).toBe("SKU");
    expect(overridden.entries.map((entry) => entry.id)).toEqual([
      "162203631",
      "147993477",
      "20062984",
    ]);
  });

  it("still rejects formula, separator and duplicate merchant ids cell by cell", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.getColumn(1).numFmt = "@";
    sheet.getCell("A1").value = "162203631";
    sheet.getCell("A2").value = { formula: '"147993477"', result: "147993477" };
    sheet.getCell("A3").value = "20062984,20062985";
    sheet.getCell("A4").value = "162203631";
    const source = {
      fileName: "商家ID_白名单.xlsx",
      bytes: await workbookBytes(workbook),
    };
    const recognition = await inspectThreeSourceWorkbook(source);
    const parsed = await parseMultiSheetTieredIdentifierList({
      recognition,
      role: "whitelist",
      // The deterministic headerless candidate requires every cell to be
      // identifier-like, so mixed-invalid sources ride the AI region path.
      aiSkuRegions: [
        {
          id: "region-1",
          role: "whitelist",
          dimension: "MERCHANT_ID",
          headerCell: "A1",
          confidence: 0.9,
          reason: "文件名标注商家ID",
          evidence: {
            sourceHash: recognition.sourceHash,
            sheetName: "Sheet1",
            cells: ["A1", "A4"],
            region: { startCell: "A1", endCell: "A4" },
          },
        },
      ],
      identifierDimensionConfirmation: {
        sourceSha256: recognition.sourceHash,
        detectedDimension: "UNKNOWN",
        confirmedAs: "MERCHANT_ID",
      },
    });
    expect(parsed.issues).toEqual([
      "Sheet1!A2 不能使用公式作为名单 ID",
      "Sheet1!A3 包含多个名单 ID 或分隔符",
    ]);
    expect(parsed.entries.map((entry) => entry.id)).toEqual(["162203631"]);
  });

  it("produces faithful merchant-id artifacts and 限商家ID coupon rows", async () => {
    const workflowTemplates = await templates();
    const merchantWhitelist = await headerlessMerchantIdSource();
    const result = await runOfflineThreeSourceWorkflow({
      ownerId: "offline-owner-001",
      revision: 1,
      couponTable: await couponSource({ businessMode: "pop" }),
      whitelist: merchantWhitelist,
      noBlacklistConfirmed: true,
      listMode: "dynamic-multi-sheet",
      whitelistDimensionConfirmation: {
        sourceSha256: createHash("sha256")
          .update(merchantWhitelist.bytes)
          .digest("hex"),
        detectedDimension: "UNKNOWN",
        confirmedAs: "MERCHANT_ID",
      },
      screenshotRenderer,
      templates: workflowTemplates,
      activityPointPercent: 6,
    });

    expect(result.package.whitelistDimension).toBe("MERCHANT_ID");
    expect(result.package.coupon.input.productLimitType).toBe("限商家ID");
    const whitelistArtifact = result.artifacts.find(
      (artifact) => artifact.role === "productWhitelist",
    );
    if (!whitelistArtifact) throw new Error("missing whitelist artifact");
    expect(whitelistArtifact.fileName.startsWith("商家ID白名单_")).toBe(true);
    expect(whitelistArtifact.template).toEqual({
      id: "coupon-dynamic-merchant-whitelist-v1",
      version: "v1",
    });
    await verifyDynamicSkuListWorkbook({
      bytes: whitelistArtifact.bytes,
      expectedTiers: result.package.whitelistByTier,
      dimension: "MERCHANT_ID",
    });

    const couponWorkbook = new ExcelJS.Workbook();
    await couponWorkbook.xlsx.load(
      Buffer.from(
        result.artifacts.find((artifact) => artifact.role === "couponTable")
          ?.bytes ?? [],
      ) as never,
    );
    const couponSheet = couponWorkbook.getWorksheet("满减券");
    if (!couponSheet) throw new Error("missing coupon sheet");
    expect(couponSheet.getCell("Y2").text).toBe("限商家ID");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
