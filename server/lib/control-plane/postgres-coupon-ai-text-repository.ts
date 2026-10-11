import { randomUUID } from "node:crypto";
import type { ValidatedCouponSupplementText } from "../coupon-oa/three-source/ai-text";
import type { AiAuditSummary } from "../coupon-oa/three-source/types";
import { sha256, stableJson } from "./idempotency";
import type { SqlExecutor, TransactionalSqlDatabase } from "./sql";

export const couponAiTextEffectKind = "coupon_three_source_ai_text";

export type CouponAiTextStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "outcome_unknown";

export interface CouponAiTextRun {
  id: string;
  semanticKey: string;
  pilotRecordId: string;
  businessTaskId: string;
  ownerOpenId: string;
  revision: number;
  supplementText: string;
  textSha256: string;
  provider: "deepseek";
  model: string;
  promptVersion: string;
  status: CouponAiTextStatus;
  result?: ValidatedCouponSupplementText;
  audit?: AiAuditSummary;
  fallbackCode?: string;
  projectedAt?: string;
}

export interface CouponAiTextRepository {
  prepare(
    input: Omit<CouponAiTextRun, "id" | "provider" | "status">,
  ): Promise<CouponAiTextRun>;
  activate(run: CouponAiTextRun): Promise<void>;
  get(runId: string): Promise<CouponAiTextRun | undefined>;
  saveTerminalResult(input: {
    runId: string;
    status: Exclude<CouponAiTextStatus, "pending">;
    result?: ValidatedCouponSupplementText;
    audit: AiAuditSummary;
    fallbackCode?: string;
  }): Promise<CouponAiTextRun>;
  markProjected(runId: string): Promise<void>;
}

interface RunRow extends Record<string, unknown> {
  id: string;
  semantic_key: string;
  pilot_record_id: string;
  business_task_id: string;
  owner_open_id: string;
  revision: number;
  supplement_text: string;
  text_sha256: string;
  provider: "deepseek";
  model: string;
  prompt_version: string;
  status: CouponAiTextStatus;
  request_sha256?: string;
  response_sha256?: string;
  started_at?: string | Date;
  completed_at?: string | Date;
  duration_ms?: number;
  validated_result?: ValidatedCouponSupplementText;
  fallback_code?: string;
  projected_at?: string | Date;
}

const columns = `id, semantic_key, pilot_record_id, business_task_id,
  owner_open_id, revision, supplement_text, text_sha256, provider, model,
  prompt_version, status, request_sha256, response_sha256, started_at,
  completed_at, duration_ms, validated_result, fallback_code, projected_at`;

function iso(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function asRun(row: RunRow): CouponAiTextRun {
  const startedAt = iso(row.started_at);
  const completedAt = iso(row.completed_at);
  return {
    id: row.id,
    semanticKey: row.semantic_key,
    pilotRecordId: row.pilot_record_id,
    businessTaskId: row.business_task_id,
    ownerOpenId: row.owner_open_id,
    revision: row.revision,
    supplementText: row.supplement_text,
    textSha256: row.text_sha256,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    status: row.status,
    result: row.validated_result,
    audit:
      startedAt && completedAt && typeof row.duration_ms === "number"
        ? {
            provider: row.provider,
            model: row.model,
            promptVersion: row.prompt_version,
            status:
              row.status === "succeeded"
                ? "succeeded"
                : row.status === "outcome_unknown"
                  ? "outcome_unknown"
                  : "failed",
            requestSha256: row.request_sha256,
            responseSha256: row.response_sha256,
            startedAt,
            completedAt,
            durationMs: row.duration_ms,
            fallbackReason: row.fallback_code,
          }
        : undefined,
    fallbackCode: row.fallback_code,
    projectedAt: iso(row.projected_at),
  };
}

async function getById(executor: SqlExecutor, id: string) {
  const result = await executor.query<RunRow>(
    `SELECT ${columns} FROM coupon_ai_text_runs WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? asRun(result.rows[0]) : undefined;
}

export class PostgresCouponAiTextRepository implements CouponAiTextRepository {
  constructor(
    private readonly database: TransactionalSqlDatabase,
    private readonly options: { id?: () => string } = {},
  ) {}

  async prepare(
    input: Omit<CouponAiTextRun, "id" | "provider" | "status">,
  ): Promise<CouponAiTextRun> {
    if (!input.semanticKey.trim() || !input.supplementText.trim()) {
      throw new Error("AI supplement semantic key and text are required");
    }
    return this.database.transaction(async (transaction) => {
      const inserted = await transaction.query<RunRow>(
        `INSERT INTO coupon_ai_text_runs (
           id, semantic_key, pilot_record_id, business_task_id, owner_open_id,
           revision, supplement_text, text_sha256, provider, model, prompt_version
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'deepseek', $9, $10)
         ON CONFLICT (semantic_key) DO NOTHING RETURNING ${columns}`,
        [
          this.makeId(),
          input.semanticKey,
          input.pilotRecordId,
          input.businessTaskId,
          input.ownerOpenId,
          input.revision,
          input.supplementText,
          input.textSha256,
          input.model,
          input.promptVersion,
        ],
      );
      if (inserted.rows[0]) return asRun(inserted.rows[0]);
      const prior = await transaction.query<RunRow>(
        `SELECT ${columns} FROM coupon_ai_text_runs WHERE semantic_key = $1`,
        [input.semanticKey],
      );
      if (!prior.rows[0])
        throw new Error("AI supplement run was not persisted");
      return asRun(prior.rows[0]);
    });
  }

  async activate(run: CouponAiTextRun): Promise<void> {
    const payload = {
      version: "coupon-ai-text-effect-v1",
      runId: run.id,
      businessTaskId: run.businessTaskId,
    };
    await this.database.query(
      `INSERT INTO effect_receipts (
         id, task_id, kind, semantic_key, request_sha256, request_payload, state
       ) VALUES ($1, NULL, $2, $3, $4, $5::jsonb, 'queued')
       ON CONFLICT (kind, semantic_key) DO NOTHING`,
      [
        this.makeId(),
        couponAiTextEffectKind,
        `coupon-ai-text:${run.semanticKey}`,
        sha256(stableJson(payload)),
        JSON.stringify(payload),
      ],
    );
  }

  get(runId: string): Promise<CouponAiTextRun | undefined> {
    return getById(this.database, runId);
  }

  async saveTerminalResult(
    input: Parameters<CouponAiTextRepository["saveTerminalResult"]>[0],
  ): Promise<CouponAiTextRun> {
    const result = await this.database.query<RunRow>(
      `UPDATE coupon_ai_text_runs
       SET status = $2, request_sha256 = $3, response_sha256 = $4,
           started_at = $5, completed_at = $6, duration_ms = $7,
           validated_result = $8::jsonb, fallback_code = $9, updated_at = now()
       WHERE id = $1 AND status = 'pending' RETURNING ${columns}`,
      [
        input.runId,
        input.status,
        input.audit.requestSha256 ?? null,
        input.audit.responseSha256 ?? null,
        input.audit.startedAt,
        input.audit.completedAt,
        input.audit.durationMs,
        input.result ? JSON.stringify(input.result) : null,
        input.fallbackCode ?? null,
      ],
    );
    if (result.rows[0]) return asRun(result.rows[0]);
    const prior = await getById(this.database, input.runId);
    if (!prior) throw new Error("AI supplement run was not found");
    return prior;
  }

  async markProjected(runId: string): Promise<void> {
    const result = await this.database.query(
      `UPDATE coupon_ai_text_runs
       SET projected_at = COALESCE(projected_at, now()), updated_at = now()
       WHERE id = $1 AND status <> 'pending'`,
      [runId],
    );
    if (!result.rowCount)
      throw new Error("AI supplement terminal run was not found");
  }

  private makeId(): string {
    return (this.options.id ?? randomUUID)();
  }
}
