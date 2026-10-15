import { describe, expect, it } from "vitest";
import { PostgresCouponThreeSourceHandoffRepository } from "./postgres-coupon-three-source-handoff-repository";
import type { SqlExecutor, TransactionalSqlDatabase } from "./sql";

class ScriptedDatabase implements TransactionalSqlDatabase {
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
  async transaction<T>(callback: (tx: SqlExecutor) => Promise<T>): Promise<T> {
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

const row = {
  source_identity: "identity-1",
  task_id: "CTS-1",
  revision: 4,
  confirmation_snapshot_hash: "a".repeat(64),
  state: "pending",
};

describe("PostgresCouponThreeSourceHandoffRepository", () => {
  it("prepares one durable handoff by source identity", async () => {
    const database = new ScriptedDatabase([{ rows: [row] }]);
    const repository = new PostgresCouponThreeSourceHandoffRepository(database);

    await expect(
      repository.prepare({
        sourceIdentity: "identity-1",
        taskId: "CTS-1",
        revision: 4,
        confirmationSnapshotHash: "a".repeat(64),
      }),
    ).resolves.toMatchObject({
      sourceIdentity: "identity-1",
      taskId: "CTS-1",
      revision: 4,
      state: "pending",
    });
    expect(database.calls[0]?.statement).toContain("ON CONFLICT");
  });

  it("marks an uncertain create outcome without retrying creation", async () => {
    const database = new ScriptedDatabase([{ rowCount: 1 }]);
    const repository = new PostgresCouponThreeSourceHandoffRepository(database);

    await repository.markOutcomeUnknown({
      sourceIdentity: "identity-1",
      errorCode: "OA_DRAFT_CREATE_OUTCOME_UNKNOWN",
    });
    expect(database.calls[0]?.parameters?.[1]).toBe("outcome_unknown");
  });
});
