import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../excel-pilot-assets", () => ({
  loadCouponExcelTemplate: vi.fn(),
}));

import { loadCouponExcelTemplate } from "../excel-pilot-assets";
import { loadCouponThreeSourceTemplates } from "./assets";

describe("coupon three-source template assets", () => {
  beforeEach(() => {
    vi.mocked(loadCouponExcelTemplate)
      .mockResolvedValueOnce(new Uint8Array([1]))
      .mockResolvedValueOnce(new Uint8Array([2]))
      .mockResolvedValueOnce(new Uint8Array([3]));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads all registered templates through the existing server-asset loader", async () => {
    await expect(loadCouponThreeSourceTemplates()).resolves.toEqual({
      regularFullReductionTemplateBytes: new Uint8Array([1]),
      whitelistTemplateBytes: new Uint8Array([2]),
      blacklistTemplateBytes: new Uint8Array([3]),
    });
    expect(loadCouponExcelTemplate).toHaveBeenNthCalledWith(
      1,
      "配券信息表-常规满减券.xlsx",
    );
    expect(loadCouponExcelTemplate).toHaveBeenNthCalledWith(
      2,
      "商品明细白名单-多券档SKU-v1.xlsx",
    );
    expect(loadCouponExcelTemplate).toHaveBeenNthCalledWith(
      3,
      "商品明细黑名单-多券档SKU-v1.xlsx",
    );
  });

  it("propagates the registered template loader failure", async () => {
    vi.mocked(loadCouponExcelTemplate).mockReset();
    vi.mocked(loadCouponExcelTemplate).mockRejectedValueOnce(
      new Error("Excel 试点模板不存在：商品明细白名单-多券档SKU-v1.xlsx"),
    );
    await expect(loadCouponThreeSourceTemplates()).rejects.toThrow(
      "Excel 试点模板不存在",
    );
  });
});
