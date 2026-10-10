import { randomUUID } from "node:crypto";
import {
  type CouponThreeSourceArtifact,
  type CouponThreeSourceSourceFile,
  type CouponThreeSourceTask,
  cancelCouponThreeSourceTask,
  confirmCouponThreeSourceDraftOnly,
  confirmCouponThreeSourceNoBlacklist,
  confirmCouponThreeSourceSources,
  createCouponThreeSourceTask,
  replaceCouponThreeSourceSource,
  saveCouponThreeSourceArtifacts,
  setCouponThreeSourceOverlap,
} from "../../../coupon-oa/three-source/task";
import type { OverlapDecision } from "../../../coupon-oa/three-source/types";
import type { CouponThreeSourceTaskRepository } from "./task-repository";

interface TaskMutationInput {
  taskId: string;
  ownerOpenId: string;
  expectedRevision: number;
  operationId: string;
}

export class CouponThreeSourceTaskService {
  constructor(private readonly repository: CouponThreeSourceTaskRepository) {}

  async startOrResume(ownerOpenId: string): Promise<CouponThreeSourceTask> {
    const active = await this.repository.getActiveByOwner(ownerOpenId);
    if (active) return active;
    return this.repository.create(
      createCouponThreeSourceTask({
        taskId: `CTS-${randomUUID()}`,
        ownerOpenId,
      }),
    );
  }

  async replaceSource(
    input: TaskMutationInput & { source: CouponThreeSourceSourceFile },
  ): Promise<CouponThreeSourceTask> {
    return this.mutate(input, (task) =>
      replaceCouponThreeSourceSource({ ...input, task }),
    );
  }

  async confirmNoBlacklist(
    input: TaskMutationInput,
  ): Promise<CouponThreeSourceTask> {
    return this.mutate(input, (task) =>
      confirmCouponThreeSourceNoBlacklist({ ...input, task }),
    );
  }

  async setOverlap(
    input: TaskMutationInput & {
      overlap: { sha256: string; count: number; decision?: OverlapDecision };
    },
  ): Promise<CouponThreeSourceTask> {
    return this.mutate(input, (task) =>
      setCouponThreeSourceOverlap({ ...input, task }),
    );
  }

  async confirmSources(
    input: TaskMutationInput & { snapshotHash: string },
  ): Promise<CouponThreeSourceTask> {
    return this.mutate(input, (task) =>
      confirmCouponThreeSourceSources({ ...input, task }),
    );
  }

  async saveArtifacts(
    input: TaskMutationInput & {
      artifacts: CouponThreeSourceArtifact[];
      requiresCalcImage: boolean;
    },
  ): Promise<CouponThreeSourceTask> {
    return this.mutate(input, (task) =>
      saveCouponThreeSourceArtifacts({ ...input, task }),
    );
  }

  async confirmDraftOnly(
    input: TaskMutationInput & { snapshotHash: string },
  ): Promise<CouponThreeSourceTask> {
    return this.mutate(input, (task) =>
      confirmCouponThreeSourceDraftOnly({ ...input, task }),
    );
  }

  async cancel(input: TaskMutationInput): Promise<CouponThreeSourceTask> {
    return this.mutate(input, (task) =>
      cancelCouponThreeSourceTask({ ...input, task }),
    );
  }

  private async mutate(
    input: TaskMutationInput,
    transition: (task: CouponThreeSourceTask) => CouponThreeSourceTask,
  ): Promise<CouponThreeSourceTask> {
    if (!input.operationId) throw new Error("三源提报操作 ID 不能为空");
    const previous = await this.repository.getOperationResult({
      taskId: input.taskId,
      operationId: input.operationId,
    });
    if (previous) return previous;

    const task = await this.requiredTask(input.taskId);
    return this.repository.replace({
      task: transition(task),
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
    });
  }

  private async requiredTask(taskId: string): Promise<CouponThreeSourceTask> {
    const task = await this.repository.getById(taskId);
    if (!task) throw new Error("三源提报任务不存在");
    return task;
  }
}
