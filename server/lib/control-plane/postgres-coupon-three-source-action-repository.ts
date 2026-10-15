import { createHash, randomUUID } from "node:crypto";
import type { TransactionalSqlDatabase } from "./sql";

export const couponThreeSourceActionEffectKind = "coupon_three_source_action";

export function couponThreeSourceActionSemanticKey(input: {
  taskId: string;
  revision: number;
  actionName: string;
  mappingContextHash: string;
}): string {
  return [
    input.taskId,
    input.revision,
    input.actionName,
    input.mappingContextHash,
  ].join(":");
}

export type CouponThreeSourceActionClaim =
  | { state: "claimed"; effectId: string; leaseToken: string }
  | {
      state: "in_progress" | "succeeded" | "outcome_unknown" | "failed";
      effectId: string;
    };

interface ActionRow extends Record<string, unknown> {
  id: string;
  state: "queued" | "sending" | "succeeded" | "outcome_unknown" | "failed";
  lease_expires_at?: string | Date;
}

function requestSha256(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export class PostgresCouponThreeSourceActionRepository {
  constructor(
    private readonly database: TransactionalSqlDatabase,
    private readonly options: {
      now?: () => Date;
      id?: () => string;
      token?: () => string;
    } = {},
  ) {}

  async prepareAndClaim(input: {
    semanticKey: string;
    requestPayload: Record<string, unknown>;
    leaseMs?: number;
  }): Promise<CouponThreeSourceActionClaim> {
    const now = (this.options.now ?? (() => new Date()))();
    const leaseMs = input.leaseMs ?? 120_000;
    if (!input.semanticKey.trim())
      throw new Error("Action semantic key is required");
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000) {
      throw new Error("Action lease must be at least one second");
    }
    return this.database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO effect_receipts (
           id, task_id, kind, semantic_key, request_sha256, request_payload, state
         ) VALUES ($1, NULL, $2, $3, $4, $5::jsonb, 'queued')
         ON CONFLICT (kind, semantic_key) DO NOTHING`,
        [
          (this.options.id ?? randomUUID)(),
          couponThreeSourceActionEffectKind,
          input.semanticKey,
          requestSha256(input.requestPayload),
          JSON.stringify(input.requestPayload),
        ],
      );
      const selected = await transaction.query<ActionRow>(
        `SELECT id, state, lease_expires_at
         FROM effect_receipts
         WHERE kind = $1 AND semantic_key = $2
         FOR UPDATE`,
        [couponThreeSourceActionEffectKind, input.semanticKey],
      );
      const row = selected.rows[0];
      if (!row) throw new Error("Coupon action effect was not persisted");
      if (row.state === "succeeded")
        return { state: "succeeded", effectId: row.id };
      if (row.state === "outcome_unknown") {
        return { state: "outcome_unknown", effectId: row.id };
      }
      const leaseExpiresAt = row.lease_expires_at
        ? new Date(row.lease_expires_at).getTime()
        : 0;
      if (row.state === "sending" && leaseExpiresAt > now.getTime()) {
        return { state: "in_progress", effectId: row.id };
      }
      const leaseToken = (this.options.token ?? randomUUID)();
      const nextLease = new Date(now.getTime() + leaseMs).toISOString();
      await transaction.query(
        `UPDATE effect_receipts
         SET state = 'sending', lease_token = $2, lease_expires_at = $3,
             attempts = attempts + 1, updated_at = now()
         WHERE id = $1`,
        [row.id, leaseToken, nextLease],
      );
      return { state: "claimed", effectId: row.id, leaseToken };
    });
  }

  async complete(input: {
    effectId: string;
    leaseToken: string;
    externalReference?: string;
  }): Promise<void> {
    await this.settle({
      ...input,
      state: "succeeded",
      externalReference: input.externalReference,
    });
  }

  async fail(input: {
    effectId: string;
    leaseToken: string;
    errorCode: string;
    errorMessage: string;
    outcomeUnknown?: boolean;
  }): Promise<void> {
    await this.settle({
      ...input,
      state: input.outcomeUnknown ? "outcome_unknown" : "failed",
    });
  }

  private async settle(input: {
    effectId: string;
    leaseToken: string;
    state: "succeeded" | "failed" | "outcome_unknown";
    externalReference?: string;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<void> {
    const result = await this.database.query(
      `UPDATE effect_receipts
       SET state = $3, external_reference = $4, last_error_code = $5,
           last_error_message = $6, completed_at = CASE WHEN $3 = 'succeeded'
             THEN now() ELSE completed_at END,
           lease_token = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE id = $1 AND state = 'sending' AND lease_token = $2`,
      [
        input.effectId,
        input.leaseToken,
        input.state,
        input.externalReference ?? null,
        input.errorCode ?? null,
        input.errorMessage ?? null,
      ],
    );
    if (!result.rowCount) throw new Error("Coupon action lease was lost");
  }
}
