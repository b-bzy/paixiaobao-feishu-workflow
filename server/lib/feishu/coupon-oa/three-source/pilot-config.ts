export function isCouponThreeSourcePilotEnabled(): boolean {
  return (
    process.env.FEISHU_COUPON_THREE_SOURCE_PILOT_ENABLED?.trim() === "true"
  );
}

function value(name: string): string {
  const result = process.env[name]?.trim();
  if (!result) throw new Error(`${name} is not configured`);
  return result;
}

export function getCouponThreeSourcePilotBaseAppToken(): string {
  return value("FEISHU_COUPON_THREE_SOURCE_PILOT_BASE_APP_TOKEN");
}

export function getCouponThreeSourcePilotTableId(): string {
  const tableId = value("FEISHU_COUPON_THREE_SOURCE_PILOT_TABLE_ID");
  if (!/^tbl[a-zA-Z0-9]+$/.test(tableId)) {
    throw new Error("FEISHU_COUPON_THREE_SOURCE_PILOT_TABLE_ID is invalid");
  }
  return tableId;
}

export function getCouponThreeSourcePilotFolderToken(): string {
  return value("FEISHU_COUPON_THREE_SOURCE_PILOT_FOLDER_TOKEN");
}
