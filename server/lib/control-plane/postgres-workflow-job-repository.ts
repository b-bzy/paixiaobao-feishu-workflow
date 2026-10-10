import { randomUUID } from "node:crypto";
import type { WorkflowJob, WorkflowJobRepository } from "./contracts";
import type { TransactionalSqlDatabase } from "./sql";

interface JobRow extends Record<string, unknown> {
  id: string;
  kind: string;
  semantic_key: string;
  payload: Record<string, unknown>;
  state: WorkflowJob["state"];
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

function toJob(row: JobRow): WorkflowJob {
  return {
    id: row.id,
    kind: row.kind,
    semanticKey: row.semantic_key,
    payload: row.payload,
    state: row.state,
    attempts: row.attempts,
    availableAt: toIso(row.next_attempt_at) ?? new Date(0).toISOString(),
    leaseToken: row.lease_token,
    leaseExpiresAt: toIso(row.lease_expires_at),
  };
}

export class PostgresWorkflowJobRepository implements WorkflowJobRepository {
  constructor(
    private readonly database: TransactionalSqlDatabase,
    private readonly options: {
      now?: () => Date;
      token?: () => string;
    } = {},
  ) {}

  async claim(input: {
    workerId: string;
    limit: number;
    leaseMs: number;
  }): Promise<WorkflowJob[]> {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    ) {
      throw new Error("Worker job claim limit must be between 1 and 100");
    }
    if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs < 1_000) {
      throw new Error("Worker job lease must be at least one second");
    }
    const now = (this.options.now ?? (() => new Date()))();
    const leaseToken = (this.options.token ?? randomUUID)();
    const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
    const result = await this.database.query<JobRow>(
      `WITH claimable AS (
         SELECT id FROM workflow_outbox
         WHERE (
           (state IN ('ready', 'retry') AND next_attempt_at <= $1)
           OR (state = 'leased' AND lease_expires_at <= $1)
         )
         ORDER BY next_attempt_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE workflow_outbox job
       SET state = 'leased', lease_token = $3, lease_expires_at = $4,
           attempts = attempts + 1
       FROM claimable
       WHERE job.id = claimable.id
       RETURNING job.id, job.kind, job.semantic_key, job.payload, job.state,
                 job.attempts, job.next_attempt_at, job.lease_token,
                 job.lease_expires_at`,
      [
        now.toISOString(),
        input.limit,
        leaseToken,
        leaseExpiresAt.toISOString(),
      ],
    );
    return result.rows.map(toJob);
  }

  async complete(input: { jobId: string; leaseToken: string }): Promise<void> {
    const now = (this.options.now ?? (() => new Date()))();
    const result = await this.database.query(
      `UPDATE workflow_outbox
       SET state = 'succeeded', completed_at = now(), lease_token = NULL,
           lease_expires_at = NULL
       WHERE id = $1 AND state = 'leased' AND lease_token = $2
         AND lease_expires_at > $3`,
      [input.jobId, input.leaseToken, now.toISOString()],
    );
    if (!result.rowCount) {
      throw new Error("Workflow job lease was lost before completion");
    }
  }

  async retryOrDeadLetter(input: {
    jobId: string;
    leaseToken: string;
    retryAt?: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    const now = (this.options.now ?? (() => new Date()))();
    await this.database.transaction(async (transaction) => {
      const result = await transaction.query<{ id: string }>(
        `UPDATE workflow_outbox
         SET state = $3, next_attempt_at = COALESCE($4::timestamptz, next_attempt_at),
             last_error_code = $6, last_error_message = $7, lease_token = NULL,
             lease_expires_at = NULL
         WHERE id = $1 AND state = 'leased' AND lease_token = $2
           AND lease_expires_at > $5
         RETURNING id`,
        [
          input.jobId,
          input.leaseToken,
          input.retryAt ? "retry" : "dead_letter",
          input.retryAt ?? null,
          now.toISOString(),
          input.errorCode,
          input.errorMessage,
        ],
      );
      if (!result.rowCount) {
        throw new Error("Workflow job lease was lost before failure handling");
      }
      if (!input.retryAt) {
        await transaction.query(
          `INSERT INTO workflow_dead_letters (
             id, outbox_job_id, error_code, error_message
           ) VALUES ($1, $2, $3, $4)`,
          [randomUUID(), input.jobId, input.errorCode, input.errorMessage],
        );
      }
    });
  }
}
