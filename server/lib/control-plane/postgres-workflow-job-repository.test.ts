import { describe, expect, it } from "vitest";
import { PostgresWorkflowJobRepository } from "./postgres-workflow-job-repository";
import type { SqlExecutor, TransactionalSqlDatabase } from "./sql";

class RecordingDatabase implements TransactionalSqlDatabase {
  readonly calls: Array<{
    statement: string;
    parameters?: readonly unknown[];
  }> = [];

  constructor(
    private readonly results: Array<{
      rows?: Record<string, unknown>[];
      rowCount?: number | null;
    }>,
  ) {}

  async transaction<T>(
    callback: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    return callback(this);
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    parameters?: readonly unknown[],
  ) {
    this.calls.push({ statement, parameters });
    const result = this.results.shift();
    if (!result) throw new Error("Unexpected SQL query");
    return {
      rows: (result.rows ?? []) as Row[],
      rowCount: result.rowCount ?? result.rows?.length ?? 0,
    };
  }
}

describe("PostgresWorkflowJobRepository", () => {
  it("leases ready jobs with skip-locked semantics", async () => {
    const database = new RecordingDatabase([
      {
        rows: [
          {
            id: "job-1",
            kind: "process_feishu_delivery",
            semantic_key: "delivery.process:hash",
            payload: { receiptId: "receipt-1" },
            state: "leased",
            attempts: 1,
            next_attempt_at: "2030-01-01T00:00:00.000Z",
            lease_token: "lease-1",
            lease_expires_at: "2030-01-01T00:01:00.000Z",
          },
        ],
      },
    ]);
    const repository = new PostgresWorkflowJobRepository(database, {
      now: () => new Date("2030-01-01T00:00:00.000Z"),
      token: () => "lease-1",
    });

    await expect(
      repository.claim({ workerId: "worker-1", limit: 1, leaseMs: 60_000 }),
    ).resolves.toMatchObject([
      { id: "job-1", state: "leased", leaseToken: "lease-1", attempts: 1 },
    ]);
    expect(database.calls[0]?.statement).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("reclaims expired leases but never makes unexpired leases claimable", async () => {
    const now = new Date("2030-01-01T00:02:00.000Z");
    const database = new RecordingDatabase([
      {
        rows: [
          {
            id: "job-1",
            kind: "process_feishu_delivery",
            semantic_key: "delivery.process:hash",
            payload: { receiptId: "receipt-1" },
            state: "leased",
            attempts: 2,
            next_attempt_at: "2030-01-01T00:00:00.000Z",
            lease_token: "replacement-lease",
            lease_expires_at: "2030-01-01T00:03:00.000Z",
          },
        ],
      },
    ]);
    const repository = new PostgresWorkflowJobRepository(database, {
      now: () => now,
      token: () => "replacement-lease",
    });

    await expect(
      repository.claim({ workerId: "worker-2", limit: 1, leaseMs: 60_000 }),
    ).resolves.toMatchObject([{ id: "job-1", attempts: 2 }]);

    const statement = database.calls[0]?.statement ?? "";
    expect(statement).toContain("FOR UPDATE SKIP LOCKED");
    expect(statement).toContain(
      "OR (state = 'leased' AND lease_expires_at <= $1)",
    );
    expect(statement).not.toContain(
      "state = 'leased' AND lease_expires_at > $1",
    );
    expect(database.calls[0]?.parameters).toEqual([
      now.toISOString(),
      1,
      "replacement-lease",
      "2030-01-01T00:03:00.000Z",
    ]);
  });

  it("does not complete an expired or stolen lease", async () => {
    const now = new Date("2030-01-01T00:02:00.000Z");
    const database = new RecordingDatabase([{ rowCount: 0 }]);
    const repository = new PostgresWorkflowJobRepository(database, {
      now: () => now,
    });

    await expect(
      repository.complete({ jobId: "job-1", leaseToken: "stale" }),
    ).rejects.toThrow("lease was lost");
    expect(database.calls[0]?.statement).toContain("lease_expires_at > $3");
    expect(database.calls[0]?.parameters).toEqual([
      "job-1",
      "stale",
      now.toISOString(),
    ]);
  });

  it("does not retry or dead-letter after a lease expires", async () => {
    const now = new Date("2030-01-01T00:02:00.000Z");
    const database = new RecordingDatabase([{ rowCount: 0 }]);
    const repository = new PostgresWorkflowJobRepository(database, {
      now: () => now,
    });

    await expect(
      repository.retryOrDeadLetter({
        jobId: "job-1",
        leaseToken: "stale",
        errorCode: "TRANSIENT",
        errorMessage: "lease expired before retry",
        retryAt: "2030-01-01T00:03:00.000Z",
      }),
    ).rejects.toThrow("lease was lost");
    expect(database.calls).toHaveLength(1);
    expect(database.calls[0]?.statement).toContain("lease_expires_at > $5");
    expect(database.calls[0]?.parameters).toEqual([
      "job-1",
      "stale",
      "retry",
      "2030-01-01T00:03:00.000Z",
      now.toISOString(),
      "TRANSIENT",
      "lease expired before retry",
    ]);
  });

  it("records terminal failures in the durable dead-letter table", async () => {
    const database = new RecordingDatabase([
      { rows: [{ id: "job-1" }], rowCount: 1 },
      { rowCount: 1 },
    ]);
    const repository = new PostgresWorkflowJobRepository(database);

    await expect(
      repository.retryOrDeadLetter({
        jobId: "job-1",
        leaseToken: "lease-1",
        errorCode: "INVALID_TEMPLATE",
        errorMessage: "template is not registered",
      }),
    ).resolves.toBeUndefined();
    expect(database.calls[1]?.statement).toContain("workflow_dead_letters");
  });
});
