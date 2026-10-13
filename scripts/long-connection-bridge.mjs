import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

import {
  bridgeEventId,
  createBridgeEventEnvelope,
  createSerialForwarder,
  displayBridgeTarget,
  forwardBridgeRequestWithRetries,
  getBridgeRuntimeConfig,
} from "./lib/long-connection-bridge-runtime.mjs";
import { verifyP0DeploymentIdentity } from "./lib/p0-deployment-identity.mjs";

if (
  process.env.HTTP_PROXY ||
  process.env.HTTPS_PROXY ||
  process.env.ALL_PROXY
) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

const config = getBridgeRuntimeConfig(process.env);

const availableConsumers = [
  {
    key: "im.message.receive_v1",
    toPayload(event) {
      return createBridgeEventEnvelope({
        eventType: "im.message.receive_v1",
        event,
      });
    },
  },
  {
    key: "card.action.trigger",
    toPayload(event) {
      return createBridgeEventEnvelope({
        eventType: "card.action.trigger",
        event,
      });
    },
  },
];

const consumers = availableConsumers.filter(({ key }) =>
  config.eventTypes.includes(key),
);
const children = [];
let shuttingDown = false;

function eventId(event) {
  return bridgeEventId(event) ?? "missing";
}

function formatForwardFailure(error) {
  if (error && typeof error === "object" && "code" in error) {
    const status =
      "status" in error && typeof error.status === "number"
        ? ` status=${error.status}`
        : "";
    return `code=${String(error.code)}${status}`;
  }
  return "code=unexpected_error";
}

async function forward({ key, event, toPayload }) {
  const payload = toPayload(event);
  const body = JSON.stringify(payload);
  const result = await forwardBridgeRequestWithRetries({ body, config });

  console.log(
    `[bridge] forwarded ${key}: id=${payload.header?.event_id ?? "missing"} status=${result.status}`,
  );
}

const serialForwarder = createSerialForwarder({
  forward,
  onDrop: (item, error) => {
    console.error(
      `[bridge] forward failed after ${config.forwardAttempts} attempts: event=${item.key} id=${eventId(item.event)} ${formatForwardFailure(error)}`,
    );
  },
});

function startConsumer({ key, toPayload }) {
  const child = spawn(
    "lark-cli",
    ["event", "consume", key, "--as", "bot"],
    {
      env: {
        ...process.env,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  children.push(child);

  createInterface({ input: child.stdout }).on("line", (line) => {
    if (shuttingDown) return;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      console.error(`[bridge] ${key} emitted malformed event data`);
      shutdown(1);
      return;
    }

    console.log(`[bridge] received ${key}: id=${eventId(event)}`);
    serialForwarder.enqueue({ key, event, toPayload });
  });

  let stderrObserved = false;
  createInterface({ input: child.stderr }).on("line", () => {
    if (!shuttingDown && !stderrObserved) {
      stderrObserved = true;
      console.error(`[bridge] ${key} consumer emitted diagnostic output (redacted)`);
    }
  });

  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(
        `[bridge] ${key} stopped unexpectedly (code=${code}, signal=${signal})`,
      );
      shutdown(1);
    }
  });
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 500);
}

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

console.log(
  `[bridge] forwarding Feishu events to ${displayBridgeTarget(config.target)}; event types=${config.eventTypes.join(",")}`,
);
if (config.p0Mode) {
  try {
    const identity = await verifyP0DeploymentIdentity({
      target: config.target,
      expectedGitCommitSha: config.expectedGitCommitSha,
      vercelAutomationBypassSecret:
        process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || undefined,
      timeoutMs: config.forwardTimeoutMs,
    });
    console.log(
      `[bridge] verified P0 deployment revision ${identity.gitCommitSha.slice(0, 7)}`,
    );
  } catch (error) {
    console.error(
      `[bridge] P0 deployment identity check failed: code=${error?.code ?? "unexpected_error"}`,
    );
    process.exit(1);
  }
}
for (const consumer of consumers) startConsumer(consumer);
