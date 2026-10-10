export type FeishuRuntimeStage =
  | "local"
  | "r1-intake"
  | "r2-draft-only"
  | "r3-native-canary";

const stages = new Set<FeishuRuntimeStage>([
  "local",
  "r1-intake",
  "r2-draft-only",
  "r3-native-canary",
]);

export function getFeishuRuntimeStage(): FeishuRuntimeStage {
  const value = process.env.FEISHU_RUNTIME_STAGE?.trim() || "local";
  if (!stages.has(value as FeishuRuntimeStage)) {
    throw new Error(
      "FEISHU_RUNTIME_STAGE must be local, r1-intake, r2-draft-only, or r3-native-canary",
    );
  }
  return value as FeishuRuntimeStage;
}

export function legacyPocEnabled(): boolean {
  const value = process.env.FEISHU_LEGACY_POC_ENABLED?.trim();
  if (!value || value === "false") return false;
  if (value === "true") return true;
  throw new Error("FEISHU_LEGACY_POC_ENABLED must be true or false");
}

export function assertDurableRuntimeConfiguration(): void {
  const stage = getFeishuRuntimeStage();
  if (isCouponThreeSourceAiRecognitionEnabled()) {
    getCouponThreeSourceAiConfig();
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl || !/^postgres(?:ql)?:\/\//iu.test(databaseUrl)) {
      throw new Error(
        "DATABASE_URL must be configured before P0 AI recognition is enabled",
      );
    }
    if (!process.env.FEISHU_WORKER_ID?.trim()) {
      throw new Error(
        "FEISHU_WORKER_ID must be configured before P0 AI recognition is enabled",
      );
    }
  }
  if (stage === "local") return;
  if (legacyPocEnabled()) {
    throw new Error("Legacy POC routes cannot run in a durable runtime stage");
  }
  const appId = process.env.FEISHU_APP_ID?.trim();
  if (!appId) {
    throw new Error("FEISHU_APP_ID must be configured for durable runtime");
  }
  if (stage !== "r1-intake" && !process.env.FEISHU_APP_SECRET?.trim()) {
    throw new Error(
      "FEISHU_APP_SECRET must be configured before durable card effects are enabled",
    );
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//iu.test(databaseUrl)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }
  if (stage === "r1-intake") return;

  const objectStoreBucket = process.env.OBJECT_STORE_BUCKET?.trim();
  const objectStoreEndpoint = process.env.OBJECT_STORE_ENDPOINT?.trim();
  if (!objectStoreBucket || !objectStoreEndpoint) {
    throw new Error(
      "OBJECT_STORE_BUCKET and OBJECT_STORE_ENDPOINT must be configured for durable runtime",
    );
  }
}

import {
  getCouponThreeSourceAiConfig,
  isCouponThreeSourceAiRecognitionEnabled,
} from "../feishu/coupon-oa/three-source/ai-config";
