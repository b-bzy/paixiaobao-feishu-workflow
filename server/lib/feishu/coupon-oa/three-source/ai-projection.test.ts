import { describe, expect, it, vi } from "vitest";
import type { CouponAiRecognitionRun } from "../../../control-plane/postgres-coupon-ai-recognition-repository";
import { createCouponThreeSourceTask } from "../../../coupon-oa/three-source/task";
import { createCouponThreeSourceAiProjector } from "./ai-projection";
import type { CouponThreeSourcePilotDraft } from "./store";

function draft(): CouponThreeSourcePilotDraft {
  const task = createCouponThreeSourceTask({
    taskId: "CTS-1",
    ownerOpenId: "ou_owner",
  });
  task.revision = 2;
  return {
    recordId: "record-1",
    pilotId: "pilot-1",
    ownerOpenId: "ou_owner",
    task,
    schemaVersion: "coupon-three-source-pilot-v1",
    recognitions: {
      couponTable: {
        source: {
          messageId: "message-1",
          fileKey: "file-1",
          fileName: "coupon.xlsx",
          bytes: 10,
          sha256: "a".repeat(64),
        },
        sourceHash: "a".repeat(64),
        roleCandidates: [],
        couponFieldCandidates: {},
        listCandidates: [],
        issues: [],
        ai: {
          runId: "run-1",
          revision: 2,
          sourceSha256: "a".repeat(64),
          status: "pending",
        },
      },
    },
    selections: {},
    artifacts: [],
    processedMessageIds: [],
    validationIssues: [],
  };
}

function run(): CouponAiRecognitionRun {
  return {
    id: "run-1",
    semanticKey: "semantic-1",
    pilotRecordId: "record-1",
    businessTaskId: "CTS-1",
    ownerOpenId: "ou_owner",
    revision: 2,
    sourceSlot: "couponTable",
    sourceReference: {},
    sourceSha256: "a".repeat(64),
    sourceFileName: "coupon.xlsx",
    provider: "deepseek",
    model: "deepseek-chat",
    promptVersion: "coupon-three-source-p0-ai-v1",
    status: "succeeded",
    result: {
      sourceHash: "a".repeat(64),
      roleCandidates: [],
      couponCandidates: [],
      fieldCandidates: [],
      listCandidates: [],
      issues: [],
    },
  };
}

describe("coupon three-source AI projection", () => {
  it("updates only the matching current source and sends one idempotent card", async () => {
    let current = draft();
    const sendCard = vi.fn(async () => undefined);
    const updateDraft = vi.fn(async (_draft, updates) => {
      current = { ...current, ...updates };
      return current;
    });
    const projector = createCouponThreeSourceAiProjector({
      getDraft: vi.fn(async () => current),
      updateDraft: updateDraft as never,
      sendCard,
    });
    await projector.project({ run: run(), idempotencyKey: "effect-uuid" });
    expect(current.recognitions.couponTable?.ai?.status).toBe("succeeded");
    expect(sendCard).toHaveBeenCalledWith(
      "ou_owner",
      expect.any(Object),
      "effect-uuid",
    );
  });

  it("silently discards stale revision results", async () => {
    const current = draft();
    current.task.revision = 3;
    const sendCard = vi.fn();
    const updateDraft = vi.fn();
    const projector = createCouponThreeSourceAiProjector({
      getDraft: vi.fn(async () => current),
      updateDraft: updateDraft as never,
      sendCard,
    });
    await projector.project({ run: run(), idempotencyKey: "effect-uuid" });
    expect(updateDraft).not.toHaveBeenCalled();
    expect(sendCard).not.toHaveBeenCalled();
  });
});
