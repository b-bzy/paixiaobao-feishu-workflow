import { describe, expect, it, vi } from "vitest";
import { DurableEffectWorker } from "./durable-effect-worker";
import type {
  DurableEffect,
  DurableEffectRepository,
} from "./postgres-durable-effect-repository";

const effect: DurableEffect = {
  id: "effect-1",
  taskId: "CTS-1",
  kind: "coupon_three_source_intake_card",
  semanticKey: "coupon-intake-card:CTS-1:1",
  requestSha256: "a".repeat(64),
  requestPayload: {
    version: "coupon-intake-card-v1",
    taskId: "CTS-1",
    revision: 1,
    ownerOpenId: "ou_owner",
    purpose: "collect_sources",
  },
  state: "sending",
  attempts: 1,
  availableAt: "2030-01-01T00:00:00.000Z",
  leaseToken: "effect-lease-1",
};

function repository(effects: DurableEffect[]): DurableEffectRepository {
  return {
    claim: vi.fn(async () => effects),
    complete: vi.fn(async () => undefined),
    retryOrDeadLetter: vi.fn(async () => undefined),
    markOutcomeUnknown: vi.fn(async () => undefined),
  };
}

describe("DurableEffectWorker", () => {
  it("completes a known effect only after its delivery handler succeeds", async () => {
    const effects = repository([effect]);
    const worker = new DurableEffectWorker(effects, {
      coupon_three_source_intake_card: async () => ({
        kind: "succeeded",
        externalReference: "uuid-1",
      }),
    });

    await expect(
      worker.runOnce({ workerId: "worker-1", limit: 1, leaseMs: 60_000 }),
    ).resolves.toEqual({
      claimed: 1,
      succeeded: 1,
      retried: 0,
      deadLettered: 0,
      outcomeUnknown: 0,
    });
    expect(effects.complete).toHaveBeenCalledWith({
      effectId: "effect-1",
      leaseToken: "effect-lease-1",
      externalReference: "uuid-1",
    });
  });

  it("preserves indeterminate external delivery without a blind retry", async () => {
    const effects = repository([effect]);
    const worker = new DurableEffectWorker(effects, {
      coupon_three_source_intake_card: async () => ({
        kind: "outcome_unknown",
        errorCode: "FEISHU_CARD_OUTCOME_UNKNOWN",
        errorMessage: "reconcile",
      }),
    });

    await expect(
      worker.runOnce({ workerId: "worker-1", limit: 1, leaseMs: 60_000 }),
    ).resolves.toMatchObject({ outcomeUnknown: 1, retried: 0 });
    expect(effects.markOutcomeUnknown).toHaveBeenCalledWith({
      effectId: "effect-1",
      leaseToken: "effect-lease-1",
      errorCode: "FEISHU_CARD_OUTCOME_UNKNOWN",
      errorMessage: "reconcile",
    });
    expect(effects.retryOrDeadLetter).not.toHaveBeenCalled();
  });

  it("dead-letters an unknown effect kind rather than declaring it complete", async () => {
    const effects = repository([{ ...effect, kind: "unknown-effect" }]);
    const worker = new DurableEffectWorker(effects, {});

    await expect(
      worker.runOnce({ workerId: "worker-1", limit: 1, leaseMs: 60_000 }),
    ).resolves.toMatchObject({ deadLettered: 1 });
    expect(effects.retryOrDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "EFFECT_HANDLER_UNAVAILABLE" }),
    );
  });

  it("marks an unclassified handler exception as unknown instead of sending again", async () => {
    const effects = repository([effect]);
    const worker = new DurableEffectWorker(effects, {
      coupon_three_source_intake_card: async () => {
        throw new Error("connection dropped after write");
      },
    });

    await expect(
      worker.runOnce({ workerId: "worker-1", limit: 1, leaseMs: 60_000 }),
    ).resolves.toMatchObject({ outcomeUnknown: 1 });
    expect(effects.markOutcomeUnknown).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "UNHANDLED_EFFECT_ERROR" }),
    );
  });

  it("dead-letters a retryable effect once its attempt limit is reached", async () => {
    const effects = repository([{ ...effect, attempts: 2 }]);
    const worker = new DurableEffectWorker(
      effects,
      {
        coupon_three_source_intake_card: async () => ({
          kind: "retry",
          retryAt: "2030-01-01T00:01:00.000Z",
          errorCode: "FEISHU_CARD_REJECTED",
          errorMessage: "retry later",
        }),
      },
      { maxAttempts: 2 },
    );

    await expect(
      worker.runOnce({ workerId: "worker-1", limit: 1, leaseMs: 60_000 }),
    ).resolves.toMatchObject({ deadLettered: 1, retried: 0 });
    expect(effects.retryOrDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "MAX_ATTEMPTS_EXCEEDED",
        retryAt: undefined,
      }),
    );
  });

  it("serializes effects with the same business key", async () => {
    const first = {
      ...effect,
      id: "effect-1",
      leaseToken: "lease-1",
      requestPayload: { businessTaskId: "CTS-1" },
    };
    const second = {
      ...effect,
      id: "effect-2",
      leaseToken: "lease-2",
      requestPayload: { businessTaskId: "CTS-1" },
    };
    const effects = repository([first, second]);
    let active = 0;
    let maximumActive = 0;
    const worker = new DurableEffectWorker(
      effects,
      {
        coupon_three_source_intake_card: async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await Promise.resolve();
          active -= 1;
          return { kind: "succeeded" };
        },
      },
      {
        serializationKey: (item) => String(item.requestPayload.businessTaskId),
      },
    );

    await worker.runOnce({ workerId: "worker-1", limit: 2, leaseMs: 60_000 });

    expect(maximumActive).toBe(1);
    expect(effects.complete).toHaveBeenCalledTimes(2);
  });
});
