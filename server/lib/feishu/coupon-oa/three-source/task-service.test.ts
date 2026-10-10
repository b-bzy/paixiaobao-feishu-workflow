import { describe, expect, it } from "vitest";
import { InMemoryCouponThreeSourceTaskRepository } from "./task-repository";
import { CouponThreeSourceTaskService } from "./task-service";

describe("CouponThreeSourceTaskService", () => {
  it("returns the persisted result for a replayed card operation", async () => {
    const repository = new InMemoryCouponThreeSourceTaskRepository();
    const service = new CouponThreeSourceTaskService(repository);
    const task = await service.startOrResume("ou_owner");

    const first = await service.confirmNoBlacklist({
      taskId: task.taskId,
      ownerOpenId: "ou_owner",
      expectedRevision: 1,
      operationId: "card-no-blacklist-1",
    });
    const replay = await service.confirmNoBlacklist({
      taskId: task.taskId,
      ownerOpenId: "ou_owner",
      expectedRevision: 1,
      operationId: "card-no-blacklist-1",
    });

    expect(first).toEqual(replay);
    expect(replay).toMatchObject({
      revision: 2,
      blacklistStatus: "absent_confirmed",
    });
  });

  it("resumes one active task per owner", async () => {
    const service = new CouponThreeSourceTaskService(
      new InMemoryCouponThreeSourceTaskRepository(),
    );

    const first = await service.startOrResume("ou_owner");
    const resumed = await service.startOrResume("ou_owner");

    expect(resumed.taskId).toBe(first.taskId);
  });
});
