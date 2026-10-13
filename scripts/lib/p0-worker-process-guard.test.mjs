import { describe, expect, it } from "vitest";

import {
  assertExclusiveP0Worker,
  conflictingP0WorkerProcesses,
} from "./p0-worker-process-guard.mjs";

describe("P0 worker process guard", () => {
  it("detects an orphaned curl tick loop", () => {
    const processes = [
      "75270 /bin/zsh -c while true; curl https://old.example/api/internal/control-plane/tick; done",
      "97185 node scripts/run-p0-control-plane-worker.mjs",
    ].join("\n");

    expect(conflictingP0WorkerProcesses(processes, [97185])).toEqual([75270]);
    expect(() =>
      assertExclusiveP0Worker({
        processList: processes,
        currentPid: 97185,
        parentPid: 97172,
      }),
    ).toThrow("legacy tick loop");
  });

  it("detects a second guarded worker", () => {
    const processes = [
      "97185 node scripts/run-p0-control-plane-worker.mjs",
      "99000 node scripts/run-p0-control-plane-worker.mjs",
    ].join("\n");

    expect(conflictingP0WorkerProcesses(processes, [99000])).toEqual([97185]);
  });

  it("ignores the current worker and its package-manager parent", () => {
    const processes = [
      "97172 sh -c node scripts/run-p0-control-plane-worker.mjs",
      "97185 node scripts/run-p0-control-plane-worker.mjs",
      "96920 node scripts/long-connection-bridge.mjs",
    ].join("\n");

    expect(() =>
      assertExclusiveP0Worker({
        processList: processes,
        currentPid: 97185,
        parentPid: 97172,
      }),
    ).not.toThrow();
  });

  it("ignores wrappers that only mention the worker script", () => {
    const processes = [
      "75779 /bin/zsh -c node scripts/run-p0-control-plane-worker.mjs",
      "75799 rtk node scripts/run-p0-control-plane-worker.mjs",
      "75805 rg scripts/run-p0-control-plane-worker.mjs",
      "75820 /opt/homebrew/bin/node scripts/run-p0-control-plane-worker.mjs",
    ].join("\n");

    expect(conflictingP0WorkerProcesses(processes, [75820])).toEqual([]);
  });
});
