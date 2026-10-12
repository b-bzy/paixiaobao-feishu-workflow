import { createHash, createHmac, randomBytes } from "node:crypto";

import { parseExpectedGitCommitSha } from "./p0-deployment-identity.mjs";

export const bridgePath = "/api/feishu/bridge";
export const pocBridgePath = "/api/feishu/poc-bridge";
export const supportedBridgeEventTypes = [
  "im.message.receive_v1",
  "card.action.trigger",
];
export const defaultBridgeForwardTimeoutMs = 10_000;

const minimumBridgeForwardTimeoutMs = 1_000;
const maximumBridgeForwardTimeoutMs = 60_000;
const keyIdPattern = /^[A-Za-z0-9._-]{1,64}$/;

export class BridgeConfigurationError extends Error {}

export class BridgeForwardError extends Error {
  constructor(code, options = {}) {
    const message = {
      http_error: `Bridge forward received HTTP ${options.status ?? "unknown"}`,
      network_error: "Bridge forward failed before receiving a response",
      timeout: "Bridge forward timed out",
    }[code];

    super(message);
    this.name = "BridgeForwardError";
    this.code = code;
    this.status = options.status;
  }
}

function requiredEnvironment(environment, name) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new BridgeConfigurationError(
      `${name} must be configured before starting bridge`,
    );
  }
  return value;
}

function isLoopbackHttpTarget(url) {
  return (
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  );
}

function parseBridgeTarget(environment, expectedPath) {
  const value =
    environment.FEISHU_BRIDGE_TARGET_URL?.trim() ??
    environment.FEISHU_PROCESS_URL?.trim();
  if (!value) {
    throw new BridgeConfigurationError(
      "FEISHU_BRIDGE_TARGET_URL must explicitly point to the managed bridge ingress",
    );
  }

  let target;
  try {
    target = new URL(value);
  } catch {
    throw new BridgeConfigurationError(
      "FEISHU_BRIDGE_TARGET_URL is not a valid URL",
    );
  }

  if (target.username || target.password) {
    throw new BridgeConfigurationError(
      "FEISHU_BRIDGE_TARGET_URL must not contain credentials",
    );
  }
  if (target.pathname !== expectedPath || target.search || target.hash) {
    throw new BridgeConfigurationError(
      `FEISHU_BRIDGE_TARGET_URL must use the exact ${expectedPath} path`,
    );
  }
  if (
    target.protocol !== "https:" &&
    (environment.FEISHU_BRIDGE_ALLOW_HTTP !== "true" ||
      !isLoopbackHttpTarget(target))
  ) {
    throw new BridgeConfigurationError(
      "FEISHU_BRIDGE_TARGET_URL must use HTTPS; local HTTP requires FEISHU_BRIDGE_ALLOW_HTTP=true",
    );
  }

  return target;
}

function parseEventTypes(value) {
  if (value === undefined) return [...supportedBridgeEventTypes];

  const eventTypes = value.split(",").map((eventType) => eventType.trim());
  if (!eventTypes.length || eventTypes.some((eventType) => !eventType)) {
    throw new BridgeConfigurationError(
      "FEISHU_BRIDGE_EVENT_TYPES must not be empty",
    );
  }

  const seen = new Set();
  for (const eventType of eventTypes) {
    if (!supportedBridgeEventTypes.includes(eventType)) {
      throw new BridgeConfigurationError(
        "FEISHU_BRIDGE_EVENT_TYPES contains unsupported event type",
      );
    }
    if (seen.has(eventType)) {
      throw new BridgeConfigurationError(
        "FEISHU_BRIDGE_EVENT_TYPES contains duplicate event type",
      );
    }
    seen.add(eventType);
  }

  return eventTypes;
}

function parseForwardTimeout(value) {
  if (value === undefined || value.trim() === "") {
    return defaultBridgeForwardTimeoutMs;
  }
  if (!/^\d+$/u.test(value.trim())) {
    throw new BridgeConfigurationError(
      "FEISHU_BRIDGE_FORWARD_TIMEOUT_MS must be an integer",
    );
  }

  const timeoutMs = Number(value);
  if (
    timeoutMs < minimumBridgeForwardTimeoutMs ||
    timeoutMs > maximumBridgeForwardTimeoutMs
  ) {
    throw new BridgeConfigurationError(
      "FEISHU_BRIDGE_FORWARD_TIMEOUT_MS must be between 1000 and 60000",
    );
  }
  return timeoutMs;
}

function parseBridgeMode(environment) {
  const value = environment.FEISHU_BRIDGE_P0_MODE?.trim();
  if (!value || value === "false") return { p0Mode: false, path: bridgePath };
  if (value === "true") return { p0Mode: true, path: pocBridgePath };
  throw new BridgeConfigurationError(
    "FEISHU_BRIDGE_P0_MODE must be true or false",
  );
}

export function getBridgeRuntimeConfig(environment) {
  const mode = parseBridgeMode(environment);
  const keyId = requiredEnvironment(environment, "FEISHU_BRIDGE_KEY_ID");
  const sharedSecret = requiredEnvironment(
    environment,
    "FEISHU_BRIDGE_SHARED_SECRET",
  );
  if (!keyIdPattern.test(keyId)) {
    throw new BridgeConfigurationError("FEISHU_BRIDGE_KEY_ID is invalid");
  }
  if (sharedSecret.length < 32) {
    throw new BridgeConfigurationError(
      "FEISHU_BRIDGE_SHARED_SECRET must contain at least 32 characters",
    );
  }

  return {
    target: parseBridgeTarget(environment, mode.path),
    keyId,
    sharedSecret,
    vercelAutomationBypassSecret:
      environment.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || undefined,
    eventTypes: parseEventTypes(environment.FEISHU_BRIDGE_EVENT_TYPES),
    forwardTimeoutMs: parseForwardTimeout(
      environment.FEISHU_BRIDGE_FORWARD_TIMEOUT_MS,
    ),
    expectedGitCommitSha: mode.p0Mode
      ? parseExpectedGitCommitSha(environment.FEISHU_P0_EXPECTED_GIT_SHA)
      : undefined,
    p0Mode: mode.p0Mode,
  };
}

function requiredEventField(event, name, message) {
  const value = event?.[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new BridgeConfigurationError(message);
  }
  return value;
}

function jsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

export function bridgeEventId(event) {
  const value =
    event?.event_id ??
    event?.message_id ??
    event?.id ??
    event?.callback_id ??
    event?.action_id;
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function createBridgeEventEnvelope({ eventType, event }) {
  if (eventType === "im.message.receive_v1") {
    const messageId =
      (typeof event?.message_id === "string" && event.message_id.trim()) ||
      (typeof event?.id === "string" && event.id.trim());
    if (!messageId) {
      throw new BridgeConfigurationError(
        "Feishu message event must include a stable message ID",
      );
    }
    const senderId = requiredEventField(
      event,
      "sender_id",
      "Feishu message event must include a sender ID",
    );
    const messageType = requiredEventField(
      event,
      "message_type",
      "Feishu message event must include a message type",
    );
    return {
      header: { event_id: messageId, event_type: eventType },
      event: {
        sender: { sender_id: { open_id: senderId } },
        message: {
          message_id: messageId,
          message_type: messageType,
          chat_type: event.chat_type,
          chat_id: event.chat_id,
          content: JSON.stringify({
            text: typeof event.content === "string" ? event.content : "",
          }),
        },
      },
    };
  }

  if (eventType === "card.action.trigger") {
    const eventId = bridgeEventId(event);
    if (!eventId) {
      throw new BridgeConfigurationError(
        "Feishu card event must include a stable event ID",
      );
    }
    const operatorId = requiredEventField(
      event,
      "operator_id",
      "Feishu card event must include an operator ID",
    );
    const actionValue = jsonObject(event?.action_value);
    const actionName =
      (typeof event?.action_name === "string" && event.action_name.trim()) ||
      (typeof actionValue?.action === "string" && actionValue.action.trim());
    if (!actionName) {
      throw new BridgeConfigurationError(
        "Feishu card event must include an action name",
      );
    }
    return {
      header: { event_id: eventId, event_type: eventType },
      action: {
        name: actionName,
        value: event.action_value,
        form_value: event.form_value,
      },
      operator: { open_id: operatorId },
    };
  }

  throw new BridgeConfigurationError("Feishu bridge event type is unsupported");
}

export function createBridgeSignedHeaders({
  body,
  target,
  keyId,
  sharedSecret,
  timestamp = String(Math.floor(Date.now() / 1_000)),
  nonce = randomBytes(24).toString("base64url"),
}) {
  const bodySha256 = createHash("sha256").update(body).digest("hex");
  const signingInput = [
    "POST",
    target.pathname,
    keyId,
    timestamp,
    nonce,
    bodySha256,
  ].join("\n");
  const signature = createHmac("sha256", sharedSecret)
    .update(signingInput)
    .digest("hex");

  return {
    "content-type": "application/json",
    "x-feishu-bridge-key-id": keyId,
    "x-feishu-bridge-timestamp": timestamp,
    "x-feishu-bridge-nonce": nonce,
    "x-feishu-bridge-body-sha256": bodySha256,
    "x-feishu-bridge-signature": signature,
  };
}

export async function forwardBridgeRequest({
  body,
  config,
  fetchImpl = fetch,
}) {
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    config.forwardTimeoutMs,
  );

  try {
    const response = await fetchImpl(config.target, {
      method: "POST",
      headers: {
        ...createBridgeSignedHeaders({
          body,
          target: config.target,
          keyId: config.keyId,
          sharedSecret: config.sharedSecret,
        }),
        ...(config.vercelAutomationBypassSecret
          ? {
              "x-vercel-protection-bypass":
                config.vercelAutomationBypassSecret,
            }
          : {}),
      },
      body,
      signal: abortController.signal,
    });
    if (!response.ok) {
      throw new BridgeForwardError("http_error", { status: response.status });
    }
    return { status: response.status };
  } catch (error) {
    if (error instanceof BridgeForwardError) throw error;
    if (abortController.signal.aborted) {
      throw new BridgeForwardError("timeout");
    }
    throw new BridgeForwardError("network_error");
  } finally {
    clearTimeout(timeout);
  }
}

export function createSerialForwarder({ forward, onFatal }) {
  let stopped = false;
  let tail = Promise.resolve();

  function enqueue(item) {
    if (stopped) return tail;

    tail = tail
      .then(() => {
        if (stopped) return undefined;
        return forward(item);
      })
      .catch((error) => {
        if (stopped) return;
        stopped = true;
        onFatal(item, error);
      });
    return tail;
  }

  return {
    enqueue,
    drain: () => tail,
    stopped: () => stopped,
  };
}

export function displayBridgeTarget(target) {
  return `${target.protocol}//${target.host}${target.pathname}`;
}
