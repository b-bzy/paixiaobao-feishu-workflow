import { describe, expect, it, vi } from "vitest";

import {
  BridgeForwardError,
  bridgePath,
  createBridgeEventEnvelope,
  createBridgeSignedHeaders,
  createSerialForwarder,
  forwardBridgeRequest,
  getBridgeRuntimeConfig,
  pocBridgePath,
  supportedBridgeEventTypes,
} from "./long-connection-bridge-runtime.mjs";

const sharedSecret = "test-bridge-secret-at-least-thirty-two-characters";

function environment(overrides = {}) {
  return {
    FEISHU_BRIDGE_TARGET_URL: "https://preview.example.com/api/feishu/bridge",
    FEISHU_BRIDGE_KEY_ID: "r05-test-v1",
    FEISHU_BRIDGE_SHARED_SECRET: sharedSecret,
    ...overrides,
  };
}

describe("long connection bridge runtime", () => {
  it("uses the exact HTTPS bridge target and both supported consumers by default", () => {
    const config = getBridgeRuntimeConfig(environment());

    expect(config.target.href).toBe("https://preview.example.com/api/feishu/bridge");
    expect(config.target.pathname).toBe(bridgePath);
    expect(config.eventTypes).toEqual(supportedBridgeEventTypes);
    expect(config.forwardTimeoutMs).toBe(10_000);
    expect(config.vercelAutomationBypassSecret).toBeUndefined();
  });

  it("trims the optional Vercel automation bypass secret", () => {
    const config = getBridgeRuntimeConfig(
      environment({
        VERCEL_AUTOMATION_BYPASS_SECRET: "  p0-vercel-bypass-secret  ",
      }),
    );

    expect(config.vercelAutomationBypassSecret).toBe(
      "p0-vercel-bypass-secret",
    );
  });

  it("requires the dedicated P0 bridge path when P0 mode is enabled", () => {
    const config = getBridgeRuntimeConfig(
      environment({
        FEISHU_BRIDGE_P0_MODE: "true",
        FEISHU_P0_EXPECTED_GIT_SHA:
          "74bd72e319582a1bf05be812bff2d2508208c2e3",
        FEISHU_BRIDGE_TARGET_URL:
          "https://preview.example.com/api/feishu/poc-bridge",
      }),
    );

    expect(config.target.pathname).toBe(pocBridgePath);
    expect(config.expectedGitCommitSha).toBe(
      "74bd72e319582a1bf05be812bff2d2508208c2e3",
    );
  });

  it("rejects a durable bridge target while P0 mode is enabled", () => {
    expect(() =>
      getBridgeRuntimeConfig(
        environment({
          FEISHU_BRIDGE_P0_MODE: "true",
          FEISHU_P0_EXPECTED_GIT_SHA:
            "74bd72e319582a1bf05be812bff2d2508208c2e3",
        }),
      ),
    ).toThrow(`exact ${pocBridgePath} path`);
  });

  it("requires a full expected Git SHA in P0 mode", () => {
    expect(() =>
      getBridgeRuntimeConfig(
        environment({
          FEISHU_BRIDGE_P0_MODE: "true",
          FEISHU_BRIDGE_TARGET_URL:
            "https://preview.example.com/api/feishu/poc-bridge",
        }),
      ),
    ).toThrow("FEISHU_P0_EXPECTED_GIT_SHA");
  });

  it("accepts an explicit message-only consumer list for R0.5", () => {
    const config = getBridgeRuntimeConfig(
      environment({ FEISHU_BRIDGE_EVENT_TYPES: "im.message.receive_v1" }),
    );

    expect(config.eventTypes).toEqual(["im.message.receive_v1"]);
  });

  it.each([
    ["", "must not be empty"],
    ["unknown.event", "contains unsupported event type"],
    ["im.message.receive_v1,im.message.receive_v1", "contains duplicate event type"],
  ])("rejects unsafe event type configuration %j", (eventTypes, message) => {
    expect(() =>
      getBridgeRuntimeConfig(
        environment({ FEISHU_BRIDGE_EVENT_TYPES: eventTypes }),
      ),
    ).toThrow(message);
  });

  it("converts a CLI file event while retaining its message ID", () => {
    expect(
      createBridgeEventEnvelope({
        eventType: "im.message.receive_v1",
        event: {
          chat_id: "oc-test",
          chat_type: "p2p",
          content: "业务白名单.xlsx",
          message_id: "om-file",
          message_type: "file",
          sender_id: "ou-owner",
        },
      }),
    ).toEqual({
      header: {
        event_id: "om-file",
        event_type: "im.message.receive_v1",
      },
      event: {
        sender: { sender_id: { open_id: "ou-owner" } },
        message: {
          chat_id: "oc-test",
          chat_type: "p2p",
          content: JSON.stringify({ text: "业务白名单.xlsx" }),
          message_id: "om-file",
          message_type: "file",
        },
      },
    });
  });

  it("uses the CLI card event_id as the callback idempotency key", () => {
    expect(
      createBridgeEventEnvelope({
        eventType: "card.action.trigger",
        event: {
          action_name: "coupon_three_source_no_blacklist_confirm",
          action_value: '{"pilotRecordId":"rec-pilot","revision":3}',
          event_id: "evt-card",
          form_value: "{}",
          operator_id: "ou-owner",
        },
      }),
    ).toEqual({
      header: { event_id: "evt-card", event_type: "card.action.trigger" },
      action: {
        form_value: "{}",
        name: "coupon_three_source_no_blacklist_confirm",
        value: '{"pilotRecordId":"rec-pilot","revision":3}',
      },
      operator: { open_id: "ou-owner" },
    });
  });

  it("reads the action name from the current CLI action_value payload", () => {
    expect(
      createBridgeEventEnvelope({
        eventType: "card.action.trigger",
        event: {
          action_value:
            '{"action":"coupon_three_source_no_blacklist_confirm","pilotRecordId":"rec-pilot","revision":3}',
          event_id: "evt-current-cli-card",
          operator_id: "ou-owner",
        },
      }),
    ).toEqual({
      header: {
        event_id: "evt-current-cli-card",
        event_type: "card.action.trigger",
      },
      action: {
        form_value: undefined,
        name: "coupon_three_source_no_blacklist_confirm",
        value:
          '{"action":"coupon_three_source_no_blacklist_confirm","pilotRecordId":"rec-pilot","revision":3}',
      },
      operator: { open_id: "ou-owner" },
    });
  });

  it("fails closed when neither card action field contains an action name", () => {
    expect(() =>
      createBridgeEventEnvelope({
        eventType: "card.action.trigger",
        event: {
          action_value: '{"pilotRecordId":"rec-pilot","revision":3}',
          event_id: "evt-card-without-action",
          operator_id: "ou-owner",
        },
      }),
    ).toThrow("action name");
  });

  it("fails closed when a CLI event lacks its stable ID", () => {
    expect(() =>
      createBridgeEventEnvelope({
        eventType: "card.action.trigger",
        event: {
          action_name: "coupon_three_source_no_blacklist_confirm",
          operator_id: "ou-owner",
        },
      }),
    ).toThrow("stable event ID");
  });

  it.each([
    ["https://preview.example.com/api/feishu/process", "exact /api/feishu/bridge path"],
    ["https://user:password@preview.example.com/api/feishu/bridge", "must not contain credentials"],
    ["https://preview.example.com/api/feishu/bridge?unexpected=true", "exact /api/feishu/bridge path"],
  ])("rejects unsafe bridge target %s", (target, message) => {
    expect(() =>
      getBridgeRuntimeConfig(
        environment({ FEISHU_BRIDGE_TARGET_URL: target }),
      ),
    ).toThrow(message);
  });

  it.each([
    ["999", "between 1000 and 60000"],
    ["60001", "between 1000 and 60000"],
    ["ten-seconds", "must be an integer"],
  ])("rejects unsafe forward timeout %s", (timeout, message) => {
    expect(() =>
      getBridgeRuntimeConfig(
        environment({ FEISHU_BRIDGE_FORWARD_TIMEOUT_MS: timeout }),
      ),
    ).toThrow(message);
  });

  it("signs the exact HMAC contract without exposing the secret", () => {
    const config = getBridgeRuntimeConfig(environment());
    const body = '{"header":{"event_id":"evt_test"}}';
    const headers = createBridgeSignedHeaders({
      body,
      target: config.target,
      keyId: config.keyId,
      sharedSecret: config.sharedSecret,
      timestamp: "1728518400",
      nonce: "fixed-nonce",
    });

    expect(headers).toMatchObject({
      "content-type": "application/json",
      "x-feishu-bridge-key-id": "r05-test-v1",
      "x-feishu-bridge-timestamp": "1728518400",
      "x-feishu-bridge-nonce": "fixed-nonce",
      "x-feishu-bridge-body-sha256":
        "56124880dbf6fa5fba0aa7b323bfdb357f3c70a9fd5b941608ad817ef2490e18",
      "x-feishu-bridge-signature":
        "6940140ce2011abd690160aeac90ca35d8dc844eddcf62a45f08e60ef24e7381",
    });
    expect(JSON.stringify(headers)).not.toContain(sharedSecret);
  });

  it("classifies non-2xx responses without reading their sensitive body", async () => {
    const config = getBridgeRuntimeConfig(environment());
    const text = vi.fn(async () => "sensitive response body");

    await expect(
      forwardBridgeRequest({
        body: "{}",
        config,
        fetchImpl: vi.fn(async () => ({ ok: false, status: 503, text })),
      }),
    ).rejects.toMatchObject({
      code: "http_error",
      status: 503,
      message: "Bridge forward received HTTP 503",
    });

    expect(text).not.toHaveBeenCalled();
  });

  it("adds the Vercel automation bypass header only when configured", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 202 }));
    const config = getBridgeRuntimeConfig(
      environment({
        VERCEL_AUTOMATION_BYPASS_SECRET: "p0-vercel-bypass-secret",
      }),
    );

    await forwardBridgeRequest({ body: "{}", config, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({
      "x-vercel-protection-bypass": "p0-vercel-bypass-secret",
    });

    const unprotectedFetch = vi.fn(async () => ({ ok: true, status: 202 }));
    await forwardBridgeRequest({
      body: "{}",
      config: getBridgeRuntimeConfig(environment()),
      fetchImpl: unprotectedFetch,
    });
    expect(unprotectedFetch.mock.calls[0][1].headers).not.toHaveProperty(
      "x-vercel-protection-bypass",
    );
  });

  it("classifies network failures without preserving transport details", async () => {
    const config = getBridgeRuntimeConfig(environment());

    await expect(
      forwardBridgeRequest({
        body: "{}",
        config,
        fetchImpl: vi.fn(async () => {
          throw new Error("connection failed with sensitive diagnostic");
        }),
      }),
    ).rejects.toMatchObject({
      code: "network_error",
      message: "Bridge forward failed before receiving a response",
    });
  });

  it("aborts a hung forward at the configured timeout", async () => {
    vi.useFakeTimers();
    const config = getBridgeRuntimeConfig(
      environment({ FEISHU_BRIDGE_FORWARD_TIMEOUT_MS: "1000" }),
    );
    const fetchImpl = vi.fn(
      (_target, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    const result = forwardBridgeRequest({ body: "{}", config, fetchImpl });
    const expectation = expect(result).rejects.toMatchObject({
      code: "timeout",
      message: "Bridge forward timed out",
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await expectation;
    vi.useRealTimers();
  });

  it("stops the serial queue after its first forwarding failure", async () => {
    const forwarded = [];
    const fatal = vi.fn();
    const queue = createSerialForwarder({
      forward: async ({ id }) => {
        forwarded.push(id);
        if (id === "first") throw new BridgeForwardError("network_error");
      },
      onFatal: fatal,
    });

    queue.enqueue({ id: "first" });
    queue.enqueue({ id: "second" });
    await queue.drain();

    expect(forwarded).toEqual(["first"]);
    expect(fatal).toHaveBeenCalledTimes(1);
    expect(fatal.mock.calls[0][0]).toMatchObject({ id: "first" });
    expect(fatal.mock.calls[0][1]).toMatchObject({ code: "network_error" });
    expect(queue.stopped()).toBe(true);
  });
});
