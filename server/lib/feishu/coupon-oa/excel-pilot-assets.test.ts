import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("nitropack/runtime", () => ({ useStorage: vi.fn() }));

import { useStorage } from "nitropack/runtime";
import { loadCouponPilotTemplate } from "./excel-pilot-assets";

describe("coupon Excel pilot assets", () => {
  const getItemRaw = vi.fn();

  beforeEach(() => {
    vi.mocked(useStorage).mockReturnValue({ getItemRaw } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reads the coupon template from Nitro's server-asset namespace", async () => {
    getItemRaw.mockResolvedValue(new Uint8Array([1, 2, 3]));

    await expect(loadCouponPilotTemplate({ kind: "coupon" })).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(useStorage).toHaveBeenCalledWith("assets:server");
    expect(getItemRaw).toHaveBeenCalledWith(
      "coupon-excel:配券信息表-常规满减券.xlsx",
    );
  });

  it("reads the whitelist template from the same bundled namespace", async () => {
    getItemRaw.mockResolvedValue(new Uint8Array([4, 5, 6]));

    await expect(
      loadCouponPilotTemplate({ kind: "whitelist" }),
    ).resolves.toEqual(new Uint8Array([4, 5, 6]));
    expect(getItemRaw).toHaveBeenCalledWith(
      "coupon-excel:商品明细白名单-自动填报演练.xlsx",
    );
  });

  it("keeps the template-missing error explicit", async () => {
    getItemRaw.mockResolvedValue(undefined);

    await expect(loadCouponPilotTemplate({ kind: "coupon" })).rejects.toThrow(
      "Excel 试点模板不存在：配券信息表-常规满减券.xlsx",
    );
  });
});
