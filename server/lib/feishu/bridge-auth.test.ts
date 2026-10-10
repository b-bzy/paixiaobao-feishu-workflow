import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BridgeNonceReplayCache,
  feishuBridgePath,
  feishuPocBridgePath,
  sha256,
  signFeishuBridgeRequest,
  verifyFeishuBridgeRequest,
} from "./bridge-auth";

const now = Date.UTC(2030, 0, 1, 0, 0, 0);
const body = JSON.stringify({ header: { event_id: "event-1" } });

function validHeaders(
  overrides: Record<string, string | undefined> = {},
  path = feishuBridgePath,
) {
  const timestamp = String(Math.floor(now / 1_000));
  const nonce = "nonce_for_bridge_test_123";
  const bodySha256 = sha256(body);
  const signature = signFeishuBridgeRequest({
    sharedSecret: "0123456789abcdef0123456789abcdef",
    method: "POST",
    path,
    keyId: "bridge-test",
    timestamp,
    nonce,
    bodySha256,
  });
  return {
    keyId: "bridge-test",
    timestamp,
    nonce,
    bodySha256,
    signature,
    ...overrides,
  };
}

describe("Feishu bridge request authentication", () => {
  const originalKeyId = process.env.FEISHU_BRIDGE_KEY_ID;
  const originalSecret = process.env.FEISHU_BRIDGE_SHARED_SECRET;

  beforeEach(() => {
    process.env.FEISHU_BRIDGE_KEY_ID = "bridge-test";
    process.env.FEISHU_BRIDGE_SHARED_SECRET =
      "0123456789abcdef0123456789abcdef";
  });

  afterEach(() => {
    if (originalKeyId === undefined) delete process.env.FEISHU_BRIDGE_KEY_ID;
    else process.env.FEISHU_BRIDGE_KEY_ID = originalKeyId;
    if (originalSecret === undefined)
      delete process.env.FEISHU_BRIDGE_SHARED_SECRET;
    else process.env.FEISHU_BRIDGE_SHARED_SECRET = originalSecret;
  });

  it("accepts a complete, current, correctly signed request", () => {
    expect(() =>
      verifyFeishuBridgeRequest({
        method: "POST",
        path: feishuBridgePath,
        rawBody: body,
        headers: validHeaders(),
        now,
      }),
    ).not.toThrow();
  });

  it("validates the P0 bridge against its dedicated path", () => {
    expect(() =>
      verifyFeishuBridgeRequest({
        method: "POST",
        path: feishuPocBridgePath,
        expectedPath: feishuPocBridgePath,
        rawBody: body,
        headers: validHeaders({}, feishuPocBridgePath),
        now,
      }),
    ).not.toThrow();
  });

  it("rejects missing bridge configuration", () => {
    delete process.env.FEISHU_BRIDGE_SHARED_SECRET;
    expect(() =>
      verifyFeishuBridgeRequest({
        method: "POST",
        path: feishuBridgePath,
        rawBody: body,
        headers: validHeaders(),
        now,
      }),
    ).toThrow("FEISHU_BRIDGE_SHARED_SECRET");
  });

  it.each([
    ["keyId", "key ID is unknown"],
    ["bodySha256", "body digest does not match"],
    ["signature", "signature is invalid"],
  ] as const)("rejects a request with an invalid %s", (field, message) => {
    const invalid =
      field === "bodySha256"
        ? "0".repeat(64)
        : field === "signature"
          ? "f".repeat(64)
          : "unknown-key";
    expect(() =>
      verifyFeishuBridgeRequest({
        method: "POST",
        path: feishuBridgePath,
        rawBody: body,
        headers: validHeaders({ [field]: invalid }),
        now,
      }),
    ).toThrow(message);
  });

  it("rejects stale timestamps and invalid paths", () => {
    expect(() =>
      verifyFeishuBridgeRequest({
        method: "POST",
        path: feishuBridgePath,
        rawBody: body,
        headers: validHeaders({
          timestamp: String(Math.floor(now / 1_000) - 301),
        }),
        now,
      }),
    ).toThrow("outside the allowed window");

    expect(() =>
      verifyFeishuBridgeRequest({
        method: "POST",
        path: "/api/feishu/process",
        rawBody: body,
        headers: validHeaders(),
        now,
      }),
    ).toThrow("path is invalid");
  });

  it("rejects a repeated valid nonce within the local replay window", () => {
    const replayCache = new BridgeNonceReplayCache();
    const request = {
      method: "POST",
      path: feishuBridgePath,
      rawBody: body,
      headers: validHeaders(),
      now,
      replayCache,
    };
    expect(() => verifyFeishuBridgeRequest(request)).not.toThrow();
    expect(() => verifyFeishuBridgeRequest(request)).toThrow(
      "nonce has already been used",
    );
  });
});
