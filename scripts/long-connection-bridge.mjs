import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
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

function stamp() {
  return new Date().toISOString();
}

const log = (message) => console.log(`${stamp()} ${message}`);
const logError = (message) => console.error(`${stamp()} ${message}`);

const execFileAsync = promisify(execFile);

/**
 * The Feishu websocket lives in a shared `lark-cli event _bus` grandchild
 * process. It can die while the consumer wrappers stay alive, silently
 * dropping every event (observed 2026-10-14). This check catches the hard
 * failure modes — bus process gone or no established TCP. A zombie websocket
 * (socket alive, no events) is NOT detectable from outside lark-cli; the
 * canary runbook still requires watching for stalled events.
 */
async function busConnectionHealthy() {
  try {
    const { stdout } = await execFileAsync("pgrep", [
      "-f",
      "lark-cli event _bus",
    ]);
    const pids = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!pids.length) return false;
    for (const pid of pids) {
      try {
        const { stdout: sockets } = await execFileAsync("lsof", [
          "-a",
          "-p",
          pid,
          "-i",
          "tcp",
        ]);
        if (sockets.includes("ESTABLISHED")) return true;
      } catch {
        // lsof exits non-zero when the pid has no TCP sockets.
      }
    }
    return false;
  } catch {
    // pgrep exits non-zero when no bus process exists.
    return false;
  }
}

function startBusWatchdog() {
  let failures = 0;
  const timer = setInterval(async () => {
    if (shuttingDown) return;
    const healthy = await busConnectionHealthy();
    if (healthy) {
      failures = 0;
      return;
    }
    failures += 1;
    if (failures === 1) {
      logError(
        "[bridge] Feishu event bus health check failed; re-checking before exit",
      );
      return;
    }
    logError(
      "[bridge] Feishu event bus is gone (no bus process or TCP); exiting so the P0 runner status reflects reality",
    );
    clearInterval(timer);
    shutdown(1);
  }, 30_000);
  timer.unref?.();
}

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

  log(
    `[bridge] forwarded ${key}: id=${payload.header?.event_id ?? "missing"} status=${result.status}`,
  );
}

const serialForwarder = createSerialForwarder({
  forward,
  onDrop: (item, error) => {
    logError(
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
      logError(`[bridge] ${key} emitted malformed event data`);
      shutdown(1);
      return;
    }

    log(`[bridge] received ${key}: id=${eventId(event)}`);
    serialForwarder.enqueue({ key, event, toPayload });
  });

  createInterface({ input: child.stderr }).on("line", () => {
    // Consumer diagnostics (connect/disconnect notices) are the only external
    // signal of bus reconnects, so log every occurrence — but redact the
    // content: lark-cli stderr is unvetted and may include request details.
    if (!shuttingDown) {
      logError(`[bridge] ${key} consumer emitted diagnostic output (redacted)`);
    }
  });

  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      logError(
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

log(
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
    log(
      `[bridge] verified P0 deployment revision ${identity.gitCommitSha.slice(0, 7)}`,
    );
  } catch (error) {
    logError(
      `[bridge] P0 deployment identity check failed: code=${error?.code ?? "unexpected_error"}`,
    );
    process.exit(1);
  }
}
for (const consumer of consumers) startConsumer(consumer);
startBusWatchdog();
