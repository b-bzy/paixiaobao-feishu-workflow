import { describe, expect, it, vi } from "vitest";
import type { WorkflowJob, WorkflowJobRepository } from "./contracts";
import { DurableWorker } from "./durable-worker";

const job: WorkflowJob = {
  id: "job-1",
  kind: "process_feishu_delivery",
  semanticKey: "delivery.process:hash",
  payload: { receiptId: "receipt-1" },
  state: "leased",
  attempts: 1,
  availableAt: "2030-01-01T00:00:00.000Z",
  leaseToken: "lease-1",
};

function repository(jobs: WorkflowJob[]): WorkflowJobRepository {
  return {
    claim: vi.fn(async () => jobs),
    complete: vi.fn(async () => undefined),
    retryOrDeadLetter: vi.fn(async () => undefined),
  };
}

describe("DurableWorker", () => {
  it("completes a leased job only after its handler succeeds", async () => {
    const jobs = repository([job]);
    const worker = new DurableWorker(jobs, {
      process_feishu_delivery: async () => ({ kind: "succeeded" }),
    });

    await expect(
      worker.runOnce({ workerId: "worker-1", limit: 1, leaseMs: 60_000 }),
    ).resolves.toEqual({
      claimed: 1,
      succeeded: 1,
      retried: 0,
      deadLettered: 0,
    });
    expect(jobs.complete).toHaveBeenCalledWith({
      jobId: "job-1",
      leaseToken: "lease-1",
    });
  });

  it("records retryable and missing handlers without pretending success", async () => {
    const retryJobs = repository([job]);
    const retryWorker = new DurableWorker(retryJobs, {
      process_feishu_delivery: async () => ({
        kind: "retry",
        retryAt: "2030-01-01T00:01:00.000Z",
        errorCode: "FEISHU_RATE_LIMITED",
        errorMessage: "retry later",
      }),
    });
    await expect(
      retryWorker.runOnce({ workerId: "worker-1", limit: 1, leaseMs: 60_000 }),
    ).resolves.toMatchObject({ retried: 1 });
    expect(retryJobs.retryOrDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({ retryAt: "2030-01-01T00:01:00.000Z" }),
    );

    const missingJobs = repository([{ ...job, kind: "unknown" }]);
    const missingWorker = new DurableWorker(missingJobs, {});
    await expect(
      missingWorker.runOnce({
        workerId: "worker-1",
        limit: 1,
        leaseMs: 60_000,
      }),
    ).resolves.toMatchObject({ deadLettered: 1 });
    expect(missingJobs.retryOrDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "JOB_HANDLER_UNAVAILABLE" }),
    );
  });

  it("retries unexpected failures with a bounded, redacted worker result", async () => {
    const retryJobs = repository([job]);
    const retryWorker = new DurableWorker(
      retryJobs,
      {
        process_feishu_delivery: async () => {
          throw new Error("provider response included a secret");
        },
      },
      {
        now: () => new Date("2030-01-01T00:00:00.000Z"),
        retryDelayMs: 60_000,
        maxAttempts: 2,
      },
    );

    await expect(
      retryWorker.runOnce({ workerId: "worker-1", limit: 1, leaseMs: 60_000 }),
    ).resolves.toMatchObject({ retried: 1 });
    expect(retryJobs.retryOrDeadLetter).toHaveBeenCalledWith({
      jobId: "job-1",
      leaseToken: "lease-1",
      retryAt: "2030-01-01T00:01:00.000Z",
      errorCode: "UNHANDLED_WORKER_ERROR",
      errorMessage: "The durable worker handler failed before completing",
    });

    const cappedJobs = repository([{ ...job, attempts: 2 }]);
    const cappedWorker = new DurableWorker(
      cappedJobs,
      {
        process_feishu_delivery: async () => ({
          kind: "retry",
          retryAt: "2030-01-01T00:01:00.000Z",
          errorCode: "TRANSIENT",
          errorMessage: "retry",
        }),
      },
      { maxAttempts: 2 },
    );
    await expect(
      cappedWorker.runOnce({ workerId: "worker-1", limit: 1, leaseMs: 60_000 }),
    ).resolves.toMatchObject({ deadLettered: 1 });
    expect(cappedJobs.retryOrDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "MAX_ATTEMPTS_EXCEEDED",
        retryAt: undefined,
      }),
    );
  });
});
