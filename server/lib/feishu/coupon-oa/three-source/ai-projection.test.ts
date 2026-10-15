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
  task.sources = {
    couponTable: {
      role: "couponTable",
      messageId: "message-1",
      fileKey: "file-1",
      fileName: "coupon.xlsx",
      bytes: 10,
      sha256: "a".repeat(64),
    },
    whitelist: {
      role: "whitelist",
      messageId: "message-2",
      fileKey: "file-2",
      fileName: "whitelist.xlsx",
      bytes: 10,
      sha256: "b".repeat(64),
    },
  };
  return {
    recordId: "record-1",
    pilotId: "pilot-1",
    ownerOpenId: "ou_owner",
    task,
    schemaVersion: "coupon-three-source-pilot-v2",
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

function pendingWhitelist(): NonNullable<
  CouponThreeSourcePilotDraft["recognitions"]["whitelist"]
> {
  return {
    source: {
      messageId: "message-2",
      fileKey: "file-2",
      fileName: "whitelist.xlsx",
      bytes: 10,
      sha256: "b".repeat(64),
    },
    sourceHash: "b".repeat(64),
    roleCandidates: [],
    couponFieldCandidates: {},
    listCandidates: [],
    issues: [],
    ai: {
      runId: "run-2",
      revision: 2,
      sourceSha256: "b".repeat(64),
      status: "pending",
    },
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
    const deliverMappingCard = vi.fn(async ({ draft }) => draft);
    const updateDraft = vi.fn(async (_draft, updates) => {
      current = { ...current, ...updates };
      return current;
    });
    const projector = createCouponThreeSourceAiProjector({
      getDraft: vi.fn(async () => current),
      updateDraft: updateDraft as never,
      deliverMappingCard,
    });
    await projector.project({ run: run(), idempotencyKey: "effect-uuid" });
    expect(current.recognitions.couponTable?.ai?.status).toBe("succeeded");
    expect(deliverMappingCard).toHaveBeenCalledWith({
      draft: current,
      idempotencyKey: "effect-uuid",
    });
  });

  it("silently discards stale revision results", async () => {
    const current = draft();
    current.task.revision = 3;
    const deliverMappingCard = vi.fn();
    const updateDraft = vi.fn();
    const projector = createCouponThreeSourceAiProjector({
      getDraft: vi.fn(async () => current),
      updateDraft: updateDraft as never,
      deliverMappingCard,
    });
    await projector.project({ run: run(), idempotencyKey: "effect-uuid" });
    expect(updateDraft).not.toHaveBeenCalled();
    expect(deliverMappingCard).not.toHaveBeenCalled();
  });

  it("does not append an intermediate card while another source is pending", async () => {
    let current = draft();
    current.recognitions.whitelist = pendingWhitelist();
    const deliverMappingCard = vi.fn(async ({ draft }) => draft);
    const updateDraft = vi.fn(async (_draft, updates) => {
      current = { ...current, ...updates };
      return current;
    });
    const projector = createCouponThreeSourceAiProjector({
      getDraft: vi.fn(async () => current),
      updateDraft: updateDraft as never,
      deliverMappingCard,
    });

    await projector.project({ run: run(), idempotencyKey: "effect-uuid" });

    expect(current.recognitions.couponTable?.ai?.status).toBe("succeeded");
    expect(current.recognitions.whitelist?.ai?.status).toBe("pending");
    expect(deliverMappingCard).not.toHaveBeenCalled();
  });

  it("discards results for a canceled draft instead of retrying forever", async () => {
    const current = draft();
    current.task.status = "Canceled";
    const deliverMappingCard = vi.fn();
    const updateDraft = vi.fn();
    const projector = createCouponThreeSourceAiProjector({
      getDraft: vi.fn(async () => current),
      updateDraft: updateDraft as never,
      deliverMappingCard,
    });
    // Must resolve (not throw): the store refuses writes on inactive drafts,
    // so a throwing projection would make the effect retry endlessly.
    await expect(
      projector.project({ run: run(), idempotencyKey: "effect-uuid" }),
    ).resolves.toBeUndefined();
    expect(updateDraft).not.toHaveBeenCalled();
    expect(deliverMappingCard).not.toHaveBeenCalled();
  });

  it("discards a late result when the owner already skipped the wait", async () => {
    const current = draft();
    if (current.recognitions.couponTable?.ai) {
      current.recognitions.couponTable.ai.status = "failed";
      current.recognitions.couponTable.ai.fallbackCode = "owner_skipped";
    }
    // Skipping already delivered the mapping card for this revision; a late
    // result must neither overwrite the slot nor reset the owner's card.
    current.mappingCardDelivery = { messageId: "om-map", revision: 2 };
    const deliverMappingCard = vi.fn();
    const updateDraft = vi.fn();
    const projector = createCouponThreeSourceAiProjector({
      getDraft: vi.fn(async () => current),
      updateDraft: updateDraft as never,
      deliverMappingCard,
    });
    await projector.project({ run: run(), idempotencyKey: "effect-uuid" });
    expect(updateDraft).not.toHaveBeenCalled();
    expect(deliverMappingCard).not.toHaveBeenCalled();
  });

  it("redelivers the mapping card when a settled result never got delivered", async () => {
    // An interrupted tick can persist the terminal AI result but die before
    // the card delivery; the effect retry must complete that half instead of
    // discarding it, or the owner stays stranded on the recognizing card.
    const current = draft();
    if (current.recognitions.couponTable?.ai) {
      current.recognitions.couponTable.ai.status = "succeeded";
    }
    const deliverMappingCard = vi.fn(async ({ draft }) => draft);
    const updateDraft = vi.fn();
    const projector = createCouponThreeSourceAiProjector({
      getDraft: vi.fn(async () => current),
      updateDraft: updateDraft as never,
      deliverMappingCard,
    });
    await projector.project({ run: run(), idempotencyKey: "effect-uuid" });
    expect(updateDraft).not.toHaveBeenCalled();
    expect(deliverMappingCard).toHaveBeenCalledWith(
      expect.objectContaining({ draft: current }),
    );
  });

  it("does not redeliver a card the current revision already sent", async () => {
    const current = draft();
    if (current.recognitions.couponTable?.ai) {
      current.recognitions.couponTable.ai.status = "succeeded";
    }
    current.mappingCardDelivery = { messageId: "om-map", revision: 2 };
    const deliverMappingCard = vi.fn();
    const updateDraft = vi.fn();
    const projector = createCouponThreeSourceAiProjector({
      getDraft: vi.fn(async () => current),
      updateDraft: updateDraft as never,
      deliverMappingCard,
    });
    await projector.project({ run: run(), idempotencyKey: "effect-uuid" });
    expect(updateDraft).not.toHaveBeenCalled();
    expect(deliverMappingCard).not.toHaveBeenCalled();
  });
});
