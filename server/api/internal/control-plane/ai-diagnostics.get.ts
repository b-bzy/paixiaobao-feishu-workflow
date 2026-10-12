import { getRecentCouponAiDiagnostics } from "~/lib/control-plane/coupon-ai-diagnostics";
import {
  assertControlPlaneTickAuthorized,
  ControlPlaneTickAuthorizationError,
} from "~/lib/control-plane/durable-worker-tick";

export default defineEventHandler(async (event) => {
  try {
    assertControlPlaneTickAuthorized(getHeader(event, "authorization"));
    return { code: 0, result: await getRecentCouponAiDiagnostics() };
  } catch (error) {
    const statusCode =
      error instanceof ControlPlaneTickAuthorizationError
        ? error.statusCode
        : 503;
    setResponseStatus(event, statusCode);
    return { code: 1, message: "AI diagnostics are unavailable" };
  }
});
