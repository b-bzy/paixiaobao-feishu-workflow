import { afterEach, describe, expect, it } from "vitest";
import {
  couponThreeSourceInvocation,
  getCouponThreeSourceCommandIntakeGate,
  getCouponThreeSourceR2Gate,
  isCouponThreeSourceInvocation,
} from "./config";

const names = [
  "FEISHU_COUPON_THREE_SOURCE_R2_ENABLED",
  "FEISHU_COUPON_THREE_SOURCE_R2_ALLOWED_OPEN_IDS",
  "FEISHU_COUPON_THREE_SOURCE_R2_TASK_TABLE_ID",
  "FEISHU_COUPON_THREE_SOURCE_R2_REVISION_TABLE_ID",
  "FEISHU_COUPON_THREE_SOURCE_R2_DRIVE_FOLDER_TOKEN",
  "FEISHU_COUPON_THREE_SOURCE_R2_MAPPING_ID",
  "FEISHU_COUPON_THREE_SOURCE_R2_MAPPING_VERSION",
  "FEISHU_COUPON_THREE_SOURCE_R2_RENDERER_URL",
  "FEISHU_RUNTIME_STAGE",
  "FEISHU_LEGACY_POC_ENABLED",
  "DATABASE_URL",
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "OBJECT_STORE_BUCKET",
  "OBJECT_STORE_ENDPOINT",
  "FEISHU_COUPON_THREE_SOURCE_R2_CHAT_CONTEXT_READY",
] as const;

function resetEnvironment(): void {
  for (const name of names) delete process.env[name];
}

function configureCompleteGate(): void {
  process.env.FEISHU_COUPON_THREE_SOURCE_R2_ENABLED = "true";
  process.env.FEISHU_COUPON_THREE_SOURCE_R2_ALLOWED_OPEN_IDS = "ou_threesource";
  process.env.FEISHU_COUPON_THREE_SOURCE_R2_TASK_TABLE_ID = "tblTasks";
  process.env.FEISHU_COUPON_THREE_SOURCE_R2_REVISION_TABLE_ID = "tblRevisions";
  process.env.FEISHU_COUPON_THREE_SOURCE_R2_DRIVE_FOLDER_TOKEN = "fldThree";
  process.env.FEISHU_COUPON_THREE_SOURCE_R2_MAPPING_ID =
    "regular-full-reduction";
  process.env.FEISHU_COUPON_THREE_SOURCE_R2_MAPPING_VERSION = "v1";
  process.env.FEISHU_COUPON_THREE_SOURCE_R2_RENDERER_URL =
    "https://renderer.example.test/render";
  process.env.FEISHU_RUNTIME_STAGE = "r2-draft-only";
  process.env.FEISHU_COUPON_THREE_SOURCE_R2_CHAT_CONTEXT_READY = "true";
}

afterEach(resetEnvironment);

describe("coupon three-source R2 config", () => {
  it("uses the one target invocation with existing safe normalization", () => {
    expect(couponThreeSourceInvocation).toBe("OA优惠券提报");
    expect(isCouponThreeSourceInvocation(" /OA 优惠券 提报 ")).toBe(true);
    expect(isCouponThreeSourceInvocation("OA优惠券填报")).toBe(false);
    expect(isCouponThreeSourceInvocation("OA优惠券三源填报")).toBe(false);
    expect(isCouponThreeSourceInvocation("我想 OA优惠券提报")).toBe(false);
  });

  it("is disabled by default before checking any runtime configuration", () => {
    expect(getCouponThreeSourceR2Gate("ou_threesource")).toEqual({
      enabled: false,
      reason: "disabled",
    });
  });

  it("allows only the configured durable command-intake preflight", () => {
    process.env.FEISHU_COUPON_THREE_SOURCE_R2_ENABLED = "true";
    process.env.FEISHU_COUPON_THREE_SOURCE_R2_ALLOWED_OPEN_IDS =
      "ou_threesource";
    process.env.FEISHU_RUNTIME_STAGE = "r2-draft-only";
    process.env.FEISHU_APP_ID = "cli_test";
    process.env.FEISHU_APP_SECRET = "test-secret";
    process.env.FEISHU_COUPON_THREE_SOURCE_R2_CHAT_CONTEXT_READY = "true";
    process.env.DATABASE_URL = "postgresql://example.test/coupon";
    process.env.OBJECT_STORE_BUCKET = "coupon-artifacts";
    process.env.OBJECT_STORE_ENDPOINT = "https://objects.example.test";

    expect(getCouponThreeSourceCommandIntakeGate("ou_threesource")).toEqual({
      enabled: true,
    });

    delete process.env.OBJECT_STORE_ENDPOINT;
    expect(getCouponThreeSourceCommandIntakeGate("ou_threesource")).toEqual({
      enabled: false,
      reason: "durable-runtime-unconfigured",
    });
  });

  it("requires a non-empty exact open-ID allowlist", () => {
    process.env.FEISHU_COUPON_THREE_SOURCE_R2_ENABLED = "true";
    expect(getCouponThreeSourceR2Gate("ou_threesource")).toEqual({
      enabled: false,
      reason: "invalid-allowlist",
    });

    process.env.FEISHU_COUPON_THREE_SOURCE_R2_ALLOWED_OPEN_IDS =
      "not-an-open-id";
    expect(getCouponThreeSourceR2Gate("ou_threesource")).toEqual({
      enabled: false,
      reason: "invalid-allowlist",
    });
  });

  it("rejects an allowlist outsider before exposing runtime prerequisites", () => {
    process.env.FEISHU_COUPON_THREE_SOURCE_R2_ENABLED = "true";
    process.env.FEISHU_COUPON_THREE_SOURCE_R2_ALLOWED_OPEN_IDS =
      "ou_threesource";
    expect(getCouponThreeSourceR2Gate("ou_other")).toEqual({
      enabled: false,
      reason: "not-allowlisted",
    });
  });

  it("requires dedicated storage, mapping, renderer, durable stage, and chat gates", () => {
    configureCompleteGate();
    expect(getCouponThreeSourceR2Gate("ou_threesource")).toMatchObject({
      enabled: true,
      config: {
        taskTableId: "tblTasks",
        revisionTableId: "tblRevisions",
        driveFolderToken: "fldThree",
      },
    });

    process.env.FEISHU_COUPON_THREE_SOURCE_R2_CHAT_CONTEXT_READY = "false";
    expect(getCouponThreeSourceR2Gate("ou_threesource")).toEqual({
      enabled: false,
      reason: "chat-context-unverified",
    });
  });
});
