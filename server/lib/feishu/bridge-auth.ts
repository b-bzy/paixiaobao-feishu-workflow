import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const feishuBridgePath = "/api/feishu/bridge";
export const feishuPocBridgePath = "/api/feishu/poc-bridge";
const maxBridgeClockSkewSeconds = 5 * 60;
const noncePattern = /^[A-Za-z0-9_-]{16,128}$/;
const keyIdPattern = /^[A-Za-z0-9._-]{1,64}$/;
const signaturePattern = /^[a-f0-9]{64}$/;

export interface FeishuBridgeConfig {
  keyId: string;
  sharedSecret: string;
}

export interface FeishuBridgeRequestHeaders {
  keyId?: string;
  timestamp?: string;
  nonce?: string;
  bodySha256?: string;
  signature?: string;
}

export interface ValidatedFeishuBridgeRequest {
  keyId: string;
  timestamp: string;
  nonce: string;
  bodySha256: string;
}

export interface VerifyFeishuBridgeRequestInput {
  method: string;
  path: string;
  rawBody: string;
  headers: FeishuBridgeRequestHeaders;
  expectedPath?: string;
  now?: number;
  replayCache?: BridgeNonceReplayCache;
}

export function getFeishuBridgeConfig(): FeishuBridgeConfig {
  const keyId = process.env.FEISHU_BRIDGE_KEY_ID?.trim();
  const sharedSecret = process.env.FEISHU_BRIDGE_SHARED_SECRET?.trim();
  if (!keyId || !keyIdPattern.test(keyId)) {
    throw new Error("FEISHU_BRIDGE_KEY_ID is not configured or invalid");
  }
  if (!sharedSecret || sharedSecret.length < 32) {
    throw new Error(
      "FEISHU_BRIDGE_SHARED_SECRET must contain at least 32 characters",
    );
  }
  return { keyId, sharedSecret };
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function feishuBridgeSigningInput(input: {
  method: string;
  path: string;
  keyId: string;
  timestamp: string;
  nonce: string;
  bodySha256: string;
}): string {
  return [
    input.method.toUpperCase(),
    input.path,
    input.keyId,
    input.timestamp,
    input.nonce,
    input.bodySha256,
  ].join("\n");
}

export function signFeishuBridgeRequest(input: {
  sharedSecret: string;
  method: string;
  path: string;
  keyId: string;
  timestamp: string;
  nonce: string;
  bodySha256: string;
}): string {
  return createHmac("sha256", input.sharedSecret)
    .update(feishuBridgeSigningInput(input))
    .digest("hex");
}

function sameSignature(expected: string, received: string): boolean {
  if (!signaturePattern.test(received) || expected.length !== received.length) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(received, "hex"),
  );
}

/**
 * This cache is only an in-process replay guard for the development/test
 * ingress. A managed bridge still needs a durable nonce/event receipt store
 * before it satisfies the R1/R2 rollout gate.
 */
export class BridgeNonceReplayCache {
  private readonly entries = new Map<string, number>();

  hasOrAdd(input: { keyId: string; nonce: string; now: number }): boolean {
    const expiresAt = input.now + maxBridgeClockSkewSeconds * 1_000;
    for (const [key, expires] of this.entries) {
      if (expires <= input.now) this.entries.delete(key);
    }
    const key = `${input.keyId}:${input.nonce}`;
    if (this.entries.has(key)) return true;
    this.entries.set(key, expiresAt);
    return false;
  }
}

export function validateFeishuBridgeRequest(
  input: VerifyFeishuBridgeRequestInput,
): ValidatedFeishuBridgeRequest {
  const config = getFeishuBridgeConfig();
  const keyId = input.headers.keyId?.trim() ?? "";
  const timestamp = input.headers.timestamp?.trim() ?? "";
  const nonce = input.headers.nonce?.trim() ?? "";
  const bodySha256 = input.headers.bodySha256?.trim().toLowerCase() ?? "";
  const signature = input.headers.signature?.trim().toLowerCase() ?? "";

  if (input.path !== (input.expectedPath ?? feishuBridgePath)) {
    throw new Error("Feishu bridge request path is invalid");
  }
  if (keyId !== config.keyId) {
    throw new Error("Feishu bridge key ID is unknown");
  }
  if (!/^\d{10}$/.test(timestamp)) {
    throw new Error("Feishu bridge timestamp is invalid");
  }
  const now = input.now ?? Date.now();
  if (Math.abs(now / 1_000 - Number(timestamp)) > maxBridgeClockSkewSeconds) {
    throw new Error("Feishu bridge timestamp is outside the allowed window");
  }
  if (!noncePattern.test(nonce)) {
    throw new Error("Feishu bridge nonce is invalid");
  }
  const actualBodySha256 = sha256(input.rawBody);
  if (bodySha256 !== actualBodySha256) {
    throw new Error("Feishu bridge body digest does not match");
  }
  const expectedSignature = signFeishuBridgeRequest({
    sharedSecret: config.sharedSecret,
    method: input.method,
    path: input.path,
    keyId,
    timestamp,
    nonce,
    bodySha256,
  });
  if (!sameSignature(expectedSignature, signature)) {
    throw new Error("Feishu bridge signature is invalid");
  }
  return { keyId, timestamp, nonce, bodySha256 };
}

/**
 * Development-only validation including an in-process replay cache. Durable
 * runtime ingress must call `validateFeishuBridgeRequest` and persist nonce
 * consumption in the same database transaction as the delivery receipt.
 */
export function verifyFeishuBridgeRequest(
  input: VerifyFeishuBridgeRequestInput,
): void {
  const validated = validateFeishuBridgeRequest(input);
  const now = input.now ?? Date.now();
  if (
    input.replayCache?.hasOrAdd({
      keyId: validated.keyId,
      nonce: validated.nonce,
      now,
    })
  ) {
    throw new Error("Feishu bridge nonce has already been used");
  }
}
