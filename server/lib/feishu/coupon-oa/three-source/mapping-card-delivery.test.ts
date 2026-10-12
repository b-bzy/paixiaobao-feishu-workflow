import { describe, expect, it, vi } from "vitest";
import { createCouponThreeSourceTask } from "../../../coupon-oa/three-source/task";
import { deliverCouponThreeSourceMappingCard } from "./mapping-card-delivery";
import type { CouponThreeSourcePilotDraft } from "./store";

function draft(): CouponThreeSourcePilotDraft {
  return {
    recordId: "rec-1",
    pilotId: "pilot-1",
    ownerOpenId: "ou-owner",
    task: createCouponThreeSourceTask({
      taskId: "task-1",
      ownerOpenId: "ou-owner",
    }),
    schemaVersion: "coupon-three-source-pilot-v1",
    recognitions: {},
    selections: {},
    artifacts: [],
    processedMessageIds: [],
    validationIssues: [],
  };
}

describe("second-round mapping card delivery", () => {
  it("creates once, stores the message ID, then updates the same message", async () => {
    let current = draft();
    const createCard = vi.fn(async () => ({ messageId: "om-second-round" }));
    const updateCard = vi.fn(async () => undefined);
    const updateDraft = vi.fn(async (_draft, updates) => {
      current = { ...current, ...updates };
      return current;
    });
    const dependencies = {
      createCard,
      updateCard,
      updateDraft: updateDraft as never,
    };

    current = await deliverCouponThreeSourceMappingCard(
      { draft: current, idempotencyKey: "batch-key" },
      dependencies,
    );
    current = await deliverCouponThreeSourceMappingCard(
      { draft: current, idempotencyKey: "another-event" },
      dependencies,
    );

    expect(createCard).toHaveBeenCalledOnce();
    expect(updateCard).toHaveBeenCalledOnce();
    expect(updateCard).toHaveBeenCalledWith(
      "om-second-round",
      expect.any(Object),
    );
    expect(current.mappingCardDelivery).toEqual({
      messageId: "om-second-round",
      revision: 1,
    });
  });
});
