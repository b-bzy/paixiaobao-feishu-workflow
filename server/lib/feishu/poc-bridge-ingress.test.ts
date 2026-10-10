import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStage: vi.fn(),
  handlePocEvent: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("~/lib/control-plane/runtime-config", () => ({
  getFeishuRuntimeStage: mocks.getStage,
}));
vi.mock("~/lib/feishu/bridge-auth", () => ({
  BridgeNonceReplayCache: class {},
  feishuPocBridgePath: "/api/feishu/poc-bridge",
  verifyFeishuBridgeRequest: mocks.verify,
}));
vi.mock("~/lib/feishu/events", () => ({
  handleFeishuPocEvent: mocks.handlePocEvent,
}));

interface FakePocBridgeEvent {
  body: string;
  headers: Record<string, string>;
  method: string;
  path: string;
  responseStatus?: number;
}

const payload = JSON.stringify({
  header: {
    event_id: "om-poc-bridge-001",
    event_type: "im.message.receive_v1",
  },
  event: {
    sender: { sender_id: { open_id: "ou-tester" } },
    message: {
      content: '{"text":"/OA优惠券提报"}',
      message_id: "om-poc-bridge-001",
      message_type: "text",
    },
  },
});

function fakeEvent(): FakePocBridgeEvent {
  return {
    body: payload,
    headers: {
      "x-feishu-bridge-key-id": "bridge-test",
      "x-feishu-bridge-timestamp": "1893456000",
      "x-feishu-bridge-nonce": "nonce_abcdefghijklmnopqrstuvwxyz",
      "x-feishu-bridge-body-sha256": "a".repeat(64),
      "x-feishu-bridge-signature": "b".repeat(64),
    },
    method: "POST",
    path: "/api/feishu/poc-bridge",
  };
}

async function handler() {
  return (await import("../../api/feishu/poc-bridge.post"))
    .default as unknown as (
    event: FakePocBridgeEvent,
  ) => Promise<Record<string, unknown>>;
}

describe("three-source P0 long-connection bridge ingress", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getStage.mockReturnValue("local");
    mocks.handlePocEvent.mockResolvedValue({
      kind: "handled",
      message: "Coupon three-source pilot opened",
    });
    vi.stubGlobal("defineEventHandler", <T>(value: T) => value);
    vi.stubGlobal(
      "readRawBody",
      async (event: FakePocBridgeEvent) => event.body,
    );
    vi.stubGlobal(
      "getHeader",
      (event: FakePocBridgeEvent, name: string) => event.headers[name],
    );
    vi.stubGlobal("getMethod", (event: FakePocBridgeEvent) => event.method);
    vi.stubGlobal(
      "getRequestURL",
      (event: FakePocBridgeEvent) => new URL(`https://test${event.path}`),
    );
    vi.stubGlobal(
      "setResponseStatus",
      (event: FakePocBridgeEvent, status: number) => {
        event.responseStatus = status;
      },
    );
    vi.stubGlobal(
      "createError",
      (input: { statusCode: number; statusMessage: string }) =>
        Object.assign(new Error(input.statusMessage), input),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("forwards a verified local bridge delivery to the P0-only handler", async () => {
    const event = fakeEvent();

    await expect((await handler())(event)).resolves.toEqual({
      code: 0,
      message: "Coupon three-source pilot opened",
    });

    expect(mocks.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedPath: "/api/feishu/poc-bridge",
        path: "/api/feishu/poc-bridge",
        rawBody: payload,
      }),
    );
    expect(mocks.handlePocEvent).toHaveBeenCalledWith(JSON.parse(payload), {
      trustedIngress: "bridge",
      threeSourceOnly: true,
    });
  });

  it("rejects an invalid signature before dispatch", async () => {
    mocks.verify.mockImplementation(() => {
      throw new Error("Feishu bridge signature is invalid");
    });
    const event = fakeEvent();

    await expect((await handler())(event)).resolves.toEqual({
      code: 1,
      message: "Invalid or failed P0 bridge request",
    });

    expect(event.responseStatus).toBe(401);
    expect(mocks.handlePocEvent).not.toHaveBeenCalled();
  });

  it("fails closed outside the local P0 runtime", async () => {
    mocks.getStage.mockReturnValue("r1-intake");
    const event = fakeEvent();

    await expect((await handler())(event)).resolves.toEqual({
      code: 1,
      message: "Invalid or failed P0 bridge request",
    });

    expect(event.responseStatus).toBe(503);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.handlePocEvent).not.toHaveBeenCalled();
  });

  it("rejects an oversized body before verification", async () => {
    const event = fakeEvent();
    event.headers["content-length"] = String(1_048_577);

    await expect((await handler())(event)).resolves.toEqual({
      code: 1,
      message: "Invalid or failed P0 bridge request",
    });

    expect(event.responseStatus).toBe(413);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.handlePocEvent).not.toHaveBeenCalled();
  });
});
