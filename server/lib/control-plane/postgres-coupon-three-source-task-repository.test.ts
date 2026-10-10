import { describe, expect, it } from "vitest";
import {
  confirmCouponThreeSourceNoBlacklist,
  createCouponThreeSourceTask,
} from "../coupon-oa/three-source/task";
import { PostgresCouponThreeSourceTaskRepository } from "./postgres-coupon-three-source-task-repository";
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

describe("PostgresCouponThreeSourceTaskRepository", () => {
  it("creates an authoritative task plus immutable revision and audit record", async () => {
    const database = new RecordingDatabase([
      { rowCount: 1 },
      { rowCount: 1 },
      { rowCount: 1 },
    ]);
    const repository = new PostgresCouponThreeSourceTaskRepository(database);
    const task = createCouponThreeSourceTask({
      taskId: "CTS-1",
      ownerOpenId: "ou_owner",
    });

    await expect(repository.create(task)).resolves.toEqual(task);
    expect(database.calls).toHaveLength(3);
    expect(database.calls[0]?.statement).toContain("coupon_tasks");
    expect(database.calls[1]?.statement).toContain("coupon_task_revisions");
    expect(database.calls[2]?.statement).toContain("workflow_audit_events");
  });

  it("claims an operation before changing the expected revision", async () => {
    const current = createCouponThreeSourceTask({
      taskId: "CTS-1",
      ownerOpenId: "ou_owner",
    });
    const next = confirmCouponThreeSourceNoBlacklist({
      task: current,
      ownerOpenId: "ou_owner",
      expectedRevision: 1,
    });
    const database = new RecordingDatabase([
      { rows: [{ task_id: "CTS-1" }], rowCount: 1 },
      { rows: [{ id: "CTS-1" }], rowCount: 1 },
      { rowCount: 1 },
      { rowCount: 1 },
      { rowCount: 1 },
    ]);
    const repository = new PostgresCouponThreeSourceTaskRepository(database);

    await expect(
      repository.replace({
        task: next,
        expectedRevision: 1,
        operationId: "card-action-1",
      }),
    ).resolves.toEqual(next);
    expect(database.calls[0]?.statement).toContain("coupon_task_operations");
    expect(database.calls[1]?.statement).toContain("revision = $2");
    expect(database.calls[1]?.parameters?.[1]).toBe(1);
  });

  it("returns the persisted operation result on card-action replay", async () => {
    const task = createCouponThreeSourceTask({
      taskId: "CTS-1",
      ownerOpenId: "ou_owner",
    });
    const database = new RecordingDatabase([
      { rowCount: 0 },
      { rows: [{ task }], rowCount: 1 },
    ]);
    const repository = new PostgresCouponThreeSourceTaskRepository(database);

    await expect(
      repository.replace({
        task,
        expectedRevision: 1,
        operationId: "card-action-1",
      }),
    ).resolves.toEqual(task);
    expect(database.calls).toHaveLength(2);
  });

  it("reports an in-progress operation instead of applying a stale replay", async () => {
    const database = new RecordingDatabase([{ rows: [{}], rowCount: 1 }]);
    const repository = new PostgresCouponThreeSourceTaskRepository(database);

    await expect(
      repository.getOperationResult({
        taskId: "CTS-1",
        operationId: "card-action-1",
      }),
    ).rejects.toThrow("still being committed");
  });
});
