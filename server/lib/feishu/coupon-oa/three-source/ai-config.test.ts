import { afterEach, describe, expect, it } from "vitest";
import {
  getCouponThreeSourceAiConfig,
  isCouponThreeSourceAiRecognitionEnabled,
} from "./ai-config";

const ENV_KEYS = [
  "FEISHU_COUPON_THREE_SOURCE_P0_AI_RECOGNITION_ENABLED",
  "FEISHU_COUPON_THREE_SOURCE_P0_AI_TIMEOUT_MS",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODEL",
] as const;
const original = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("coupon three-source AI config", () => {
  it("defaults to disabled without reading an API key", () => {
    delete process.env.FEISHU_COUPON_THREE_SOURCE_P0_AI_RECOGNITION_ENABLED;
    delete process.env.DEEPSEEK_API_KEY;

    expect(isCouponThreeSourceAiRecognitionEnabled()).toBe(false);
    expect(getCouponThreeSourceAiConfig()).toEqual({
      enabled: false,
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      timeoutMs: 45_000,
      maxResponseBytes: 1_048_576,
    });
  });

  it("requires the key only when explicitly enabled", () => {
    process.env.FEISHU_COUPON_THREE_SOURCE_P0_AI_RECOGNITION_ENABLED = "true";
    delete process.env.DEEPSEEK_API_KEY;
    expect(() => getCouponThreeSourceAiConfig()).toThrow(
      "DEEPSEEK_API_KEY is not configured",
    );
  });

  it("accepts only the official HTTPS endpoint and bounded timeout", () => {
    process.env.FEISHU_COUPON_THREE_SOURCE_P0_AI_RECOGNITION_ENABLED = "true";
    process.env.DEEPSEEK_API_KEY = "test-secret-that-must-not-leak";
    process.env.DEEPSEEK_BASE_URL = "http://example.com";
    expect(() => getCouponThreeSourceAiConfig()).toThrow(
      "DEEPSEEK_BASE_URL must be the official",
    );

    process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.com/";
    process.env.FEISHU_COUPON_THREE_SOURCE_P0_AI_TIMEOUT_MS = "999";
    expect(() => getCouponThreeSourceAiConfig()).toThrow(
      "must be an integer between 1000 and 120000",
    );

    process.env.FEISHU_COUPON_THREE_SOURCE_P0_AI_TIMEOUT_MS = "120000";
    expect(getCouponThreeSourceAiConfig()).toMatchObject({
      enabled: true,
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      timeoutMs: 120_000,
    });
  });

  it("does not include a secret in validation errors", () => {
    const secret = "never-include-this-value";
    process.env.FEISHU_COUPON_THREE_SOURCE_P0_AI_RECOGNITION_ENABLED = "true";
    process.env.DEEPSEEK_API_KEY = secret;
    process.env.DEEPSEEK_BASE_URL = "https://invalid.example";

    let message = "";
    try {
      getCouponThreeSourceAiConfig();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain(secret);
  });
});
