import type { InboundDeliveryChatType } from "~/lib/control-plane/contracts";
import { sha256, stableJson } from "~/lib/control-plane/idempotency";
import { PostgresIngressReceiver } from "~/lib/control-plane/postgres-ingress-receiver";
import { getControlPlaneDatabase } from "~/lib/control-plane/postgres-sql-database";
import {
  assertDurableRuntimeConfiguration,
  getFeishuRuntimeStage,
} from "~/lib/control-plane/runtime-config";
import {
  BridgeNonceReplayCache,
  validateFeishuBridgeRequest,
  verifyFeishuBridgeRequest,
} from "~/lib/feishu/bridge-auth";
import { type Envelope, handleFeishuPocEvent } from "~/lib/feishu/events";

const replayCache = new BridgeNonceReplayCache();
const maxBridgeBodyBytes = 1_048_576;

function parseBridgePayload(rawBody: string): Envelope {
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

function durableDelivery(input: { payload: Envelope; receivedAt: string }): {
  appId: string;
  stableDeliveryId: string;
  eventType: string;
  actorOpenId?: string;
  messageId?: string;
  callbackId?: string;
  chatType: InboundDeliveryChatType;
  chatId?: string;
  payload: Record<string, unknown>;
  payloadSha256: string;
  receivedAt: string;
  correlationId: string;
} {
  const appId = process.env.FEISHU_APP_ID?.trim();
  if (!appId) throw new Error("FEISHU_APP_ID is not configured");
  const stableDeliveryId = input.payload.header?.event_id;
  const eventType = input.payload.header?.event_type;
  if (!stableDeliveryId || !eventType) {
    throw new Error(
      "Bridge delivery requires a stable event ID and event type",
    );
  }
  return {
    appId,
    stableDeliveryId,
    eventType,
    actorOpenId:
      input.payload.event?.sender?.sender_id?.open_id ??
      input.payload.operator?.open_id ??
      input.payload.operator?.operator_id?.open_id,
    messageId: input.payload.event?.message?.message_id,
    callbackId:
      eventType === "card.action.trigger" ? stableDeliveryId : undefined,
    chatType:
      input.payload.event?.message?.chat_type === "p2p"
        ? "p2p"
        : input.payload.event?.message?.chat_type === "group"
          ? "group"
          : "unknown",
    chatId: input.payload.event?.message?.chat_id,
    payload: input.payload as unknown as Record<string, unknown>,
    payloadSha256: sha256(stableJson(input.payload)),
    receivedAt: input.receivedAt,
    correlationId: stableDeliveryId,
  };
}

export default defineEventHandler(async (event) => {
  const stage = getFeishuRuntimeStage();
  let authenticated = false;
  try {
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
    const headers = {
      keyId: getHeader(event, "x-feishu-bridge-key-id"),
      timestamp: getHeader(event, "x-feishu-bridge-timestamp"),
      nonce: getHeader(event, "x-feishu-bridge-nonce"),
      bodySha256: getHeader(event, "x-feishu-bridge-body-sha256"),
      signature: getHeader(event, "x-feishu-bridge-signature"),
    };

    if (stage === "local") {
      verifyFeishuBridgeRequest({
        method: getMethod(event),
        path: getRequestURL(event).pathname,
        rawBody,
        headers,
        replayCache,
      });
      authenticated = true;
      const result = await handleFeishuPocEvent(parseBridgePayload(rawBody), {
        trustedIngress: "bridge",
      });
      if (result.kind === "challenge") return { challenge: result.challenge };
      return {
        code: 0,
        message: result.kind === "handled" ? result.message : result.reason,
      };
    }

    const validated = validateFeishuBridgeRequest({
      method: getMethod(event),
      path: getRequestURL(event).pathname,
      rawBody,
      headers,
    });
    authenticated = true;
    assertDurableRuntimeConfiguration();
    const payload = parseBridgePayload(rawBody);
    const accepted = await new PostgresIngressReceiver(
      getControlPlaneDatabase(),
    ).accept({
      ...durableDelivery({
        payload,
        receivedAt: new Date().toISOString(),
      }),
      schemaVersion: "feishu-delivery-v1",
      source: "managed-bridge",
      keyId: validated.keyId,
      nonce: validated.nonce,
    });
    setResponseStatus(event, 202);
    return {
      code: 0,
      message: accepted.duplicate
        ? "Duplicate bridge delivery accepted"
        : "Bridge delivery accepted",
    };
  } catch (error) {
    console.error(
      "Feishu bridge ingress rejected:",
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
    return { code: 1, message: "Invalid or failed bridge request" };
  }
});
