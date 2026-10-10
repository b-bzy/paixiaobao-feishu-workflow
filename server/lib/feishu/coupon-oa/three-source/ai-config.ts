export interface CouponThreeSourceAiConfig {
  enabled: boolean;
  apiKey?: string;
  baseUrl: "https://api.deepseek.com";
  model: string;
  timeoutMs: number;
  maxResponseBytes: number;
}

const DEFAULT_BASE_URL = "https://api.deepseek.com" as const;
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_TIMEOUT_MS = 45_000;

export function isCouponThreeSourceAiRecognitionEnabled(): boolean {
  return (
    process.env.FEISHU_COUPON_THREE_SOURCE_P0_AI_RECOGNITION_ENABLED?.trim() ===
    "true"
  );
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
