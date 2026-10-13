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

/**
 * HTTPS web origin of the Feishu tenant (e.g. https://example.feishu.cn),
 * used to build in-card Drive file preview links. Unset or invalid values
 * disable the preview entry instead of breaking card rendering.
 */
export function getCouponThreeSourcePreviewWebBaseUrl(): string | undefined {
  const raw = process.env.FEISHU_WEB_BASE_URL?.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}
