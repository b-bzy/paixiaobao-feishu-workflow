import { afterEach, describe, expect, it } from "vitest";
import {
  assertDurableRuntimeConfiguration,
  getFeishuRuntimeStage,
  legacyPocEnabled,
} from "./runtime-config";

const names = [
  "FEISHU_RUNTIME_STAGE",
  "FEISHU_LEGACY_POC_ENABLED",
  "DATABASE_URL",
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "OBJECT_STORE_BUCKET",
  "OBJECT_STORE_ENDPOINT",
  "FEISHU_WORKER_ID",
  "FEISHU_COUPON_THREE_SOURCE_P0_AI_RECOGNITION_ENABLED",
  "DEEPSEEK_API_KEY",
] as const;

const original = Object.fromEntries(
  names.map((name) => [name, process.env[name]]),
);

afterEach(() => {
  for (const name of names) {
    const value = original[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("durable runtime configuration", () => {
  it("defaults to local and keeps legacy POC disabled", () => {
    delete process.env.FEISHU_RUNTIME_STAGE;
    delete process.env.FEISHU_LEGACY_POC_ENABLED;
    expect(getFeishuRuntimeStage()).toBe("local");
    expect(legacyPocEnabled()).toBe(false);
    expect(() => assertDurableRuntimeConfiguration()).not.toThrow();
  });

  it("requires PostgreSQL, object storage, and no legacy route in durable stages", () => {
    process.env.FEISHU_RUNTIME_STAGE = "r2-draft-only";
    expect(() => assertDurableRuntimeConfiguration()).toThrow("FEISHU_APP_ID");

    process.env.FEISHU_APP_ID = "cli_test";
    expect(() => assertDurableRuntimeConfiguration()).toThrow(
      "FEISHU_APP_SECRET",
    );

    process.env.FEISHU_APP_SECRET = "test-secret";
    expect(() => assertDurableRuntimeConfiguration()).toThrow("DATABASE_URL");

    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.OBJECT_STORE_BUCKET = "coupon-test";
    process.env.OBJECT_STORE_ENDPOINT = "https://objects.example.test";
    expect(() => assertDurableRuntimeConfiguration()).not.toThrow();

    process.env.FEISHU_LEGACY_POC_ENABLED = "true";
    expect(() => assertDurableRuntimeConfiguration()).toThrow(
      "Legacy POC routes",
    );
  });

  it("fails closed for unknown stages and flags", () => {
    process.env.FEISHU_RUNTIME_STAGE = "prod";
    expect(() => getFeishuRuntimeStage()).toThrow("FEISHU_RUNTIME_STAGE");
    process.env.FEISHU_RUNTIME_STAGE = "local";
    process.env.FEISHU_LEGACY_POC_ENABLED = "maybe";
    expect(() => legacyPocEnabled()).toThrow("must be true or false");
  });

  it("requires PostgreSQL and a worker identity when P0 AI is enabled locally", () => {
    process.env.FEISHU_RUNTIME_STAGE = "local";
    process.env.FEISHU_COUPON_THREE_SOURCE_P0_AI_RECOGNITION_ENABLED = "true";
    process.env.DEEPSEEK_API_KEY = "test-key";
    delete process.env.DATABASE_URL;
    expect(() => assertDurableRuntimeConfiguration()).toThrow("DATABASE_URL");
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    expect(() => assertDurableRuntimeConfiguration()).toThrow(
      "FEISHU_WORKER_ID",
    );
    process.env.FEISHU_WORKER_ID = "worker-1";
    expect(() => assertDurableRuntimeConfiguration()).not.toThrow();
  });
});
