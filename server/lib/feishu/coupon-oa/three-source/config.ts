import {
  assertDurableRuntimeConfiguration,
  getFeishuRuntimeStage,
} from "../../../control-plane/runtime-config";

export const couponThreeSourceInvocation = "OA优惠券提报";
export const couponThreeSourceClearInvocation = "clear";

export type CouponThreeSourceGateReason =
  | "disabled"
  | "invalid-allowlist"
  | "not-allowlisted"
  | "storage-unconfigured"
  | "mapping-unconfigured"
  | "renderer-unconfigured"
  | "runtime-stage-unavailable"
  | "chat-context-unverified";

export interface CouponThreeSourceR2Config {
  allowedOpenIds: ReadonlySet<string>;
  taskTableId: string;
  revisionTableId: string;
  driveFolderToken: string;
  mappingId: string;
  mappingVersion: string;
  rendererUrl: string;
}

export type CouponThreeSourceGate =
  | { enabled: true; config: CouponThreeSourceR2Config }
  | { enabled: false; reason: CouponThreeSourceGateReason };

/**
 * The command-intake worker deliberately has a smaller configuration surface
 * than the future material/renderer route. It still requires a durable runtime
 * and the global deployment preflight, while each individual delivery must pass
 * its own trusted direct-message check in the worker.
 */
export type CouponThreeSourceCommandIntakeGateReason =
  | "disabled"
  | "invalid-allowlist"
  | "not-allowlisted"
  | "runtime-stage-unavailable"
  | "chat-context-unverified"
  | "durable-runtime-unconfigured";

export type CouponThreeSourceCommandIntakeGate =
  | { enabled: true }
  | { enabled: false; reason: CouponThreeSourceCommandIntakeGateReason };

function normalizeInvocation(text: string): string {
  return text.replace(/\s+/g, "").replace(/^[/*!！]+/, "");
}

export function isCouponThreeSourceInvocation(text: string): boolean {
  return normalizeInvocation(text) === couponThreeSourceInvocation;
}

export function isCouponThreeSourceClearInvocation(text: string): boolean {
  return (
    normalizeInvocation(text).toLowerCase() === couponThreeSourceClearInvocation
  );
}

function setting(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function configuredOpenIds(): ReadonlySet<string> | undefined {
  const value = setting("FEISHU_COUPON_THREE_SOURCE_R2_ALLOWED_OPEN_IDS");
  if (!value) return undefined;
  const openIds = value
    .split(",")
    .map((openId) => openId.trim())
    .filter(Boolean);
  if (
    !openIds.length ||
    openIds.some((openId) => !/^ou_[a-zA-Z0-9]+$/.test(openId))
  ) {
    return undefined;
  }
  return new Set(openIds);
}

function tableId(name: string): string | undefined {
  const value = setting(name);
  return value && /^tbl[a-zA-Z0-9]+$/.test(value) ? value : undefined;
}

function httpsUrl(name: string): string | undefined {
  const value = setting(name);
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function getCouponThreeSourceCommandIntakeGate(
  openId: string,
): CouponThreeSourceCommandIntakeGate {
  if (setting("FEISHU_COUPON_THREE_SOURCE_R2_ENABLED") !== "true") {
    return { enabled: false, reason: "disabled" };
  }

  const allowedOpenIds = configuredOpenIds();
  if (!allowedOpenIds) return { enabled: false, reason: "invalid-allowlist" };
  if (!allowedOpenIds.has(openId)) {
    return { enabled: false, reason: "not-allowlisted" };
  }

  try {
    if (getFeishuRuntimeStage() !== "r2-draft-only") {
      return { enabled: false, reason: "runtime-stage-unavailable" };
    }
  } catch {
    return { enabled: false, reason: "runtime-stage-unavailable" };
  }
  if (setting("FEISHU_COUPON_THREE_SOURCE_R2_CHAT_CONTEXT_READY") !== "true") {
    return { enabled: false, reason: "chat-context-unverified" };
  }
  try {
    assertDurableRuntimeConfiguration();
  } catch {
    return { enabled: false, reason: "durable-runtime-unconfigured" };
  }
  return { enabled: true };
}

/**
 * R2 remains unavailable unless every infrastructure and governance preflight
 * is explicit. This gate intentionally has no relationship to the legacy OA
 * mode or native-submit controls.
 */
export function getCouponThreeSourceR2Gate(
  openId: string,
): CouponThreeSourceGate {
  if (setting("FEISHU_COUPON_THREE_SOURCE_R2_ENABLED") !== "true") {
    return { enabled: false, reason: "disabled" };
  }

  const allowedOpenIds = configuredOpenIds();
  if (!allowedOpenIds) return { enabled: false, reason: "invalid-allowlist" };
  if (!allowedOpenIds.has(openId)) {
    return { enabled: false, reason: "not-allowlisted" };
  }

  const taskTableId = tableId("FEISHU_COUPON_THREE_SOURCE_R2_TASK_TABLE_ID");
  const revisionTableId = tableId(
    "FEISHU_COUPON_THREE_SOURCE_R2_REVISION_TABLE_ID",
  );
  const driveFolderToken = setting(
    "FEISHU_COUPON_THREE_SOURCE_R2_DRIVE_FOLDER_TOKEN",
  );
  if (!taskTableId || !revisionTableId || !driveFolderToken) {
    return { enabled: false, reason: "storage-unconfigured" };
  }

  const mappingId = setting("FEISHU_COUPON_THREE_SOURCE_R2_MAPPING_ID");
  const mappingVersion = setting(
    "FEISHU_COUPON_THREE_SOURCE_R2_MAPPING_VERSION",
  );
  if (!mappingId || !mappingVersion) {
    return { enabled: false, reason: "mapping-unconfigured" };
  }

  const rendererUrl = httpsUrl("FEISHU_COUPON_THREE_SOURCE_R2_RENDERER_URL");
  if (!rendererUrl) return { enabled: false, reason: "renderer-unconfigured" };

  if (getFeishuRuntimeStage() !== "r2-draft-only") {
    return { enabled: false, reason: "runtime-stage-unavailable" };
  }
  if (setting("FEISHU_COUPON_THREE_SOURCE_R2_CHAT_CONTEXT_READY") !== "true") {
    return { enabled: false, reason: "chat-context-unverified" };
  }

  return {
    enabled: true,
    config: {
      allowedOpenIds,
      taskTableId,
      revisionTableId,
      driveFolderToken,
      mappingId,
      mappingVersion,
      rendererUrl,
    },
  };
}
