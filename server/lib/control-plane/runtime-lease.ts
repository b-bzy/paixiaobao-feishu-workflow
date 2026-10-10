import type { TransactionalSqlDatabase } from "./sql";

export interface RuntimeLeaseRepository {
  tryAcquire(input: {
    name: string;
    holderId: string;
    leaseMs: number;
  }): Promise<boolean>;
  release(input: { name: string; holderId: string }): Promise<void>;
}

/**
 * A scheduler lease reduces duplicate polling across worker instances. Job and
 * effect row leases remain the correctness boundary if a scheduler crashes or a
 * lease expires mid-tick.
 */
export class PostgresRuntimeLeaseRepository implements RuntimeLeaseRepository {
  constructor(
    private readonly database: TransactionalSqlDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async tryAcquire(input: {
    name: string;
    holderId: string;
    leaseMs: number;
  }): Promise<boolean> {
    if (!input.name.trim() || !input.holderId.trim()) {
      throw new Error("Runtime lease name and holder ID are required");
    }
    if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs < 1_000) {
      throw new Error("Runtime lease must be at least one second");
    }
    const now = this.now();
    const expiresAt = new Date(now.getTime() + input.leaseMs);
    const result = await this.database.query<{ name: string }>(
      `INSERT INTO runtime_leases (name, holder_id, lease_expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE
       SET holder_id = EXCLUDED.holder_id,
           lease_expires_at = EXCLUDED.lease_expires_at,
           updated_at = now()
       WHERE runtime_leases.lease_expires_at <= $4
          OR runtime_leases.holder_id = $2
       RETURNING name`,
      [input.name, input.holderId, expiresAt.toISOString(), now.toISOString()],
    );
    return Boolean(result.rowCount);
  }

  async release(input: { name: string; holderId: string }): Promise<void> {
    await this.database.query(
      "DELETE FROM runtime_leases WHERE name = $1 AND holder_id = $2",
      [input.name, input.holderId],
    );
  }
}
