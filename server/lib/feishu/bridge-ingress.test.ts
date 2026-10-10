import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accept: vi.fn(),
  assertRuntimeConfiguration: vi.fn(),
  database: { name: "test-database" },
  getDatabase: vi.fn(),
  getStage: vi.fn(),
  handlePocEvent: vi.fn(),
  receiverConstructor: vi.fn(),
  validate: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("~/lib/control-plane/runtime-config", () => ({
  assertDurableRuntimeConfiguration: mocks.assertRuntimeConfiguration,
  getFeishuRuntimeStage: mocks.getStage,
}));
vi.mock("~/lib/control-plane/postgres-sql-database", () => ({
  getControlPlaneDatabase: mocks.getDatabase,
}));
vi.mock("~/lib/control-plane/postgres-ingress-receiver", () => ({
  PostgresIngressReceiver: class {
    constructor(database: unknown) {
      mocks.receiverConstructor(database);
    }

    accept = mocks.accept;
  },
}));
vi.mock("~/lib/feishu/bridge-auth", () => ({
  BridgeNonceReplayCache: class {},
  validateFeishuBridgeRequest: mocks.validate,
  verifyFeishuBridgeRequest: mocks.verify,
}));
vi.mock("~/lib/feishu/events", () => ({
  handleFeishuPocEvent: mocks.handlePocEvent,
}));

interface FakeBridgeEvent {
  body: string;
  headers: Record<string, string>;
  method: string;
  path: string;
  responseStatus?: number;
}

const payload = JSON.stringify({
  header: {
    event_id: "evt-bridge-001",
    event_type: "im.message.receive_v1",
  },
  event: {
    sender: { sender_id: { open_id: "ou-tester" } },
    message: {
      message_id: "om-bridge-001",
      chat_id: "oc-bridge-001",
      chat_type: "p2p",
      content: '{"text":"/OA优惠券提报"}',
    },
  },
});

function fakeEvent(): FakeBridgeEvent {
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
    path: "/api/feishu/bridge",
  };
}

async function bridgeHandler() {
  return (await import("../../api/feishu/bridge.post")).default as unknown as (
    event: FakeBridgeEvent,
  ) => Promise<Record<string, unknown>>;
}

describe("durable Feishu bridge ingress", () => {
  const originalAppId = process.env.FEISHU_APP_ID;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.FEISHU_APP_ID = "cli-test";
    mocks.getStage.mockReturnValue("r1-intake");
    mocks.getDatabase.mockReturnValue(mocks.database);
    mocks.validate.mockReturnValue({
      keyId: "bridge-test",
      timestamp: "1893456000",
      nonce: "nonce_abcdefghijklmnopqrstuvwxyz",
      bodySha256: "a".repeat(64),
    });
    mocks.accept.mockResolvedValue({
      receiptId: "receipt-001",
      duplicate: false,
    });
    vi.stubGlobal("defineEventHandler", <T>(handler: T) => handler);
    vi.stubGlobal("readRawBody", async (event: FakeBridgeEvent) => event.body);
    vi.stubGlobal(
      "getHeader",
      (event: FakeBridgeEvent, name: string) => event.headers[name],
    );
    vi.stubGlobal("getMethod", (event: FakeBridgeEvent) => event.method);
    vi.stubGlobal(
      "getRequestURL",
      (event: FakeBridgeEvent) => new URL(`https://test${event.path}`),
    );
    vi.stubGlobal(
      "setResponseStatus",
      (event: FakeBridgeEvent, status: number) => {
        event.responseStatus = status;
      },
    );
    vi.stubGlobal(
      "createError",
      (input: { statusCode: number; statusMessage: string }) =>
        Object.assign(new Error(input.statusMessage), input),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalAppId === undefined) delete process.env.FEISHU_APP_ID;
    else process.env.FEISHU_APP_ID = originalAppId;
  });

  it("persists an authenticated delivery and acknowledges it without synchronous POC handling", async () => {
    const event = fakeEvent();

    await expect((await bridgeHandler())(event)).resolves.toEqual({
      code: 0,
      message: "Bridge delivery accepted",
    });

    expect(event.responseStatus).toBe(202);
    expect(mocks.receiverConstructor).toHaveBeenCalledWith(mocks.database);
    expect(mocks.accept).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "cli-test",
        actorOpenId: "ou-tester",
        chatId: "oc-bridge-001",
        chatType: "p2p",
        eventType: "im.message.receive_v1",
        messageId: "om-bridge-001",
        nonce: "nonce_abcdefghijklmnopqrstuvwxyz",
        schemaVersion: "feishu-delivery-v1",
        source: "managed-bridge",
        stableDeliveryId: "evt-bridge-001",
      }),
    );
    expect(mocks.handlePocEvent).not.toHaveBeenCalled();
  });

  it("acknowledges a duplicate delivery without dispatching the legacy handler", async () => {
    mocks.accept.mockResolvedValue({
      receiptId: "receipt-old",
      duplicate: true,
    });
    const event = fakeEvent();

    await expect((await bridgeHandler())(event)).resolves.toEqual({
      code: 0,
      message: "Duplicate bridge delivery accepted",
    });

    expect(event.responseStatus).toBe(202);
    expect(mocks.accept).toHaveBeenCalledTimes(1);
    expect(mocks.handlePocEvent).not.toHaveBeenCalled();
  });

  it("rejects invalid HMAC validation before it reaches durable storage", async () => {
    mocks.validate.mockImplementation(() => {
      throw new Error("Feishu bridge signature is invalid");
    });
    const event = fakeEvent();

    await expect((await bridgeHandler())(event)).resolves.toEqual({
      code: 1,
      message: "Invalid or failed bridge request",
    });

    expect(event.responseStatus).toBe(401);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("rejects an oversized bridge body before HMAC validation or persistence", async () => {
    const event = fakeEvent();
    event.headers["content-length"] = String(1_048_577);

    await expect((await bridgeHandler())(event)).resolves.toEqual({
      code: 1,
      message: "Invalid or failed bridge request",
    });

    expect(event.responseStatus).toBe(413);
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("fails closed when durable runtime configuration is unavailable", async () => {
    mocks.assertRuntimeConfiguration.mockImplementation(() => {
      throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
    });
    const event = fakeEvent();

    await expect((await bridgeHandler())(event)).resolves.toEqual({
      code: 1,
      message: "Invalid or failed bridge request",
    });

    expect(event.responseStatus).toBe(503);
    expect(mocks.accept).not.toHaveBeenCalled();
  });
});
