export const couponExcelPilotInvocation = "优惠券Excel试点";

function normalized(text: string): string {
  return text.replace(/\s+/g, "").replace(/^[/*!！]+/, "");
}

export function isCouponExcelPilotInvocation(text: string): boolean {
  return normalized(text) === couponExcelPilotInvocation;
}

export function isCouponExcelPilotEnabled(): boolean {
  return process.env.FEISHU_COUPON_EXCEL_PILOT_ENABLED?.trim() === "true";
}

function value(name: string): string {
  const result = process.env[name]?.trim();
  if (!result) throw new Error(`${name} is not configured`);
  return result;
}

export function getCouponExcelPilotTableId(): string {
  const tableId = value("FEISHU_COUPON_EXCEL_PILOT_TABLE_ID");
  if (!/^tbl[a-zA-Z0-9]+$/.test(tableId)) {
    throw new Error("FEISHU_COUPON_EXCEL_PILOT_TABLE_ID is invalid");
  }
  return tableId;
}

export function getCouponExcelPilotFolderToken(): string {
  return value("FEISHU_COUPON_EXCEL_PILOT_FOLDER_TOKEN");
}

export function getDeepSeekConfig(): {
  apiKey: string;
  baseUrl: string;
  model: string;
} {
  return {
    apiKey: value("DEEPSEEK_API_KEY"),
    baseUrl: (
      process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com"
    ).replace(/\/$/, ""),
    model: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat",
  };
}
