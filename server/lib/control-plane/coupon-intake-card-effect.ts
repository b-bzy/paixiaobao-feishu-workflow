import { sendFeishuCard } from "../feishu/client";
import { buildCouponThreeSourceIntakeCard } from "../feishu/coupon-oa/three-source/cards";
import type { DurableEffectResult } from "./durable-effect-worker";
import type { DurableEffect } from "./postgres-durable-effect-repository";

export const couponThreeSourceIntakeCardEffectKind =
  "coupon_three_source_intake_card";

interface CouponThreeSourceIntakeCardPayload {
  version: "coupon-intake-card-v1";
  taskId: string;
  revision: number;
  ownerOpenId: string;
  purpose: "collect_sources";
}

export interface CouponIntakeCardGateway {
  send(input: {
    ownerOpenId: string;
    idempotencyKey: string;
  }): Promise<
    | { kind: "succeeded"; externalReference?: string }
    | { kind: "retry"; retryAt: string; errorCode: string }
    | { kind: "outcome_unknown"; errorCode: string }
  >;
}

function parsePayload(
  effect: DurableEffect,
): CouponThreeSourceIntakeCardPayload {
  const payload = effect.requestPayload;
  if (
    payload.version !== "coupon-intake-card-v1" ||
    payload.purpose !== "collect_sources" ||
    payload.taskId !== effect.taskId ||
    typeof payload.taskId !== "string" ||
    !payload.taskId ||
    !Number.isSafeInteger(payload.revision) ||
    (payload.revision as number) < 1 ||
    typeof payload.ownerOpenId !== "string" ||
    !/^ou_[a-zA-Z0-9]+$/u.test(payload.ownerOpenId)
  ) {
    throw new Error("Invalid coupon intake card effect payload");
  }
  return payload as unknown as CouponThreeSourceIntakeCardPayload;
}

/**
 * The default gateway uses Feishu's `uuid` card-send key. A response that
 * explicitly says the request was rejected is retryable; anything without a
 * trustworthy delivery result is retained as outcome_unknown and never resent.
 */
export const feishuCouponIntakeCardGateway: CouponIntakeCardGateway = {
  async send(input) {
    try {
      await sendFeishuCard(
        input.ownerOpenId,
        buildCouponThreeSourceIntakeCard(),
        input.idempotencyKey,
      );
      return {
        kind: "succeeded",
        externalReference: input.idempotencyKey,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith("Failed to send Feishu card:")) {
        return {
          kind: "retry",
          retryAt: new Date(Date.now() + 5_000).toISOString(),
          errorCode: "FEISHU_CARD_REJECTED",
        };
      }
      return {
        kind: "outcome_unknown",
        errorCode: "FEISHU_CARD_OUTCOME_UNKNOWN",
      };
    }
  },
};

/** Returns a strictly scoped handler for the command-intake card effect. */
export function createCouponIntakeCardEffectHandler(
  gateway: CouponIntakeCardGateway = feishuCouponIntakeCardGateway,
): (effect: DurableEffect) => Promise<DurableEffectResult> {
  return async (effect) => {
    let payload: CouponThreeSourceIntakeCardPayload;
    try {
      payload = parsePayload(effect);
    } catch {
      return {
        kind: "dead_letter",
        errorCode: "INVALID_EFFECT_PAYLOAD",
        errorMessage: "Coupon intake card effect payload is invalid",
      };
    }

    const outcome = await gateway.send({
      ownerOpenId: payload.ownerOpenId,
      idempotencyKey: effect.semanticKey,
    });
    if (outcome.kind === "succeeded") {
      return {
        kind: "succeeded",
        externalReference: outcome.externalReference,
      };
    }
    if (outcome.kind === "retry") {
      return {
        kind: "retry",
        retryAt: outcome.retryAt,
        errorCode: outcome.errorCode,
        errorMessage: "Feishu rejected the coupon intake card request",
      };
    }
    return {
      kind: "outcome_unknown",
      errorCode: outcome.errorCode,
      errorMessage: "Coupon intake card delivery requires reconciliation",
    };
  };
}
