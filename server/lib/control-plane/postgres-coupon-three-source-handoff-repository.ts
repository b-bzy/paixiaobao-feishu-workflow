import type { TransactionalSqlDatabase } from "./sql";

export interface CouponThreeSourceHandoff {
  sourceIdentity: string;
  taskId: string;
  revision: number;
  confirmationSnapshotHash: string;
  state: "pending" | "created" | "outcome_unknown" | "failed";
  oaDraftRecordId?: string;
  errorCode?: string;
}

interface HandoffRow extends Record<string, unknown> {
  source_identity: string;
  task_id: string;
  revision: number;
  confirmation_snapshot_hash: string;
  state: CouponThreeSourceHandoff["state"];
  oa_draft_record_id?: string;
  error_code?: string;
}

function asHandoff(row: HandoffRow): CouponThreeSourceHandoff {
  return {
    sourceIdentity: row.source_identity,
    taskId: row.task_id,
    revision: row.revision,
    confirmationSnapshotHash: row.confirmation_snapshot_hash,
    state: row.state,
    oaDraftRecordId: row.oa_draft_record_id || undefined,
    errorCode: row.error_code || undefined,
  };
}

const returning = `source_identity, task_id, revision,
  confirmation_snapshot_hash, state, oa_draft_record_id, error_code`;

export class PostgresCouponThreeSourceHandoffRepository {
  constructor(private readonly database: TransactionalSqlDatabase) {}

  async prepare(input: {
    sourceIdentity: string;
    taskId: string;
    revision: number;
    confirmationSnapshotHash: string;
  }): Promise<CouponThreeSourceHandoff> {
    const result = await this.database.query<HandoffRow>(
      `INSERT INTO coupon_three_source_handoffs (
         source_identity, task_id, revision, confirmation_snapshot_hash
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT (source_identity) DO UPDATE
       SET source_identity = EXCLUDED.source_identity
       RETURNING ${returning}`,
      [
        input.sourceIdentity,
        input.taskId,
        input.revision,
        input.confirmationSnapshotHash,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("OA handoff intent was not persisted");
    return asHandoff(row);
  }

  async getByIdentity(
    sourceIdentity: string,
  ): Promise<CouponThreeSourceHandoff | undefined> {
    const result = await this.database.query<HandoffRow>(
      `SELECT ${returning}
       FROM coupon_three_source_handoffs WHERE source_identity = $1`,
      [sourceIdentity],
    );
    return result.rows[0] ? asHandoff(result.rows[0]) : undefined;
  }

  async markCreated(input: {
    sourceIdentity: string;
    oaDraftRecordId: string;
  }): Promise<void> {
    await this.update(input.sourceIdentity, "created", {
      oaDraftRecordId: input.oaDraftRecordId,
    });
  }

  async markOutcomeUnknown(input: {
    sourceIdentity: string;
    errorCode: string;
  }): Promise<void> {
    await this.update(input.sourceIdentity, "outcome_unknown", {
      errorCode: input.errorCode,
    });
  }

  private async update(
    sourceIdentity: string,
    state: "created" | "outcome_unknown",
    value: { oaDraftRecordId?: string; errorCode?: string },
  ): Promise<void> {
    const result = await this.database.query(
      `UPDATE coupon_three_source_handoffs
       SET state = $2, oa_draft_record_id = COALESCE($3, oa_draft_record_id),
           error_code = $4, updated_at = now()
       WHERE source_identity = $1`,
      [
        sourceIdentity,
        state,
        value.oaDraftRecordId ?? null,
        value.errorCode ?? null,
      ],
    );
    if (!result.rowCount) throw new Error("OA handoff intent was not found");
  }
}
