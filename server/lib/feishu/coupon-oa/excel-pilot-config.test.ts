import { afterEach, describe, expect, it } from "vitest";
import {
  getCouponExcelPilotFolderToken,
  getCouponExcelPilotTableId,
  getDeepSeekConfig,
  isCouponExcelPilotEnabled,
  isCouponExcelPilotInvocation,
} from "./excel-pilot-config";

describe("coupon Excel pilot configuration", () => {
  const snapshot = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in snapshot)) delete process.env[key];
    }
    Object.assign(process.env, snapshot);
  });

  it("uses an explicit feature flag and exact normalized invocation", () => {
    delete process.env.FEISHU_COUPON_EXCEL_PILOT_ENABLED;
    expect(isCouponExcelPilotEnabled()).toBe(false);
    process.env.FEISHU_COUPON_EXCEL_PILOT_ENABLED = "true";
    expect(isCouponExcelPilotEnabled()).toBe(true);
    expect(isCouponExcelPilotInvocation(" / 优 惠 券 Excel 试点 ")).toBe(true);
    expect(isCouponExcelPilotInvocation("优惠券Excel")).toBe(false);
  });

  it("validates pilot storage and DeepSeek configuration", () => {
    process.env.FEISHU_COUPON_EXCEL_PILOT_TABLE_ID = "tblExcelPilot";
    process.env.FEISHU_COUPON_EXCEL_PILOT_FOLDER_TOKEN = "fldcnExcelPilot";
    process.env.DEEPSEEK_API_KEY = "test-key";

    expect(getCouponExcelPilotTableId()).toBe("tblExcelPilot");
    expect(getCouponExcelPilotFolderToken()).toBe("fldcnExcelPilot");
    expect(getDeepSeekConfig()).toEqual({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
    });
  });
});
