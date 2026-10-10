import { describe, expect, it, vi } from "vitest";
import {
  type CouponIntakeCardGateway,
  createCouponIntakeCardEffectHandler,
} from "./coupon-intake-card-effect";
import type { DurableEffect } from "./postgres-durable-effect-repository";

function effect(overrides: Partial<DurableEffect> = {}): DurableEffect {
  return {
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
    leaseToken: "lease-1",
    ...overrides,
  };
}

describe("coupon intake card effect handler", () => {
  it("sends only a schema-validated persisted card intent with its semantic key", async () => {
    const gateway: CouponIntakeCardGateway = {
      send: vi.fn(async () => ({
        kind: "succeeded" as const,
        externalReference: "feishu-card-uuid",
      })),
    };

    await expect(
      createCouponIntakeCardEffectHandler(gateway)(effect()),
    ).resolves.toEqual({
      kind: "succeeded",
      externalReference: "feishu-card-uuid",
    });
    expect(gateway.send).toHaveBeenCalledWith({
      ownerOpenId: "ou_owner",
      idempotencyKey: "coupon-intake-card:CTS-1:1",
    });
  });

  it("dead-letters a payload that does not match its task-bound intent", async () => {
    const gateway: CouponIntakeCardGateway = {
      send: vi.fn(),
    };

    await expect(
      createCouponIntakeCardEffectHandler(gateway)(
        effect({
          requestPayload: {
            version: "coupon-intake-card-v1",
            taskId: "CTS-other",
            revision: 1,
            ownerOpenId: "ou_owner",
            purpose: "collect_sources",
          },
        }),
      ),
    ).resolves.toEqual({
      kind: "dead_letter",
      errorCode: "INVALID_EFFECT_PAYLOAD",
      errorMessage: "Coupon intake card effect payload is invalid",
    });
    expect(gateway.send).not.toHaveBeenCalled();
  });

  it("preserves a gateway's unknown remote outcome rather than turning it into a retry", async () => {
    const gateway: CouponIntakeCardGateway = {
      send: vi.fn(async () => ({
        kind: "outcome_unknown" as const,
        errorCode: "FEISHU_CARD_OUTCOME_UNKNOWN",
      })),
    };

    await expect(
      createCouponIntakeCardEffectHandler(gateway)(effect()),
    ).resolves.toEqual({
      kind: "outcome_unknown",
      errorCode: "FEISHU_CARD_OUTCOME_UNKNOWN",
      errorMessage: "Coupon intake card delivery requires reconciliation",
    });
  });
});
