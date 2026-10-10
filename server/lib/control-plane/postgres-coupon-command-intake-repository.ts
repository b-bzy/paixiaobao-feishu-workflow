import { randomUUID } from "node:crypto";
import {
  type CouponThreeSourceTask,
  createCouponThreeSourceTask,
} from "../coupon-oa/three-source/task";
import type {
  CommandIntakeRepository,
  DeliveryOutcome,
  PersistedFeishuDelivery,
} from "./durable-command-intake";
import { sha256, stableJson } from "./idempotency";
import type { SqlExecutor, TransactionalSqlDatabase } from "./sql";

const intakeEffectKind = "coupon_three_source_intake_card";
const intakeCardPurpose = "collect_sources";

interface DeliveryRow extends Record<string, unknown> {
  id: string;
  schema_version: "feishu-delivery-v1";
  source: PersistedFeishuDelivery["source"];
  app_id: string;
  tenant_id: string;
  stable_delivery_id: string;
  event_type: string;
  actor_open_id?: string;
  message_id?: string;
  callback_id?: string;
  chat_type: PersistedFeishuDelivery["chatType"];
  chat_id?: string;
  received_at: string | Date;
  payload: Record<string, unknown>;
  payload_sha256: string;
  correlation_id: string;
}

interface OutcomeRow extends Record<string, unknown> {
  kind: DeliveryOutcome["kind"];
  reason?: string;
  task_id?: string;
  effect_id?: string;
}

interface TaskRow extends Record<string, unknown> {
  task: CouponThreeSourceTask;
}

interface EffectRow extends Record<string, unknown> {
  id: string;
}

function toIso(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function asDelivery(row: DeliveryRow): PersistedFeishuDelivery {
  return {
    receiptId: row.id,
    schemaVersion: row.schema_version,
    source: row.source,
    appId: row.app_id,
    tenantId: row.tenant_id || undefined,
    stableDeliveryId: row.stable_delivery_id,
    eventType: row.event_type,
    actorOpenId: row.actor_open_id,
    messageId: row.message_id,
    callbackId: row.callback_id,
    chatType: row.chat_type,
    chatId: row.chat_id,
    receivedAt: toIso(row.received_at),
    payload: row.payload,
    payloadSha256: row.payload_sha256,
    correlationId: row.correlation_id,
  };
}

function asOutcome(row: OutcomeRow): DeliveryOutcome {
  if (
    row.kind === "handled" &&
    typeof row.task_id === "string" &&
    typeof row.effect_id === "string"
  ) {
    return { kind: "handled", taskId: row.task_id, effectId: row.effect_id };
  }
  if (
    (row.kind === "ignored" || row.kind === "rejected") &&
    typeof row.reason === "string"
  ) {
    return { kind: row.kind, reason: row.reason };
  }
  throw new Error("Persisted delivery outcome is invalid");
}

async function existingOutcome(
  executor: SqlExecutor,
  receiptId: string,
): Promise<DeliveryOutcome | undefined> {
  const result = await executor.query<OutcomeRow>(
    `SELECT kind, reason, task_id, effect_id
     FROM feishu_delivery_outcomes
     WHERE receipt_id = $1`,
    [receiptId],
  );
  const row = result.rows[0];
  return row ? asOutcome(row) : undefined;
}

async function lockReceipt(
  transaction: SqlExecutor,
  receiptId: string,
): Promise<void> {
  const receipt = await transaction.query<{ id: string }>(
    "SELECT id FROM feishu_deliveries WHERE id = $1 FOR UPDATE",
    [receiptId],
  );
  if (!receipt.rowCount) {
    throw new Error("The durable delivery receipt no longer exists");
  }
}

/**
 * The command intake unit of work owns the only transaction that may create or
 * resume a task, write audit data, enqueue the card effect intent, and persist
 * the delivery result. The pre-existing aggregate repository remains suitable
 * for card-driven mutations, but its independent transactions are deliberately
 * not used here.
 */
export class PostgresCouponCommandIntakeRepository
  implements CommandIntakeRepository
{
  constructor(
    private readonly database: TransactionalSqlDatabase,
    private readonly options: { id?: () => string } = {},
  ) {}

  async getDelivery(
    receiptId: string,
  ): Promise<PersistedFeishuDelivery | undefined> {
    const result = await this.database.query<DeliveryRow>(
      `SELECT id, schema_version, source, app_id, tenant_id,
              stable_delivery_id, event_type, actor_open_id, message_id,
              callback_id, chat_type, chat_id, received_at, payload, payload_sha256,
              correlation_id
       FROM feishu_deliveries
       WHERE id = $1`,
      [receiptId],
    );
    const row = result.rows[0];
    return row ? asDelivery(row) : undefined;
  }

  async getOutcome(receiptId: string): Promise<DeliveryOutcome | undefined> {
    return existingOutcome(this.database, receiptId);
  }

  async recordTerminalOutcome(input: {
    receiptId: string;
    outcome: Extract<DeliveryOutcome, { kind: "ignored" | "rejected" }>;
  }): Promise<DeliveryOutcome> {
    return this.database.transaction(async (transaction) => {
      await lockReceipt(transaction, input.receiptId);
      const prior = await existingOutcome(transaction, input.receiptId);
      if (prior) return prior;

      const result = await transaction.query<OutcomeRow>(
        `INSERT INTO feishu_delivery_outcomes (receipt_id, kind, reason)
         VALUES ($1, $2, $3)
         RETURNING kind, reason, task_id, effect_id`,
        [input.receiptId, input.outcome.kind, input.outcome.reason],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Delivery terminal outcome was not persisted");
      return asOutcome(row);
    });
  }

  async startOrResume(input: {
    receiptId: string;
    ownerOpenId: string;
  }): Promise<Extract<DeliveryOutcome, { kind: "handled" }>> {
    if (!/^ou_[a-zA-Z0-9]+$/.test(input.ownerOpenId)) {
      throw new Error("Command intake owner is invalid");
    }

    return this.database.transaction(async (transaction) => {
      await lockReceipt(transaction, input.receiptId);
      const prior = await existingOutcome(transaction, input.receiptId);
      if (prior) {
        if (prior.kind !== "handled") {
          throw new Error(
            "Delivery already has a terminal non-command outcome",
          );
        }
        return prior;
      }

      // Serializes first-command races for one owner. The active-task partial
      // unique index remains the durable final invariant.
      await transaction.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [input.ownerOpenId],
      );
      const active = await transaction.query<TaskRow>(
        `SELECT task FROM coupon_tasks
         WHERE owner_open_id = $1 AND route = 'three_source' AND closed_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [input.ownerOpenId],
      );

      let task = active.rows[0]?.task;
      const resumed = Boolean(task);
      if (!task) {
        task = createCouponThreeSourceTask({
          taskId: `CTS-${this.makeId()}`,
          ownerOpenId: input.ownerOpenId,
        });
        await transaction.query(
          `INSERT INTO coupon_tasks (
             id, owner_open_id, route, state, revision, version, policy_version, task
           ) VALUES ($1, $2, 'three_source', $3, $4, 1, $5, $6::jsonb)`,
          [
            task.taskId,
            task.ownerOpenId,
            task.status,
            task.revision,
            task.schemaVersion,
            JSON.stringify(task),
          ],
        );
        await transaction.query(
          `INSERT INTO coupon_task_revisions (
             task_id, revision, source_confirmation, source_confirmation_sha256,
             final_snapshot, final_snapshot_sha256, rule_version
           ) VALUES ($1, $2, NULL, NULL, NULL, NULL, $3)`,
          [task.taskId, task.revision, task.schemaVersion],
        );
      }

      const operationId = `three-source:intake:${input.receiptId}`;
      await transaction.query(
        `INSERT INTO coupon_task_operations (task_id, operation_id, result_task)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT DO NOTHING`,
        [task.taskId, operationId, JSON.stringify(task)],
      );
      await transaction.query(
        `INSERT INTO workflow_audit_events (
           id, task_id, revision, delivery_id, actor_open_id, action, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          this.makeId(),
          task.taskId,
          task.revision,
          input.receiptId,
          task.ownerOpenId,
          resumed
            ? "three_source.command_resumed"
            : "three_source.command_started",
          JSON.stringify({ operationId, route: "three_source" }),
        ],
      );

      const semanticKey = `coupon-intake-card:${task.taskId}:${task.revision}`;
      const requestPayload = {
        version: "coupon-intake-card-v1",
        taskId: task.taskId,
        revision: task.revision,
        ownerOpenId: task.ownerOpenId,
        purpose: intakeCardPurpose,
      };
      const insertedEffect = await transaction.query<EffectRow>(
        `INSERT INTO effect_receipts (
           id, task_id, kind, semantic_key, request_sha256, request_payload, state
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'queued')
         ON CONFLICT (kind, semantic_key) DO NOTHING
         RETURNING id`,
        [
          this.makeId(),
          task.taskId,
          intakeEffectKind,
          semanticKey,
          sha256(stableJson(requestPayload)),
          JSON.stringify(requestPayload),
        ],
      );
      let effectId = insertedEffect.rows[0]?.id;
      if (!effectId) {
        const priorEffect = await transaction.query<EffectRow>(
          `SELECT id FROM effect_receipts
           WHERE kind = $1 AND semantic_key = $2`,
          [intakeEffectKind, semanticKey],
        );
        effectId = priorEffect.rows[0]?.id;
      }
      if (!effectId) throw new Error("Intake card effect was not persisted");

      const persistedOutcome = await transaction.query<OutcomeRow>(
        `INSERT INTO feishu_delivery_outcomes (
           receipt_id, kind, task_id, effect_id
         ) VALUES ($1, 'handled', $2, $3)
         RETURNING kind, reason, task_id, effect_id`,
        [input.receiptId, task.taskId, effectId],
      );
      const outcome = persistedOutcome.rows[0];
      if (!outcome)
        throw new Error("Delivery handled outcome was not persisted");
      return asOutcome(outcome) as Extract<
        DeliveryOutcome,
        { kind: "handled" }
      >;
    });
  }

  private makeId(): string {
    return (this.options.id ?? randomUUID)();
  }
}
