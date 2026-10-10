import { createConfiguredDurableCouponControlPlaneWorker } from "~/lib/control-plane/durable-coupon-control-plane-worker";
import {
  assertControlPlaneTickAuthorized,
  ControlPlaneTickAuthorizationError,
  getDurableCouponWorkerRunOptions,
} from "~/lib/control-plane/durable-worker-tick";
import { getFeishuRuntimeStage } from "~/lib/control-plane/runtime-config";
import { isCouponThreeSourceAiRecognitionEnabled } from "~/lib/feishu/coupon-oa/three-source/ai-config";

/**
 * Authenticated scheduler entry point. It remains unavailable in local mode,
 * and every receipt still rechecks its own feature and direct-chat gates.
 */
export default defineEventHandler(async (event) => {
  try {
    if (
      getFeishuRuntimeStage() === "local" &&
      !isCouponThreeSourceAiRecognitionEnabled()
    ) {
      setResponseStatus(event, 503);
      return { code: 1, message: "Durable worker is not installed" };
    }
    assertControlPlaneTickAuthorized(getHeader(event, "authorization"));
    const result =
      await createConfiguredDurableCouponControlPlaneWorker().runOnce(
        getDurableCouponWorkerRunOptions(),
      );
    return { code: 0, result };
  } catch (error) {
    const statusCode =
      error instanceof ControlPlaneTickAuthorizationError
        ? error.statusCode
        : 503;
    console.error(
      "Durable control-plane tick failed:",
      error instanceof Error ? error.name : "Unknown error",
    );
    setResponseStatus(event, statusCode);
    return { code: 1, message: "Durable worker is unavailable" };
  }
});
