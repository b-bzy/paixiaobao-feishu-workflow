import { describe, expect, it } from "vitest";
import { PostgresRuntimeLeaseRepository } from "./runtime-lease";
import type { SqlExecutor, TransactionalSqlDatabase } from "./sql";

class ScriptedDatabase implements TransactionalSqlDatabase {
  readonly calls: Array<{
    statement: string;
    parameters?: readonly unknown[];
  }> = [];

  constructor(private readonly rowCounts: number[]) {}

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
    const rowCount = this.rowCounts.shift();
    if (rowCount === undefined) throw new Error("Unexpected SQL query");
    return { rows: [] as Row[], rowCount };
  }
}

const now = new Date("2030-01-01T00:00:00.000Z");

describe("PostgresRuntimeLeaseRepository", () => {
  it("acquires or renews only when the current lease is expired or owned by this worker", async () => {
    const database = new ScriptedDatabase([1, 0]);
    const repository = new PostgresRuntimeLeaseRepository(database, () => now);

    await expect(
      repository.tryAcquire({
        name: "coupon-control-plane-tick",
        holderId: "worker-1",
        leaseMs: 60_000,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.tryAcquire({
        name: "coupon-control-plane-tick",
        holderId: "worker-2",
        leaseMs: 60_000,
      }),
    ).resolves.toBe(false);

    expect(database.calls[0]?.statement).toContain(
      "ON CONFLICT (name) DO UPDATE",
    );
    expect(database.calls[0]?.statement).toContain("lease_expires_at <= $4");
    expect(database.calls[0]?.parameters).toEqual([
      "coupon-control-plane-tick",
      "worker-1",
      "2030-01-01T00:01:00.000Z",
      now.toISOString(),
    ]);
  });

  it("releases only the caller's scheduler lease", async () => {
    const database = new ScriptedDatabase([1]);
    const repository = new PostgresRuntimeLeaseRepository(database, () => now);

    await repository.release({
      name: "coupon-control-plane-tick",
      holderId: "worker-1",
    });

    expect(database.calls[0]?.statement).toContain(
      "WHERE name = $1 AND holder_id = $2",
    );
  });
});
