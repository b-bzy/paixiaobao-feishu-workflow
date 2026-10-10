import { randomUUID } from "node:crypto";
import type {
  AiAuditSummary,
  ValidatedAiRecognition,
} from "../coupon-oa/three-source/types";
import { sha256, stableJson } from "./idempotency";
import type { SqlExecutor, TransactionalSqlDatabase } from "./sql";

export const couponAiRecognitionEffectKind =
  "coupon_three_source_ai_recognition";

export type CouponAiRecognitionStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "outcome_unknown";

export interface CouponAiRecognitionRun {
  id: string;
  semanticKey: string;
  pilotRecordId: string;
  businessTaskId: string;
  ownerOpenId: string;
  revision: number;
  sourceSlot: "couponTable" | "whitelist" | "blacklist" | "pending";
  sourceReference: Record<string, unknown>;
  sourceSha256: string;
  sourceFileName: string;
  provider: "deepseek";
  model: string;
  promptVersion: string;
  status: CouponAiRecognitionStatus;
  result?: ValidatedAiRecognition;
  audit?: AiAuditSummary;
  fallbackCode?: string;
  projectedAt?: string;
}

export interface CouponAiRecognitionRepository {
  prepare(input: {
    semanticKey: string;
    pilotRecordId: string;
    businessTaskId: string;
    ownerOpenId: string;
    revision: number;
    sourceSlot: CouponAiRecognitionRun["sourceSlot"];
    sourceReference: Record<string, unknown>;
    sourceSha256: string;
    sourceFileName: string;
    model: string;
    promptVersion: string;
  }): Promise<CouponAiRecognitionRun>;
  activate(run: CouponAiRecognitionRun): Promise<void>;
  enqueue(input: {
    semanticKey: string;
    pilotRecordId: string;
    businessTaskId: string;
    ownerOpenId: string;
    revision: number;
    sourceSlot: CouponAiRecognitionRun["sourceSlot"];
    sourceReference: Record<string, unknown>;
    sourceSha256: string;
    sourceFileName: string;
    model: string;
    promptVersion: string;
  }): Promise<CouponAiRecognitionRun>;
  get(runId: string): Promise<CouponAiRecognitionRun | undefined>;
  saveTerminalResult(input: {
    runId: string;
    status: Exclude<CouponAiRecognitionStatus, "pending">;
    result?: ValidatedAiRecognition;
    audit: AiAuditSummary;
    fallbackCode?: string;
  }): Promise<CouponAiRecognitionRun>;
  markProjected(runId: string): Promise<void>;
}

interface RunRow extends Record<string, unknown> {
  id: string;
  semantic_key: string;
  pilot_record_id: string;
  business_task_id: string;
  owner_open_id: string;
  revision: number;
  source_slot: CouponAiRecognitionRun["sourceSlot"];
  source_reference: Record<string, unknown>;
  source_sha256: string;
  source_file_name: string;
  provider: "deepseek";
  model: string;
  prompt_version: string;
  status: CouponAiRecognitionStatus;
  request_sha256?: string;
  response_sha256?: string;
  started_at?: string | Date;
  completed_at?: string | Date;
  duration_ms?: number;
  validated_result?: ValidatedAiRecognition;
  fallback_code?: string;
  projected_at?: string | Date;
}

function iso(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function asRun(row: RunRow): CouponAiRecognitionRun {
  const startedAt = iso(row.started_at);
  const completedAt = iso(row.completed_at);
  const audit =
    startedAt && completedAt && typeof row.duration_ms === "number"
      ? {
          provider: row.provider,
          model: row.model,
          promptVersion: row.prompt_version,
          status:
            row.status === "succeeded"
              ? ("succeeded" as const)
              : row.status === "outcome_unknown"
                ? ("outcome_unknown" as const)
                : ("failed" as const),
          requestSha256: row.request_sha256,
          responseSha256: row.response_sha256,
          startedAt,
          completedAt,
          durationMs: row.duration_ms,
          fallbackReason: row.fallback_code,
        }
      : undefined;
  return {
    id: row.id,
    semanticKey: row.semantic_key,
    pilotRecordId: row.pilot_record_id,
    businessTaskId: row.business_task_id,
    ownerOpenId: row.owner_open_id,
    revision: row.revision,
    sourceSlot: row.source_slot,
    sourceReference: row.source_reference,
    sourceSha256: row.source_sha256,
    sourceFileName: row.source_file_name,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    status: row.status,
    result: row.validated_result,
    audit,
    fallbackCode: row.fallback_code,
    projectedAt: iso(row.projected_at),
  };
}

const runColumns = `id, semantic_key, pilot_record_id, business_task_id,
  owner_open_id, revision, source_slot, source_reference, source_sha256,
  source_file_name, provider, model, prompt_version, status, request_sha256,
  response_sha256, started_at, completed_at, duration_ms, validated_result,
  fallback_code, projected_at`;

async function getById(
  executor: SqlExecutor,
  runId: string,
): Promise<CouponAiRecognitionRun | undefined> {
  const result = await executor.query<RunRow>(
    `SELECT ${runColumns} FROM coupon_ai_recognition_runs WHERE id = $1`,
    [runId],
  );
  return result.rows[0] ? asRun(result.rows[0]) : undefined;
}

export class PostgresCouponAiRecognitionRepository
  implements CouponAiRecognitionRepository
{
  constructor(
    private readonly database: TransactionalSqlDatabase,
    private readonly options: { id?: () => string } = {},
  ) {}

  async enqueue(
    input: Parameters<CouponAiRecognitionRepository["enqueue"]>[0],
  ): Promise<CouponAiRecognitionRun> {
    const run = await this.prepare(input);
    await this.activate(run);
    return run;
  }

  async prepare(
    input: Parameters<CouponAiRecognitionRepository["prepare"]>[0],
  ): Promise<CouponAiRecognitionRun> {
    if (!input.semanticKey.trim())
      throw new Error("AI semantic key is required");
    if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
      throw new Error("AI recognition revision is invalid");
    }
    return this.database.transaction(async (transaction) => {
      const id = this.makeId();
      const inserted = await transaction.query<RunRow>(
        `INSERT INTO coupon_ai_recognition_runs (
           id, semantic_key, pilot_record_id, business_task_id, owner_open_id,
           revision, source_slot, source_reference, source_sha256,
           source_file_name, provider, model, prompt_version
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10,
                   'deepseek', $11, $12)
         ON CONFLICT (semantic_key) DO NOTHING
         RETURNING ${runColumns}`,
        [
          id,
          input.semanticKey,
          input.pilotRecordId,
          input.businessTaskId,
          input.ownerOpenId,
          input.revision,
          input.sourceSlot,
          JSON.stringify(input.sourceReference),
          input.sourceSha256,
          input.sourceFileName,
          input.model,
          input.promptVersion,
        ],
      );
      let run = inserted.rows[0] ? asRun(inserted.rows[0]) : undefined;
      if (!run) {
        const prior = await transaction.query<RunRow>(
          `SELECT ${runColumns} FROM coupon_ai_recognition_runs WHERE semantic_key = $1`,
          [input.semanticKey],
        );
        if (prior.rows[0]) run = asRun(prior.rows[0]);
      }
      if (!run) throw new Error("AI recognition run was not persisted");

      return run;
    });
  }

  async activate(run: CouponAiRecognitionRun): Promise<void> {
    const payload = {
      version: "coupon-ai-recognition-effect-v1",
      runId: run.id,
      businessTaskId: run.businessTaskId,
    };
    await this.database.query(
      `INSERT INTO effect_receipts (
         id, task_id, kind, semantic_key, request_sha256,
         request_payload, state
       ) VALUES ($1, NULL, $2, $3, $4, $5::jsonb, 'queued')
       ON CONFLICT (kind, semantic_key) DO NOTHING`,
      [
        this.makeId(),
        couponAiRecognitionEffectKind,
        `coupon-ai:${run.semanticKey}`,
        sha256(stableJson(payload)),
        JSON.stringify(payload),
      ],
    );
  }

  get(runId: string): Promise<CouponAiRecognitionRun | undefined> {
    return getById(this.database, runId);
  }

  async saveTerminalResult(
    input: Parameters<CouponAiRecognitionRepository["saveTerminalResult"]>[0],
  ): Promise<CouponAiRecognitionRun> {
    const result = await this.database.query<RunRow>(
      `UPDATE coupon_ai_recognition_runs
       SET status = $2, request_sha256 = $3, response_sha256 = $4,
           started_at = $5, completed_at = $6, duration_ms = $7,
           validated_result = $8::jsonb, fallback_code = $9, updated_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING ${runColumns}`,
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
    if (!prior) throw new Error("AI recognition run was not found");
    return prior;
  }

  async markProjected(runId: string): Promise<void> {
    const result = await this.database.query(
      `UPDATE coupon_ai_recognition_runs
       SET projected_at = COALESCE(projected_at, now()), updated_at = now()
       WHERE id = $1 AND status <> 'pending'`,
      [runId],
    );
    if (!result.rowCount) {
      throw new Error("AI recognition terminal run was not found");
    }
  }

  private makeId(): string {
    return (this.options.id ?? randomUUID)();
  }
}
