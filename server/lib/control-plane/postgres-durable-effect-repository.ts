import { randomUUID } from "node:crypto";
import type { TransactionalSqlDatabase } from "./sql";

export type DurableEffectState =
  | "queued"
  | "sending"
  | "succeeded"
  | "outcome_unknown"
  | "failed";

export interface DurableEffect {
  id: string;
  taskId?: string;
  kind: string;
  semanticKey: string;
  requestSha256: string;
  requestPayload: Record<string, unknown>;
  state: DurableEffectState;
  attempts: number;
  availableAt: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
}

export interface DurableEffectRepository {
  claim(input: {
    workerId: string;
    limit: number;
    leaseMs: number;
  }): Promise<DurableEffect[]>;
  complete(input: {
    effectId: string;
    leaseToken: string;
    externalReference?: string;
  }): Promise<void>;
  retryOrDeadLetter(input: {
    effectId: string;
    leaseToken: string;
    retryAt?: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void>;
  markOutcomeUnknown(input: {
    effectId: string;
    leaseToken: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void>;
}

interface EffectRow extends Record<string, unknown> {
  id: string;
  task_id?: string;
  kind: string;
  semantic_key: string;
  request_sha256: string;
  request_payload: Record<string, unknown>;
  state: DurableEffectState;
  attempts: number;
  next_attempt_at: string | Date;
  lease_token?: string;
  lease_expires_at?: string | Date;
}

function toIso(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function asEffect(row: EffectRow): DurableEffect {
  if (!row.request_payload || typeof row.request_payload !== "object") {
    throw new Error("Durable effect payload is invalid");
  }
  return {
    id: row.id,
    taskId: row.task_id,
    kind: row.kind,
    semanticKey: row.semantic_key,
    requestSha256: row.request_sha256,
    requestPayload: row.request_payload,
    state: row.state,
    attempts: row.attempts,
    availableAt: toIso(row.next_attempt_at) ?? new Date(0).toISOString(),
    leaseToken: row.lease_token,
    leaseExpiresAt: toIso(row.lease_expires_at),
  };
}

/**
 * PostgreSQL lease repository for external side-effect intents. The table's
 * semantic-key uniqueness prevents intent duplication; this repository prevents
 * duplicate execution after a worker crash. An indeterminate remote result is
 * terminal until a reconciliation path exists, never automatically retried.
 */
export class PostgresDurableEffectRepository
  implements DurableEffectRepository
{
  constructor(
    private readonly database: TransactionalSqlDatabase,
    private readonly options: {
      now?: () => Date;
      token?: () => string;
      id?: () => string;
    } = {},
  ) {}

  async claim(input: {
    workerId: string;
    limit: number;
    leaseMs: number;
  }): Promise<DurableEffect[]> {
    if (!input.workerId.trim()) throw new Error("Effect worker ID is required");
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    ) {
      throw new Error("Effect claim limit must be between 1 and 100");
    }
    if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs < 1_000) {
      throw new Error("Effect lease must be at least one second");
    }
    const now = this.now();
    const leaseToken = (this.options.token ?? randomUUID)();
    const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
    const result = await this.database.query<EffectRow>(
      `WITH claimable AS (
         SELECT id FROM effect_receipts
         WHERE (
           (state = 'queued' AND next_attempt_at <= $1)
           OR (state = 'sending' AND lease_expires_at <= $1)
         )
         ORDER BY next_attempt_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE effect_receipts effect
       SET state = 'sending', lease_token = $3, lease_expires_at = $4,
           attempts = attempts + 1, updated_at = now()
       FROM claimable
       WHERE effect.id = claimable.id
       RETURNING effect.id, effect.task_id, effect.kind, effect.semantic_key,
                 effect.request_sha256, effect.request_payload, effect.state,
                 effect.attempts, effect.next_attempt_at, effect.lease_token,
                 effect.lease_expires_at`,
      [
        now.toISOString(),
        input.limit,
        leaseToken,
        leaseExpiresAt.toISOString(),
      ],
    );
    return result.rows.map(asEffect);
  }

  async complete(input: {
    effectId: string;
    leaseToken: string;
    externalReference?: string;
  }): Promise<void> {
    const result = await this.database.query(
      `UPDATE effect_receipts
       SET state = 'succeeded', external_reference = $3, completed_at = now(),
           lease_token = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE id = $1 AND state = 'sending' AND lease_token = $2
         AND lease_expires_at > $4`,
      [
        input.effectId,
        input.leaseToken,
        input.externalReference ?? null,
        this.now().toISOString(),
      ],
    );
    if (!result.rowCount) {
      throw new Error("Effect lease was lost before completion");
    }
  }

  async retryOrDeadLetter(input: {
    effectId: string;
    leaseToken: string;
    retryAt?: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    const now = this.now();
    await this.database.transaction(async (transaction) => {
      const result = await transaction.query<{ id: string }>(
        `UPDATE effect_receipts
         SET state = $3, next_attempt_at = COALESCE($4::timestamptz, next_attempt_at),
             last_error_code = $6, last_error_message = $7, lease_token = NULL,
             lease_expires_at = NULL, updated_at = now()
         WHERE id = $1 AND state = 'sending' AND lease_token = $2
           AND lease_expires_at > $5
         RETURNING id`,
        [
          input.effectId,
          input.leaseToken,
          input.retryAt ? "queued" : "failed",
          input.retryAt ?? null,
          now.toISOString(),
          input.errorCode,
          input.errorMessage,
        ],
      );
      if (!result.rowCount) {
        throw new Error("Effect lease was lost before failure handling");
      }
      if (!input.retryAt) {
        await transaction.query(
          `INSERT INTO effect_dead_letters (
             id, effect_id, error_code, error_message
           ) VALUES ($1, $2, $3, $4)`,
          [
            (this.options.id ?? randomUUID)(),
            input.effectId,
            input.errorCode,
            input.errorMessage,
          ],
        );
      }
    });
  }

  async markOutcomeUnknown(input: {
    effectId: string;
    leaseToken: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    const result = await this.database.query(
      `UPDATE effect_receipts
       SET state = 'outcome_unknown', last_error_code = $3,
           last_error_message = $4, lease_token = NULL, lease_expires_at = NULL,
           updated_at = now()
       WHERE id = $1 AND state = 'sending' AND lease_token = $2
         AND lease_expires_at > $5`,
      [
        input.effectId,
        input.leaseToken,
        input.errorCode,
        input.errorMessage,
        this.now().toISOString(),
      ],
    );
    if (!result.rowCount) {
      throw new Error(
        "Effect lease was lost before recording an unknown outcome",
      );
    }
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }
}
