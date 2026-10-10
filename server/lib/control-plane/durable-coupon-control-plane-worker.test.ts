import { describe, expect, it, vi } from "vitest";
import type { WorkflowJobRepository } from "./contracts";
import {
  createDurableCouponControlPlaneWorker,
  DurableCouponControlPlaneWorker,
  type DurableCouponWorkerRunOptions,
} from "./durable-coupon-control-plane-worker";
import { DurableEffectWorker } from "./durable-effect-worker";
import { DurableWorker } from "./durable-worker";
import type { DurableEffectRepository } from "./postgres-durable-effect-repository";
import type { RuntimeLeaseRepository } from "./runtime-lease";
import type { SqlQueryResult, TransactionalSqlDatabase } from "./sql";

const options: DurableCouponWorkerRunOptions = {
  workerId: "worker-1",
  jobLimit: 10,
  effectLimit: 10,
  jobLeaseMs: 60_000,
  effectLeaseMs: 60_000,
  schedulerLeaseMs: 90_000,
};

function jobRepository(): WorkflowJobRepository {
  return {
    claim: vi.fn(async () => []),
    complete: vi.fn(async () => undefined),
    retryOrDeadLetter: vi.fn(async () => undefined),
  };
}

function effectRepository(): DurableEffectRepository {
  return {
    claim: vi.fn(async () => []),
    complete: vi.fn(async () => undefined),
    retryOrDeadLetter: vi.fn(async () => undefined),
    markOutcomeUnknown: vi.fn(async () => undefined),
  };
}

describe("DurableCouponControlPlaneWorker", () => {
  it("does not poll queues when another scheduler owns the tick lease", async () => {
    const jobs = jobRepository();
    const effects = effectRepository();
    const lease: RuntimeLeaseRepository = {
      tryAcquire: vi.fn(async () => false),
      release: vi.fn(async () => undefined),
    };
    const worker = new DurableCouponControlPlaneWorker(
      new DurableWorker(jobs, {}),
      new DurableEffectWorker(effects, {}),
      lease,
    );

    await expect(worker.runOnce(options)).resolves.toMatchObject({
      skipped: true,
      jobs: { claimed: 0 },
      effects: { claimed: 0 },
    });
    expect(jobs.claim).not.toHaveBeenCalled();
    expect(effects.claim).not.toHaveBeenCalled();
    expect(lease.release).not.toHaveBeenCalled();
  });

  it("runs receipt jobs before effects and releases the scheduler lease", async () => {
    const jobs = jobRepository();
    const effects = effectRepository();
    const events: string[] = [];
    vi.mocked(jobs.claim).mockImplementation(async () => {
      events.push("jobs");
      return [];
    });
    vi.mocked(effects.claim).mockImplementation(async () => {
      events.push("effects");
      return [];
    });
    const lease: RuntimeLeaseRepository = {
      tryAcquire: vi.fn(async () => true),
      release: vi.fn(async () => {
        events.push("release");
      }),
    };
    const worker = new DurableCouponControlPlaneWorker(
      new DurableWorker(jobs, {}),
      new DurableEffectWorker(effects, {}),
      lease,
    );

    await expect(worker.runOnce(options)).resolves.toMatchObject({
      skipped: false,
      jobs: { claimed: 0 },
      effects: { claimed: 0 },
    });
    expect(events).toEqual(["jobs", "effects", "release"]);
    expect(lease.tryAcquire).toHaveBeenCalledWith({
      name: "coupon-control-plane-tick",
      holderId: "worker-1",
      leaseMs: 90_000,
    });
  });

  it("registers the AI handler and retries only projection for terminal runs", async () => {
    const database: TransactionalSqlDatabase = {
      transaction: async (callback) => callback(database),
      async query<
        Row extends Record<string, unknown> = Record<string, unknown>,
      >(statement: string): Promise<SqlQueryResult<Row>> {
        if (statement.includes("workflow_outbox")) {
          return { rows: [], rowCount: 0 };
        }
        if (
          statement.includes("WITH claimable") &&
          statement.includes("effect_receipts")
        ) {
          return {
            rows: [
              {
                id: "effect-1",
                kind: "coupon_three_source_ai_recognition",
                semantic_key: "coupon-ai:semantic-1",
                request_sha256: "request",
                request_payload: {
                  version: "coupon-ai-recognition-effect-v1",
                  runId: "run-1",
                  businessTaskId: "CTS-1",
                },
                state: "sending",
                attempts: 1,
                next_attempt_at: new Date(0),
                lease_token: "lease-1",
                lease_expires_at: new Date(Date.now() + 60_000),
              },
            ] as unknown as Row[],
            rowCount: 1,
          };
        }
        if (
          statement.includes("coupon_ai_recognition_runs") &&
          statement.includes("SELECT")
        ) {
          return {
            rows: [
              {
                id: "run-1",
                semantic_key: "semantic-1",
                pilot_record_id: "record-1",
                business_task_id: "CTS-1",
                owner_open_id: "ou_owner",
                revision: 1,
                source_slot: "couponTable",
                source_reference: {},
                source_sha256: "a".repeat(64),
                source_file_name: "coupon.xlsx",
                provider: "deepseek",
                model: "deepseek-chat",
                prompt_version: "coupon-three-source-p0-ai-v1",
                status: "succeeded",
                started_at: new Date(0),
                completed_at: new Date(1),
                duration_ms: 1,
                validated_result: {
                  sourceHash: "a".repeat(64),
                  roleCandidates: [],
                  couponCandidates: [],
                  fieldCandidates: [],
                  listCandidates: [],
                  issues: [],
                },
              },
            ] as unknown as Row[],
            rowCount: 1,
          };
        }
        if (statement.includes("projected_at")) {
          return { rows: [], rowCount: 1 };
        }
        if (
          statement.includes("state = 'succeeded'") &&
          statement.includes("effect_receipts")
        ) {
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected SQL: ${statement}`);
      },
    };
    const projector = { project: vi.fn(async () => undefined) };
    const gateway = { recognize: vi.fn() };
    const worker = createDurableCouponControlPlaneWorker({
      database,
      schedulerLease: {
        tryAcquire: vi.fn(async () => true),
        release: vi.fn(async () => undefined),
      },
      aiRecognition: {
        gateway: gateway as never,
        sourceLoader: { load: vi.fn() },
        projector,
      },
    });
    await expect(worker.runOnce(options)).resolves.toMatchObject({
      effects: { claimed: 1, succeeded: 1 },
    });
    expect(projector.project).toHaveBeenCalledTimes(1);
    expect(gateway.recognize).not.toHaveBeenCalled();
  });
});
