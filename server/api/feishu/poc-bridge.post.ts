import { getFeishuRuntimeStage } from "~/lib/control-plane/runtime-config";
import {
  BridgeNonceReplayCache,
  feishuPocBridgePath,
  verifyFeishuBridgeRequest,
} from "~/lib/feishu/bridge-auth";
import { type Envelope, handleFeishuPocEvent } from "~/lib/feishu/events";

const replayCache = new BridgeNonceReplayCache();
const maxBridgeBodyBytes = 1_048_576;

function parseEnvelope(rawBody: string): Envelope {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid JSON" });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid bridge envelope",
    });
  }
  return payload as Envelope;
}

export default defineEventHandler(async (event) => {
  let authenticated = false;
  try {
    if (getFeishuRuntimeStage() !== "local") {
      throw createError({
        statusCode: 503,
        statusMessage: "P0 bridge is available only in local runtime",
      });
    }
    const declaredLength = getHeader(event, "content-length");
    if (
      declaredLength &&
      (!/^\d+$/u.test(declaredLength) ||
        Number(declaredLength) > maxBridgeBodyBytes)
    ) {
      throw createError({
        statusCode: 413,
        statusMessage: "Bridge body too large",
      });
    }
    const rawBody = await readRawBody(event, "utf8");
    if (!rawBody) {
      throw createError({ statusCode: 400, statusMessage: "Missing body" });
    }
    if (Buffer.byteLength(rawBody, "utf8") > maxBridgeBodyBytes) {
      throw createError({
        statusCode: 413,
        statusMessage: "Bridge body too large",
      });
    }
    verifyFeishuBridgeRequest({
      method: getMethod(event),
      path: getRequestURL(event).pathname,
      expectedPath: feishuPocBridgePath,
      rawBody,
      headers: {
        keyId: getHeader(event, "x-feishu-bridge-key-id"),
        timestamp: getHeader(event, "x-feishu-bridge-timestamp"),
        nonce: getHeader(event, "x-feishu-bridge-nonce"),
        bodySha256: getHeader(event, "x-feishu-bridge-body-sha256"),
        signature: getHeader(event, "x-feishu-bridge-signature"),
      },
      replayCache,
    });
    authenticated = true;
    const result = await handleFeishuPocEvent(parseEnvelope(rawBody), {
      trustedIngress: "bridge",
      threeSourceOnly: true,
    });
    if (result.kind === "challenge") {
      throw createError({
        statusCode: 400,
        statusMessage: "P0 bridge does not support URL challenges",
      });
    }
    return {
      code: 0,
      message: result.kind === "handled" ? result.message : result.reason,
    };
  } catch (error) {
    console.error(
      "Feishu P0 bridge ingress rejected:",
      error instanceof Error ? error.message : "Unknown error",
    );
    const requestedStatus =
      error &&
      typeof error === "object" &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : undefined;
    setResponseStatus(event, requestedStatus ?? (authenticated ? 503 : 401));
    return { code: 1, message: "Invalid or failed P0 bridge request" };
  }
});
