import type { CouponThreeSourceTask } from "../../../coupon-oa/three-source/task";

/**
 * Runtime persistence boundary for the R2 task aggregate. The in-memory
 * implementation exists solely for deterministic tests; R2 activation must
 * bind this port to the durable PostgreSQL receipt/idempotency/CAS adapter.
 */
export interface CouponThreeSourceTaskRepository {
  getById(taskId: string): Promise<CouponThreeSourceTask | undefined>;
  getActiveByOwner(
    ownerOpenId: string,
  ): Promise<CouponThreeSourceTask | undefined>;
  getOperationResult(input: {
    taskId: string;
    operationId: string;
  }): Promise<CouponThreeSourceTask | undefined>;
  create(task: CouponThreeSourceTask): Promise<CouponThreeSourceTask>;
  replace(input: {
    task: CouponThreeSourceTask;
    expectedRevision: number;
    operationId: string;
  }): Promise<CouponThreeSourceTask>;
}

export class InMemoryCouponThreeSourceTaskRepository
  implements CouponThreeSourceTaskRepository
{
  private readonly tasks = new Map<string, CouponThreeSourceTask>();
  private readonly operations = new Map<string, CouponThreeSourceTask>();

  async getById(taskId: string): Promise<CouponThreeSourceTask | undefined> {
    return this.tasks.get(taskId);
  }

  async getActiveByOwner(
    ownerOpenId: string,
  ): Promise<CouponThreeSourceTask | undefined> {
    return [...this.tasks.values()].find(
      (task) =>
        task.ownerOpenId === ownerOpenId &&
        !["DraftOnlyConfirmed", "Canceled"].includes(task.status),
    );
  }

  async getOperationResult(input: {
    taskId: string;
    operationId: string;
  }): Promise<CouponThreeSourceTask | undefined> {
    return this.operations.get(`${input.taskId}:${input.operationId}`);
  }

  async create(task: CouponThreeSourceTask): Promise<CouponThreeSourceTask> {
    if (this.tasks.has(task.taskId)) {
      throw new Error("三源提报任务已存在");
    }
    if (await this.getActiveByOwner(task.ownerOpenId)) {
      throw new Error("当前业务员已有未完成的三源提报");
    }
    this.tasks.set(task.taskId, task);
    return task;
  }

  async replace(input: {
    task: CouponThreeSourceTask;
    expectedRevision: number;
    operationId: string;
  }): Promise<CouponThreeSourceTask> {
    const current = this.tasks.get(input.task.taskId);
    if (!current) throw new Error("三源提报任务不存在");
    const operationKey = `${input.task.taskId}:${input.operationId}`;
    const previous = this.operations.get(operationKey);
    if (previous) return previous;
    if (current.revision !== input.expectedRevision) {
      throw new Error("三源提报版本已变化，请使用最新卡片");
    }
    this.tasks.set(input.task.taskId, input.task);
    this.operations.set(operationKey, input.task);
    return input.task;
  }
}
