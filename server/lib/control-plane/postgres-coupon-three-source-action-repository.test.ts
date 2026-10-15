import { describe, expect, it } from "vitest";
import {
  couponThreeSourceActionSemanticKey,
  PostgresCouponThreeSourceActionRepository,
} from "./postgres-coupon-three-source-action-repository";
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

const now = new Date("2030-01-01T00:00:00.000Z");

describe("PostgresCouponThreeSourceActionRepository", () => {
  it("uses task, revision, action and context as one semantic identity", () => {
    expect(
      couponThreeSourceActionSemanticKey({
        taskId: "CTS-1",
        revision: 4,
        actionName: "coupon_three_source_mapping_confirm",
        mappingContextHash: "a".repeat(64),
      }),
    ).toBe(`CTS-1:4:coupon_three_source_mapping_confirm:${"a".repeat(64)}`);
  });

  it("claims a new semantic action once", async () => {
    const database = new ScriptedDatabase([
      { rowCount: 1 },
      { rows: [{ id: "effect-1", state: "queued" }] },
      { rowCount: 1 },
    ]);
    const repository = new PostgresCouponThreeSourceActionRepository(database, {
      now: () => now,
      id: () => "effect-1",
      token: () => "lease-1",
    });

    await expect(
      repository.prepareAndClaim({
        semanticKey: "semantic-1",
        requestPayload: { taskId: "CTS-1" },
      }),
    ).resolves.toEqual({
      state: "claimed",
      effectId: "effect-1",
      leaseToken: "lease-1",
    });
    expect(database.calls[0]?.statement).toContain("ON CONFLICT");
    expect(database.calls[1]?.statement).toContain("FOR UPDATE");
  });

  it("does not reclaim an unexpired concurrent action", async () => {
    const database = new ScriptedDatabase([
      { rowCount: 0 },
      {
        rows: [
          {
            id: "effect-1",
            state: "sending",
            lease_expires_at: "2030-01-01T00:02:00.000Z",
          },
        ],
      },
    ]);
    const repository = new PostgresCouponThreeSourceActionRepository(database, {
      now: () => now,
    });

    await expect(
      repository.prepareAndClaim({
        semanticKey: "semantic-1",
        requestPayload: { taskId: "CTS-1" },
      }),
    ).resolves.toEqual({ state: "in_progress", effectId: "effect-1" });
    expect(database.calls).toHaveLength(2);
  });
});
