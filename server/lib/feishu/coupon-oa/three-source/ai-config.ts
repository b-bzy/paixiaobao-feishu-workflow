export interface CouponThreeSourceAiConfig {
  enabled: boolean;
  apiKey?: string;
  baseUrl: "https://api.deepseek.com";
  model: string;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface CouponPublicCalendarConfig {
  enabled: boolean;
  endpoint?: string;
  timeoutMs: number;
  maxResponseBytes: number;
}

const DEFAULT_BASE_URL = "https://api.deepseek.com" as const;
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_CALENDAR_TIMEOUT_MS = 5_000;

function enabled(name: string): boolean {
  return process.env[name]?.trim() === "true";
}

export function isCouponThreeSourceAiRecognitionEnabled(): boolean {
  return enabled("FEISHU_COUPON_THREE_SOURCE_P0_AI_RECOGNITION_ENABLED");
}

function assertAiModeGates(): void {
  const primary = enabled("FEISHU_COUPON_THREE_SOURCE_P0_AI_PRIMARY_ENABLED");
  const shadow = enabled("FEISHU_COUPON_THREE_SOURCE_P0_AI_SHADOW_ENABLED");
  if ((primary || shadow) && !isCouponThreeSourceAiRecognitionEnabled()) {
    throw new Error(
      "AI primary and shadow mode requires FEISHU_COUPON_THREE_SOURCE_P0_AI_RECOGNITION_ENABLED=true",
    );
  }
  if (primary && shadow) {
    throw new Error("AI primary and shadow mode cannot both be true");
  }
}

export function isCouponThreeSourceAiPrimaryEnabled(): boolean {
  assertAiModeGates();
  return enabled("FEISHU_COUPON_THREE_SOURCE_P0_AI_PRIMARY_ENABLED");
}

export function isCouponThreeSourceAiShadowEnabled(): boolean {
  assertAiModeGates();
  return enabled("FEISHU_COUPON_THREE_SOURCE_P0_AI_SHADOW_ENABLED");
}

export function isCouponActivityCopyEnabled(): boolean {
  return enabled("FEISHU_COUPON_THREE_SOURCE_P0_ACTIVITY_COPY_ENABLED");
}

export function getCouponPublicCalendarConfig(): CouponPublicCalendarConfig {
  const calendarEnabled = enabled(
    "FEISHU_COUPON_THREE_SOURCE_P0_PUBLIC_CALENDAR_ENABLED",
  );
  if (!calendarEnabled) {
    return {
      enabled: false,
      timeoutMs: DEFAULT_CALENDAR_TIMEOUT_MS,
      maxResponseBytes: 262_144,
    };
  }
  const rawEndpoint =
    process.env.FEISHU_COUPON_THREE_SOURCE_P0_PUBLIC_CALENDAR_ENDPOINT?.trim();
  if (!rawEndpoint) {
    throw new Error("Public calendar endpoint is not configured");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    throw new Error("Public calendar endpoint is invalid");
  }
  if (endpoint.protocol !== "https:") {
    throw new Error("Public calendar endpoint must use HTTPS");
  }
  const rawTimeout =
    process.env.FEISHU_COUPON_THREE_SOURCE_P0_PUBLIC_CALENDAR_TIMEOUT_MS?.trim() ??
    String(DEFAULT_CALENDAR_TIMEOUT_MS);
  const timeoutMs = Number(rawTimeout);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new Error(
      "Public calendar timeout must be an integer between 1000 and 30000",
    );
  }
  return {
    enabled: true,
    endpoint: endpoint.toString().replace(/\/$/, ""),
    timeoutMs,
    maxResponseBytes: 262_144,
  };
}

function parseTimeoutMs(): number {
  const raw =
    process.env.FEISHU_COUPON_THREE_SOURCE_P0_AI_TIMEOUT_MS?.trim() ??
    String(DEFAULT_TIMEOUT_MS);
  const timeoutMs = Number(raw);
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 120_000
  ) {
    throw new Error(
      "FEISHU_COUPON_THREE_SOURCE_P0_AI_TIMEOUT_MS must be an integer between 1000 and 120000",
    );
  }
  return timeoutMs;
}

export function getCouponThreeSourceAiConfig(): CouponThreeSourceAiConfig {
  const enabled = isCouponThreeSourceAiRecognitionEnabled();
  if (!enabled) {
    return {
      enabled: false,
      baseUrl: DEFAULT_BASE_URL,
      model: DEFAULT_MODEL,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxResponseBytes: 1_048_576,
    };
  }

  const timeoutMs = parseTimeoutMs();
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");
  const baseUrl = (
    process.env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL
  ).replace(/\/$/, "");
  if (baseUrl !== DEFAULT_BASE_URL) {
    throw new Error(
      "DEEPSEEK_BASE_URL must be the official https://api.deepseek.com endpoint",
    );
  }
  const model = process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL;
  if (!model) throw new Error("DEEPSEEK_MODEL is not configured");

  return {
    enabled: true,
    apiKey,
    baseUrl: DEFAULT_BASE_URL,
    model,
    timeoutMs,
    maxResponseBytes: 1_048_576,
  };
}
