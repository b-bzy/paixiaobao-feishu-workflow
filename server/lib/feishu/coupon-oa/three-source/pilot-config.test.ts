import { afterEach, describe, expect, it } from "vitest";
import {
  getCouponThreeSourcePilotBaseAppToken,
  getCouponThreeSourcePilotFolderToken,
  getCouponThreeSourcePilotTableId,
  isCouponThreeSourcePilotEnabled,
} from "./pilot-config";

const environment = { ...process.env };

afterEach(() => {
  process.env = { ...environment };
});

describe("coupon three-source pilot config", () => {
  it("is disabled unless the exact pilot flag is true", () => {
    delete process.env.FEISHU_COUPON_THREE_SOURCE_PILOT_ENABLED;
    expect(isCouponThreeSourcePilotEnabled()).toBe(false);

    process.env.FEISHU_COUPON_THREE_SOURCE_PILOT_ENABLED = "TRUE";
    expect(isCouponThreeSourcePilotEnabled()).toBe(false);

    process.env.FEISHU_COUPON_THREE_SOURCE_PILOT_ENABLED = "true";
    expect(isCouponThreeSourcePilotEnabled()).toBe(true);
  });

  it("requires isolated Base, table, and Drive configuration", () => {
    delete process.env.FEISHU_COUPON_THREE_SOURCE_PILOT_BASE_APP_TOKEN;
    expect(() => getCouponThreeSourcePilotBaseAppToken()).toThrow(
      "is not configured",
    );
    process.env.FEISHU_COUPON_THREE_SOURCE_PILOT_BASE_APP_TOKEN =
      "appThreeSource";
    expect(getCouponThreeSourcePilotBaseAppToken()).toBe("appThreeSource");

    delete process.env.FEISHU_COUPON_THREE_SOURCE_PILOT_TABLE_ID;
    expect(() => getCouponThreeSourcePilotTableId()).toThrow(
      "is not configured",
    );

    process.env.FEISHU_COUPON_THREE_SOURCE_PILOT_TABLE_ID = "bad-table";
    expect(() => getCouponThreeSourcePilotTableId()).toThrow("is invalid");

    process.env.FEISHU_COUPON_THREE_SOURCE_PILOT_TABLE_ID = "tblThreeSource";
    expect(getCouponThreeSourcePilotTableId()).toBe("tblThreeSource");

    delete process.env.FEISHU_COUPON_THREE_SOURCE_PILOT_FOLDER_TOKEN;
    expect(() => getCouponThreeSourcePilotFolderToken()).toThrow(
      "is not configured",
    );
    process.env.FEISHU_COUPON_THREE_SOURCE_PILOT_FOLDER_TOKEN =
      "fldThreeSource";
    expect(getCouponThreeSourcePilotFolderToken()).toBe("fldThreeSource");
  });
});
