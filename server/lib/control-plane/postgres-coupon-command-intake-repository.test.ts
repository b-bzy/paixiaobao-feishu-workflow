import { describe, expect, it } from "vitest";
import { PostgresCouponCommandIntakeRepository } from "./postgres-coupon-command-intake-repository";
import type { SqlExecutor, TransactionalSqlDatabase } from "./sql";

class RecordingDatabase implements TransactionalSqlDatabase {
  readonly calls: Array<{
    statement: string;
    parameters?: readonly unknown[];
  }> = [];
  transactions = 0;

  constructor(
    private readonly results: Array<{
      rows?: Record<string, unknown>[];
      rowCount?: number | null;
    }>,
  ) {}

  async transaction<T>(
    callback: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    this.transactions += 1;
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

describe("PostgresCouponCommandIntakeRepository", () => {
  it("persists task, audit, effect intent, and handled outcome in one transaction", async () => {
    const database = new RecordingDatabase([
      { rows: [{ id: "receipt-1" }], rowCount: 1 },
      { rows: [], rowCount: 0 },
      { rowCount: 1 },
      { rows: [], rowCount: 0 },
      { rowCount: 1 },
      { rowCount: 1 },
      { rowCount: 1 },
      { rowCount: 1 },
      { rows: [{ id: "effect-1" }], rowCount: 1 },
      {
        rows: [
          {
            kind: "handled",
            task_id: "CTS-task-1",
            effect_id: "effect-1",
          },
        ],
        rowCount: 1,
      },
    ]);
    const ids = ["task-1", "audit-1", "effect-1"];
    const repository = new PostgresCouponCommandIntakeRepository(database, {
      id: () => ids.shift() ?? "unexpected",
    });

    await expect(
      repository.startOrResume({
        receiptId: "receipt-1",
        ownerOpenId: "ou_owner",
      }),
    ).resolves.toEqual({
      kind: "handled",
      taskId: "CTS-task-1",
      effectId: "effect-1",
    });

    expect(database.transactions).toBe(1);
    expect(database.calls).toHaveLength(10);
    expect(database.calls[0]?.statement).toContain("FOR UPDATE");
    expect(database.calls[2]?.statement).toContain("pg_advisory_xact_lock");
    expect(database.calls[4]?.statement).toContain("coupon_tasks");
    expect(database.calls[5]?.statement).toContain("coupon_task_revisions");
    expect(database.calls[7]?.statement).toContain("workflow_audit_events");
    expect(database.calls[8]?.statement).toContain("effect_receipts");
    expect(database.calls[9]?.statement).toContain("feishu_delivery_outcomes");
    expect(database.calls[8]?.parameters?.[3]).toBe(
      "coupon-intake-card:CTS-task-1:1",
    );
  });

  it("reuses a prior handled outcome before writing another task or effect", async () => {
    const database = new RecordingDatabase([
      { rows: [{ id: "receipt-1" }], rowCount: 1 },
      {
        rows: [
          {
            kind: "handled",
            task_id: "CTS-existing",
            effect_id: "effect-existing",
          },
        ],
        rowCount: 1,
      },
    ]);
    const repository = new PostgresCouponCommandIntakeRepository(database);

    await expect(
      repository.startOrResume({
        receiptId: "receipt-1",
        ownerOpenId: "ou_owner",
      }),
    ).resolves.toEqual({
      kind: "handled",
      taskId: "CTS-existing",
      effectId: "effect-existing",
    });
    expect(database.calls).toHaveLength(2);
  });

  it("locks a receipt before writing an ignored or rejected outcome", async () => {
    const database = new RecordingDatabase([
      { rows: [{ id: "receipt-1" }], rowCount: 1 },
      { rows: [], rowCount: 0 },
      {
        rows: [{ kind: "rejected", reason: "direct_chat_required" }],
        rowCount: 1,
      },
    ]);
    const repository = new PostgresCouponCommandIntakeRepository(database);

    await expect(
      repository.recordTerminalOutcome({
        receiptId: "receipt-1",
        outcome: { kind: "rejected", reason: "direct_chat_required" },
      }),
    ).resolves.toEqual({ kind: "rejected", reason: "direct_chat_required" });
    expect(database.transactions).toBe(1);
    expect(database.calls[0]?.statement).toContain("FOR UPDATE");
    expect(database.calls[2]?.statement).toContain("feishu_delivery_outcomes");
  });
});
