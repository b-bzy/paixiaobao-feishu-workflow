import { randomUUID } from "node:crypto";
import type { CouponThreeSourceTask } from "../coupon-oa/three-source/task";
import type { CouponThreeSourceTaskRepository } from "../feishu/coupon-oa/three-source/task-repository";
import {
  ControlPlaneConflictError,
  type SqlExecutor,
  type TransactionalSqlDatabase,
} from "./sql";

interface TaskRow extends Record<string, unknown> {
  task?: CouponThreeSourceTask;
}

function closedAt(task: CouponThreeSourceTask): string | null {
  return ["DraftOnlyConfirmed", "Canceled"].includes(task.status)
    ? new Date().toISOString()
    : null;
}

/**
 * Durable adapter for the existing pure three-source aggregate. PostgreSQL
 * performs the owner uniqueness, operation idempotency and revision CAS that
 * the temporary in-memory repository cannot provide.
 */
export class PostgresCouponThreeSourceTaskRepository
  implements CouponThreeSourceTaskRepository
{
  constructor(private readonly database: TransactionalSqlDatabase) {}

  async getById(taskId: string): Promise<CouponThreeSourceTask | undefined> {
    const result = await this.database.query<TaskRow>(
      "SELECT task FROM coupon_tasks WHERE id = $1 AND route = 'three_source'",
      [taskId],
    );
    return result.rows[0]?.task;
  }

  async getActiveByOwner(
    ownerOpenId: string,
  ): Promise<CouponThreeSourceTask | undefined> {
    const result = await this.database.query<TaskRow>(
      `SELECT task FROM coupon_tasks
       WHERE owner_open_id = $1 AND route = 'three_source' AND closed_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [ownerOpenId],
    );
    return result.rows[0]?.task;
  }

  async getOperationResult(input: {
    taskId: string;
    operationId: string;
  }): Promise<CouponThreeSourceTask | undefined> {
    const result = await this.database.query<TaskRow>(
      `SELECT result_task AS task FROM coupon_task_operations
       WHERE task_id = $1 AND operation_id = $2`,
      [input.taskId, input.operationId],
    );
    const row = result.rows[0];
    if (row && !row.task) {
      throw new ControlPlaneConflictError(
        "Coupon task operation is still being committed",
      );
    }
    return row?.task;
  }

  async create(task: CouponThreeSourceTask): Promise<CouponThreeSourceTask> {
    await this.database.transaction(async (transaction) => {
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
      await this.upsertRevision(transaction, task);
      await this.audit(transaction, task, "three_source.task_created", {
        revision: task.revision,
      });
    });
    return task;
  }

  async replace(input: {
    task: CouponThreeSourceTask;
    expectedRevision: number;
    operationId: string;
  }): Promise<CouponThreeSourceTask> {
    return this.database.transaction(async (transaction) => {
      const operation = await transaction.query<{ task_id: string }>(
        `INSERT INTO coupon_task_operations (task_id, operation_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING
         RETURNING task_id`,
        [input.task.taskId, input.operationId],
      );
      if (!operation.rowCount) {
        const previous = await transaction.query<TaskRow>(
          `SELECT result_task AS task FROM coupon_task_operations
           WHERE task_id = $1 AND operation_id = $2`,
          [input.task.taskId, input.operationId],
        );
        const task = previous.rows[0]?.task;
        if (!task) {
          throw new ControlPlaneConflictError(
            "Coupon task operation is still being committed",
          );
        }
        return task;
      }

      const update = await transaction.query<{ id: string }>(
        `UPDATE coupon_tasks
         SET state = $3, revision = $4, version = version + 1, task = $5::jsonb,
             closed_at = $6::timestamptz, updated_at = now()
         WHERE id = $1 AND route = 'three_source' AND revision = $2
           AND closed_at IS NULL
         RETURNING id`,
        [
          input.task.taskId,
          input.expectedRevision,
          input.task.status,
          input.task.revision,
          JSON.stringify(input.task),
          closedAt(input.task),
        ],
      );
      if (!update.rowCount) {
        throw new ControlPlaneConflictError(
          "Coupon task revision changed; reopen the latest card",
        );
      }

      await this.upsertRevision(transaction, input.task);
      await transaction.query(
        `UPDATE coupon_task_operations
         SET result_task = $3::jsonb
         WHERE task_id = $1 AND operation_id = $2`,
        [input.task.taskId, input.operationId, JSON.stringify(input.task)],
      );
      await this.audit(
        transaction,
        input.task,
        "three_source.task_transition",
        {
          operationId: input.operationId,
          expectedRevision: input.expectedRevision,
          resultingRevision: input.task.revision,
          status: input.task.status,
        },
      );
      return input.task;
    });
  }

  private async upsertRevision(
    transaction: SqlExecutor,
    task: CouponThreeSourceTask,
  ): Promise<void> {
    await transaction.query(
      `INSERT INTO coupon_task_revisions (
         task_id, revision, source_confirmation, source_confirmation_sha256,
         final_snapshot, final_snapshot_sha256, rule_version
       ) VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6, $7)
       ON CONFLICT (task_id, revision) DO UPDATE
       SET source_confirmation = EXCLUDED.source_confirmation,
           source_confirmation_sha256 = EXCLUDED.source_confirmation_sha256,
           final_snapshot = EXCLUDED.final_snapshot,
           final_snapshot_sha256 = EXCLUDED.final_snapshot_sha256`,
      [
        task.taskId,
        task.revision,
        task.sourceConfirmation
          ? JSON.stringify(task.sourceConfirmation)
          : null,
        task.sourceConfirmation?.snapshotHash ?? null,
        task.finalConfirmation ? JSON.stringify(task.finalConfirmation) : null,
        task.finalConfirmation?.snapshotHash ?? null,
        task.schemaVersion,
      ],
    );
  }

  private async audit(
    transaction: SqlExecutor,
    task: CouponThreeSourceTask,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await transaction.query(
      `INSERT INTO workflow_audit_events (
         id, task_id, revision, actor_open_id, action, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        randomUUID(),
        task.taskId,
        task.revision,
        task.ownerOpenId,
        action,
        JSON.stringify(metadata),
      ],
    );
  }
}
