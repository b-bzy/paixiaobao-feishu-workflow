import { execFileSync } from "node:child_process";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

import { verifyP0DeploymentIdentity } from "./lib/p0-deployment-identity.mjs";
import { assertExclusiveP0Worker } from "./lib/p0-worker-process-guard.mjs";
import {
  defaultTickMaxConsecutiveFailures,
  defaultTickRetryBackoffBaseMs,
  maxTickRetryBackoffCapMs,
  runP0WorkerLoop,
} from "./lib/p0-control-plane-worker-loop.mjs";

if (
  process.env.HTTP_PROXY ||
  process.env.HTTPS_PROXY ||
  process.env.ALL_PROXY
) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

assertExclusiveP0Worker({
  processList: execFileSync("ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
  }),
});

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

function boundedIntegerEnvironment(name, { minimum, maximum, fallback }) {
  const value = process.env[name]?.trim() || String(fallback);
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${name} must be an integer`);
  }
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function p0Target() {
  const value = requiredEnvironment("FEISHU_BRIDGE_TARGET_URL");
  const target = new URL(value);
  if (
    target.protocol !== "https:" ||
    target.pathname !== "/api/feishu/poc-bridge" ||
    target.search ||
    target.hash ||
    target.username ||
    target.password
  ) {
    throw new Error(
      "FEISHU_BRIDGE_TARGET_URL must be the exact HTTPS P0 bridge URL",
    );
  }
  return target;
}

const target = p0Target();
const expectedGitCommitSha = requiredEnvironment(
  "FEISHU_P0_EXPECTED_GIT_SHA",
);
const tickToken = requiredEnvironment("CONTROL_PLANE_TICK_TOKEN");
const vercelAutomationBypassSecret =
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || undefined;
const tickUrl = new URL("/api/internal/control-plane/tick", target.origin);
const tickIntervalMs = boundedIntegerEnvironment(
  "CONTROL_PLANE_TICK_INTERVAL_MS",
  { minimum: 1_000, maximum: 60_000, fallback: 3_000 },
);
const maxConsecutiveFailures = boundedIntegerEnvironment(
  "CONTROL_PLANE_TICK_MAX_CONSECUTIVE_FAILURES",
  { minimum: 1, maximum: 100, fallback: defaultTickMaxConsecutiveFailures },
);
const retryBackoffBaseMs = boundedIntegerEnvironment(
  "CONTROL_PLANE_TICK_RETRY_BACKOFF_MS",
  {
    minimum: 250,
    maximum: maxTickRetryBackoffCapMs,
    fallback: defaultTickRetryBackoffBaseMs,
  },
);

const identity = await verifyP0DeploymentIdentity({
  target,
  expectedGitCommitSha,
  vercelAutomationBypassSecret,
});
console.log(
  `[worker] verified P0 deployment revision ${identity.gitCommitSha.slice(0, 7)}`,
);

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

const outcome = await runP0WorkerLoop({
  tickUrl,
  headers: {
    authorization: `Bearer ${tickToken}`,
    "content-type": "application/json",
    ...(vercelAutomationBypassSecret
      ? { "x-vercel-protection-bypass": vercelAutomationBypassSecret }
      : {}),
  },
  tickIntervalMs,
  maxConsecutiveFailures,
  retryBackoffBaseMs,
  isStopping: () => stopping,
  log: (line) => console.log(`[worker] ${line}`),
});

if (outcome.gaveUp) {
  console.error(
    `[worker] giving up after ${outcome.consecutiveFailures} consecutive tick failures (${outcome.reason})`,
  );
  process.exit(1);
}
