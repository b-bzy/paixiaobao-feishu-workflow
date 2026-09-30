import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../excel-template-engine", () => ({
  generateRegularFullReductionWorkbook: vi.fn(),
  generateSkuWhitelistWorkbook: vi.fn(),
  inspectSkuWhitelistSource: vi.fn(),
  parseSkuWhitelistSource: vi.fn(),
}));
vi.mock("../../excel-template-engine/template-manifests", () => ({
  regularFullReductionManifest: { id: "coupon-template", version: "v1" },
  skuWhitelistPilotManifest: { id: "whitelist-template", version: "v1" },
}));
vi.mock("../deepseek-client", () => ({ extractCouponPilotFields: vi.fn() }));
vi.mock("../drive-client", () => ({
  uploadFeishuBitableAttachment: vi.fn(),
  uploadFeishuDriveFile: vi.fn(),
}));
vi.mock("../message-client", () => ({
  downloadFeishuMessageResource: vi.fn(),
}));
vi.mock("./excel-pilot-assets", () => ({ loadCouponPilotTemplate: vi.fn() }));
vi.mock("./excel-pilot-config", () => ({
  getCouponExcelPilotFolderToken: vi.fn(() => "fld-pilot"),
  getCouponExcelPilotTableId: vi.fn(() => "tbl-pilot"),
}));
vi.mock("./excel-pilot-oa-handoff", () => ({
  beginCouponPilotOaHandoff: vi.fn(),
}));
vi.mock("./excel-pilot-store", () => ({
  sourceFileMetadata: vi.fn(),
  updateCouponExcelPilotDraft: vi.fn(),
}));

import {
  generateRegularFullReductionWorkbook,
  generateSkuWhitelistWorkbook,
  parseSkuWhitelistSource,
} from "../../excel-template-engine";
import {
  uploadFeishuBitableAttachment,
  uploadFeishuDriveFile,
} from "../drive-client";
import { downloadFeishuMessageResource } from "../message-client";
import { loadCouponPilotTemplate } from "./excel-pilot-assets";
import { generateCouponPilotArtifacts } from "./excel-pilot-service";
import { updateCouponExcelPilotDraft } from "./excel-pilot-store";

const originalBaseAppToken = process.env.FEISHU_BASE_APP_TOKEN;
const bytes = new Uint8Array([1, 2, 3]);

const draft = {
  recordId: "rec-pilot",
  pilotId: "CEP-test",
  ownerOpenId: "ou_test",
  status: "Generating" as const,
  revision: 4,
  schemaVersion: "coupon-excel-pilot-v1",
  input: {
    activityName: "测试活动",
    activityBackground: "测试背景",
    businessMode: "寄卖" as const,
    applicantName: "测试用户",
    activityStartAt: "2030-01-01",
    activityEndAt: "2030-01-02",
    channels: ["JD"] as const,
    thresholdYuan: 100,
    discountAmountYuan: 20,
    totalQuantity: 100,
    grantQuantityPerClaim: 1,
    dailyClaimLimit: 1,
    claimWindow: "2030-01-01 00:00 至 2030-01-02 23:59",
    useWindow: "2030-01-01 00:00 至 2030-01-02 23:59",
    expectedClaimRate: 0.5,
    expectedUseRate: 0.5,
    platformBearingRatio: 0.5,
    estimatedGmvYuan: 10_000,
    couponType: "东券" as const,
    productLimitType: "限SKU" as const,
    claimRiskControl: "0级以下用户可领" as const,
    claimRule: "活动期间仅可领一次" as const,
    allowGift: "允许" as const,
    promotionMode: "非公开推广" as const,
    publicPromotionChannels: [],
    overDeduction: "否" as const,
    overDeductionReason: "",
  },
  sourceWhitelist: {
    messageId: "om-source",
    fileKey: "file-source",
    fileName: "source.xlsx",
    bytes: 3,
    sha256: "source-hash",
  },
  whitelistMapping: { sheetName: "Sheet1", column: "A", header: "SKUID" },
  artifacts: [],
  validationIssues: [],
  processedMessageIds: [],
};

describe("coupon Excel pilot generation attachment promotion", () => {
  beforeEach(() => {
    process.env.FEISHU_BASE_APP_TOKEN = "app-pilot";
    vi.mocked(downloadFeishuMessageResource).mockResolvedValue(bytes);
    vi.mocked(parseSkuWhitelistSource).mockResolvedValue({
      skus: ["10000001"],
      issues: [],
    });
    vi.mocked(loadCouponPilotTemplate).mockResolvedValue(bytes);
    vi.mocked(generateRegularFullReductionWorkbook).mockResolvedValue({
      fileName: "配券.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes,
      sha256: "coupon-hash",
      rowCount: 1,
    });
    vi.mocked(generateSkuWhitelistWorkbook).mockResolvedValue({
      fileName: "白名单.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes,
      sha256: "whitelist-hash",
      rowCount: 1,
    });
    vi.mocked(uploadFeishuDriveFile)
      .mockResolvedValueOnce({
        fileToken: "drive-coupon",
        name: "配券.xlsx",
        size: 3,
      })
      .mockResolvedValueOnce({
        fileToken: "drive-whitelist",
        name: "白名单.xlsx",
        size: 3,
      });
    vi.mocked(uploadFeishuBitableAttachment)
      .mockResolvedValueOnce("base-coupon")
      .mockResolvedValueOnce("base-whitelist");
    vi.mocked(updateCouponExcelPilotDraft).mockImplementation(
      async (current, updates) => ({
        ...current,
        ...updates,
        revision: current.revision + 1,
      }),
    );
  });

  afterEach(() => {
    if (originalBaseAppToken === undefined) {
      delete process.env.FEISHU_BASE_APP_TOKEN;
    } else {
      process.env.FEISHU_BASE_APP_TOKEN = originalBaseAppToken;
    }
    vi.clearAllMocks();
  });

  it("keeps the Drive tokens separate from Base attachment tokens", async () => {
    const result = await generateCouponPilotArtifacts(draft as never);

    expect(uploadFeishuDriveFile).toHaveBeenCalledTimes(2);
    expect(uploadFeishuBitableAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        baseAppToken: "app-pilot",
        tableId: "tbl-pilot",
        recordId: "rec-pilot",
        fieldName: "Generated Coupon File",
        name: "配券.xlsx",
      }),
    );
    expect(uploadFeishuBitableAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldName: "Generated Whitelist File",
        name: "白名单.xlsx",
      }),
    );
    expect(updateCouponExcelPilotDraft).toHaveBeenNthCalledWith(
      1,
      draft,
      expect.objectContaining({
        status: "Generating",
        artifacts: [
          expect.objectContaining({ fileToken: "drive-coupon" }),
          expect.objectContaining({ fileToken: "drive-whitelist" }),
        ],
      }),
    );
    expect(result).toMatchObject({
      status: "AwaitingOutputConfirmation",
      artifacts: [
        { fileToken: "drive-coupon", baseFileToken: "base-coupon" },
        {
          fileToken: "drive-whitelist",
          baseFileToken: "base-whitelist",
        },
      ],
    });
  });
});
