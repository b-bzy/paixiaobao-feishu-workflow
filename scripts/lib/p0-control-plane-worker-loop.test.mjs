import { describe, expect, it } from "vitest";

import { nextTickBackoffMs, runP0WorkerLoop } from "./p0-control-plane-worker-loop.mjs";

const tickUrl =
  "https://preview.example.com/api/internal/control-plane/tick";

function successResponse(overrides = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      code: 0,
      result: {
        jobs: { claimed: 0, succeeded: 0 },
        effects: { claimed: 0, succeeded: 0 },
        ...overrides,
      },
    }),
  };
}

function countingFetch(responses) {
  let calls = 0;
  return {
    calls: () => calls,
    fetchImpl: async () => {
      const response = responses[Math.min(calls, responses.length - 1)];
      calls += 1;
      return response;
    },
  };
}

describe("p0 control plane worker loop", () => {
  it("grows the backoff exponentially and caps it", () => {
    expect(
      [1, 2, 3, 4, 5, 6].map((consecutiveFailures) =>
        nextTickBackoffMs({
          baseMs: 1_000,
          capMs: 15_000,
          consecutiveFailures,
        }),
      ),
    ).toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000]);
  });

  it("keeps ticking after a transient failure and resets the streak", async () => {
    const sleeps = [];
    const { calls, fetchImpl } = countingFetch([
      Promise.reject(new Error("cold start")),
      successResponse(),
    ]);
    const logs = [];

    const outcome = await runP0WorkerLoop({
      fetchImpl,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
      tickUrl,
      headers: { authorization: "Bearer tick-token" },
      tickIntervalMs: 3,
      maxConsecutiveFailures: 2,
      isStopping: () => sleeps.length >= 2,
      log: (line) => logs.push(line),
    });

    expect(outcome).toEqual({ gaveUp: false });
    expect(calls()).toBe(2);
    expect(sleeps).toEqual([1_000, 3]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("no_response");
  });

  it("gives up only after the configured consecutive failures", async () => {
    const sleeps = [];
    const { calls, fetchImpl } = countingFetch([
      Promise.reject(new Error("connection refused")),
    ]);

    const outcome = await runP0WorkerLoop({
      fetchImpl,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
      tickUrl,
      headers: {},
      tickIntervalMs: 3,
      maxConsecutiveFailures: 3,
      isStopping: () => false,
      log: () => {},
    });

    expect(outcome).toEqual({
      gaveUp: true,
      reason: "no_response",
      consecutiveFailures: 3,
    });
    expect(calls()).toBe(3);
    expect(sleeps).toEqual([1_000, 2_000]);
  });

  it.each([
    [
      "http_500",
      { ok: false, status: 500, text: async () => "sensitive body" },
    ],
    [
      "invalid_json",
      { ok: true, status: 200, json: async () => Promise.reject(new Error("bad body")) },
    ],
    ["unsuccessful_result", { ok: true, status: 200, json: async () => ({ code: 1 }) }],
  ])("treats %s as a retryable tick failure", async (reason, response) => {
    const { calls, fetchImpl } = countingFetch([response]);

    const outcome = await runP0WorkerLoop({
      fetchImpl,
      sleepImpl: async () => {},
      tickUrl,
      headers: {},
      tickIntervalMs: 3,
      maxConsecutiveFailures: 1,
      isStopping: () => false,
      log: () => {},
    });

    expect(outcome).toEqual({
      gaveUp: true,
      reason,
      consecutiveFailures: 1,
    });
    expect(calls()).toBe(1);
  });

  it("resets the failure streak after each successful tick", async () => {
    const sleeps = [];
    const { fetchImpl } = countingFetch([
      Promise.reject(new Error("timeout")),
      successResponse(),
      { ok: false, status: 500, text: async () => "sensitive body" },
    ]);

    const outcome = await runP0WorkerLoop({
      fetchImpl,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
      tickUrl,
      headers: {},
      tickIntervalMs: 3,
      maxConsecutiveFailures: 2,
      isStopping: () => sleeps.length >= 3,
      log: () => {},
    });

    expect(outcome).toEqual({ gaveUp: false });
    expect(sleeps).toEqual([1_000, 3, 1_000]);
  });

  it("logs processed job counts only when something was claimed", async () => {
    const sleeps = [];
    const logs = [];
    const { fetchImpl } = countingFetch([
      successResponse({
        jobs: { claimed: 2, succeeded: 2 },
        effects: { claimed: 1, succeeded: 1 },
      }),
      successResponse(),
    ]);

    const outcome = await runP0WorkerLoop({
      fetchImpl,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
      tickUrl,
      headers: {},
      tickIntervalMs: 3,
      isStopping: () => sleeps.length >= 2,
      log: (line) => logs.push(line),
    });

    expect(outcome).toEqual({ gaveUp: false });
    expect(logs).toEqual(["processed jobs=2 effects=1"]);
  });

  it("exits without ticking when already asked to stop", async () => {
    const { calls, fetchImpl } = countingFetch([successResponse()]);

    const outcome = await runP0WorkerLoop({
      fetchImpl,
      sleepImpl: async () => {},
      tickUrl,
      headers: {},
      tickIntervalMs: 3,
      isStopping: () => true,
      log: () => {},
    });

    expect(outcome).toEqual({ gaveUp: false });
    expect(calls()).toBe(0);
  });
});
