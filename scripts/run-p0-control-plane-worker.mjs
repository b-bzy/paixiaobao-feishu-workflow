import { setTimeout as delay } from "node:timers/promises";

import { verifyP0DeploymentIdentity } from "./lib/p0-deployment-identity.mjs";

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured`);
  return value;
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

function intervalMs() {
  const value = process.env.CONTROL_PLANE_TICK_INTERVAL_MS?.trim() || "3000";
  if (!/^\d+$/u.test(value)) {
    throw new Error("CONTROL_PLANE_TICK_INTERVAL_MS must be an integer");
  }
  const parsed = Number(value);
  if (parsed < 1000 || parsed > 60_000) {
    throw new Error(
      "CONTROL_PLANE_TICK_INTERVAL_MS must be between 1000 and 60000",
    );
  }
  return parsed;
}

const target = p0Target();
const expectedGitCommitSha = requiredEnvironment(
  "FEISHU_P0_EXPECTED_GIT_SHA",
);
const tickToken = requiredEnvironment("CONTROL_PLANE_TICK_TOKEN");
const vercelAutomationBypassSecret =
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || undefined;
const tickUrl = new URL("/api/internal/control-plane/tick", target.origin);
const tickIntervalMs = intervalMs();

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

while (!stopping) {
  const headers = {
    authorization: `Bearer ${tickToken}`,
    "content-type": "application/json",
  };
  if (vercelAutomationBypassSecret) {
    headers["x-vercel-protection-bypass"] = vercelAutomationBypassSecret;
  }

  let response;
  try {
    response = await fetch(tickUrl, {
      method: "POST",
      headers,
      body: "{}",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    console.error("[worker] control-plane tick failed before receiving a response");
    process.exit(1);
  }
  if (!response.ok) {
    console.error(`[worker] control-plane tick received HTTP ${response.status}`);
    process.exit(1);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    console.error("[worker] control-plane tick returned invalid JSON");
    process.exit(1);
  }
  if (body?.code !== 0) {
    console.error("[worker] control-plane tick returned an unsuccessful result");
    process.exit(1);
  }

  const claimed =
    (body.result?.jobs?.claimed ?? 0) + (body.result?.effects?.claimed ?? 0);
  if (claimed > 0) {
    console.log(
      `[worker] processed jobs=${body.result.jobs?.succeeded ?? 0} effects=${body.result.effects?.succeeded ?? 0}`,
    );
  }
  await delay(tickIntervalMs);
}
