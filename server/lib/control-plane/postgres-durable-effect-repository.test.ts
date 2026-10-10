import { describe, expect, it } from "vitest";
import {
  type DurableEffect,
  PostgresDurableEffectRepository,
} from "./postgres-durable-effect-repository";
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

const row = {
  id: "effect-1",
  task_id: "CTS-1",
  kind: "coupon_three_source_intake_card",
  semantic_key: "coupon-intake-card:CTS-1:1",
  request_sha256: "a".repeat(64),
  request_payload: {
    version: "coupon-intake-card-v1",
    taskId: "CTS-1",
    revision: 1,
    ownerOpenId: "ou_owner",
    purpose: "collect_sources",
  },
  state: "sending",
  attempts: 2,
  next_attempt_at: "2030-01-01T00:00:00.000Z",
  lease_token: "lease-1",
  lease_expires_at: "2030-01-01T00:01:00.000Z",
};

const now = new Date("2030-01-01T00:00:00.000Z");

function repository(
  database: TransactionalSqlDatabase,
): PostgresDurableEffectRepository {
  return new PostgresDurableEffectRepository(database, {
    now: () => now,
    token: () => "lease-1",
    id: () => "dead-letter-1",
  });
}

describe("PostgresDurableEffectRepository", () => {
  it("claims queued or expired leases with SKIP LOCKED and a fresh lease token", async () => {
    const database = new ScriptedDatabase([{ rows: [row] }]);

    await expect(
      repository(database).claim({
        workerId: "worker-1",
        limit: 1,
        leaseMs: 60_000,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "effect-1",
        state: "sending",
        leaseToken: "lease-1",
        attempts: 2,
      }),
    ] satisfies Partial<DurableEffect>[]);

    expect(database.calls[0]?.statement).toContain("FOR UPDATE SKIP LOCKED");
    expect(database.calls[0]?.statement).toContain("state = 'sending'");
    expect(database.calls[0]?.parameters).toEqual([
      now.toISOString(),
      1,
      "lease-1",
      "2030-01-01T00:01:00.000Z",
    ]);
  });

  it("cannot let a stale worker complete an expired effect lease", async () => {
    const database = new ScriptedDatabase([{ rowCount: 0 }]);

    await expect(
      repository(database).complete({
        effectId: "effect-1",
        leaseToken: "stale-lease",
      }),
    ).rejects.toThrow("lease was lost");
    expect(database.calls[0]?.statement).toContain("lease_expires_at > $4");
  });

  it("moves a retryable error back to queued and terminal errors to an effect DLQ", async () => {
    const retryDatabase = new ScriptedDatabase([{ rowCount: 1 }]);
    await repository(retryDatabase).retryOrDeadLetter({
      effectId: "effect-1",
      leaseToken: "lease-1",
      retryAt: "2030-01-01T00:01:00.000Z",
      errorCode: "RATE_LIMITED",
      errorMessage: "retry later",
    });
    expect(retryDatabase.calls).toHaveLength(1);
    expect(retryDatabase.calls[0]?.parameters?.[2]).toBe("queued");

    const deadLetterDatabase = new ScriptedDatabase([
      { rowCount: 1 },
      { rowCount: 1 },
    ]);
    await repository(deadLetterDatabase).retryOrDeadLetter({
      effectId: "effect-1",
      leaseToken: "lease-1",
      errorCode: "INVALID_PAYLOAD",
      errorMessage: "do not retry",
    });
    expect(deadLetterDatabase.calls).toHaveLength(2);
    expect(deadLetterDatabase.calls[0]?.parameters?.[2]).toBe("failed");
    expect(deadLetterDatabase.calls[1]?.statement).toContain(
      "effect_dead_letters",
    );
  });

  it("records an uncertain external result outside the automatic claim set", async () => {
    const database = new ScriptedDatabase([{ rowCount: 1 }]);

    await expect(
      repository(database).markOutcomeUnknown({
        effectId: "effect-1",
        leaseToken: "lease-1",
        errorCode: "REMOTE_OUTCOME_UNKNOWN",
        errorMessage: "manual reconciliation required",
      }),
    ).resolves.toBeUndefined();
    expect(database.calls[0]?.statement).toContain("state = 'outcome_unknown'");
  });
});
