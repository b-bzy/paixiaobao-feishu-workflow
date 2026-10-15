import { setTimeout as delay } from "node:timers/promises";

export const defaultTickTimeoutMs = 120_000;
export const defaultTickMaxConsecutiveFailures = 8;
export const defaultTickRetryBackoffBaseMs = 1_000;
export const maxTickRetryBackoffCapMs = 15_000;

export function parseTickTimeoutMs(raw) {
  const value = raw?.trim() || String(defaultTickTimeoutMs);
  if (!/^\d+$/u.test(value)) {
    throw new Error("CONTROL_PLANE_TICK_TIMEOUT_MS must be an integer");
  }
  const parsed = Number(value);
  if (parsed < 1_000 || parsed > 300_000) {
    throw new Error(
      "CONTROL_PLANE_TICK_TIMEOUT_MS must be between 1000 and 300000",
    );
  }
  return parsed;
}

export function nextTickBackoffMs({ baseMs, capMs, consecutiveFailures }) {
  return Math.min(
    capMs,
    baseMs * 2 ** Math.max(0, consecutiveFailures - 1),
  );
}

async function tickOnce({ fetchImpl, tickUrl, headers, tickTimeoutMs }) {
  let response;
  try {
    response = await fetchImpl(tickUrl, {
      method: "POST",
      headers,
      body: "{}",
      signal: AbortSignal.timeout(tickTimeoutMs),
    });
  } catch {
    return { failure: "no_response" };
  }
  if (!response.ok) {
    return { failure: `http_${response.status}` };
  }
  let body;
  try {
    body = await response.json();
  } catch {
    return { failure: "invalid_json" };
  }
  if (body?.code !== 0) {
    return { failure: "unsuccessful_result" };
  }
  return {
    claimed:
      (body.result?.jobs?.claimed ?? 0) + (body.result?.effects?.claimed ?? 0),
    jobsSucceeded: body.result?.jobs?.succeeded ?? 0,
    effectsSucceeded: body.result?.effects?.succeeded ?? 0,
  };
}

export async function runP0WorkerLoop(options) {
  const {
    fetchImpl = fetch,
    sleepImpl = delay,
    tickUrl,
    headers,
    tickTimeoutMs = defaultTickTimeoutMs,
    tickIntervalMs,
    maxConsecutiveFailures = defaultTickMaxConsecutiveFailures,
    retryBackoffBaseMs = defaultTickRetryBackoffBaseMs,
    retryBackoffCapMs = maxTickRetryBackoffCapMs,
    isStopping = () => false,
    log = () => {},
  } = options;

  let consecutiveFailures = 0;
  while (!isStopping()) {
    const result = await tickOnce({
      fetchImpl,
      tickUrl,
      headers,
      tickTimeoutMs,
    });
    if (isStopping()) break;

    if (!result.failure) {
      if (result.claimed > 0) {
        log(
          `processed jobs=${result.jobsSucceeded} effects=${result.effectsSucceeded}`,
        );
      }
      consecutiveFailures = 0;
      await sleepImpl(tickIntervalMs);
      continue;
    }

    consecutiveFailures += 1;
    if (consecutiveFailures >= maxConsecutiveFailures) {
      return { gaveUp: true, reason: result.failure, consecutiveFailures };
    }
    const backoffMs = nextTickBackoffMs({
      baseMs: retryBackoffBaseMs,
      capMs: retryBackoffCapMs,
      consecutiveFailures,
    });
    log(
      `tick failed (${result.failure}); retry ${consecutiveFailures}/${maxConsecutiveFailures} in ${backoffMs}ms`,
    );
    await sleepImpl(backoffMs);
  }
  return { gaveUp: false };
}
