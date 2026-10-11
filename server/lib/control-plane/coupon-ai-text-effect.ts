import {
  type ValidatedCouponSupplementText,
  validateCouponSupplementTextProposal,
} from "../coupon-oa/three-source/ai-text";
import type { AiAuditSummary } from "../coupon-oa/three-source/types";
import type { CouponSupplementTextGateway } from "../feishu/deepseek-text-gateway";
import type { DurableEffectResult } from "./durable-effect-worker";
import type {
  CouponAiTextRepository,
  CouponAiTextRun,
} from "./postgres-coupon-ai-text-repository";
import type { DurableEffect } from "./postgres-durable-effect-repository";

export interface CouponAiTextProjector {
  project(input: {
    run: CouponAiTextRun;
    idempotencyKey: string;
  }): Promise<void>;
}

function payload(effect: DurableEffect) {
  const value = effect.requestPayload;
  if (
    value.version !== "coupon-ai-text-effect-v1" ||
    typeof value.runId !== "string" ||
    !value.runId ||
    typeof value.businessTaskId !== "string" ||
    !value.businessTaskId
  ) {
    throw new Error("Invalid coupon AI supplement effect payload");
  }
  return { runId: value.runId, businessTaskId: value.businessTaskId };
}

function failureAudit(input: {
  run: CouponAiTextRun;
  code: string;
  outcomeUnknown: boolean;
  gateway: {
    requestSha256?: string;
    responseSha256?: string;
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };
}): AiAuditSummary {
  return {
    provider: "deepseek",
    model: input.run.model,
    promptVersion: input.run.promptVersion,
    status: input.outcomeUnknown ? "outcome_unknown" : "failed",
    requestSha256: input.gateway.requestSha256,
    responseSha256: input.gateway.responseSha256,
    startedAt: input.gateway.startedAt,
    completedAt: input.gateway.completedAt,
    durationMs: input.gateway.durationMs,
    fallbackReason: input.code,
  };
}

export function createCouponAiTextEffectHandler(input: {
  repository: CouponAiTextRepository;
  gateway: CouponSupplementTextGateway;
  projector: CouponAiTextProjector;
}): (effect: DurableEffect) => Promise<DurableEffectResult> {
  return async (effect) => {
    let reference: { runId: string; businessTaskId: string };
    try {
      reference = payload(effect);
    } catch {
      return {
        kind: "dead_letter",
        errorCode: "INVALID_EFFECT_PAYLOAD",
        errorMessage: "Coupon AI supplement effect payload is invalid",
      };
    }
    let run = await input.repository.get(reference.runId);
    if (!run || run.businessTaskId !== reference.businessTaskId) {
      return {
        kind: "dead_letter",
        errorCode: "AI_TEXT_RUN_NOT_FOUND",
        errorMessage: "Coupon AI supplement run is missing",
      };
    }
    if (run.status === "pending") {
      const gateway = await input.gateway.recognizeText({
        text: run.supplementText,
      });
      if (gateway.ok) {
        const result: ValidatedCouponSupplementText =
          validateCouponSupplementTextProposal(gateway.proposal);
        const invalid =
          !Object.keys(result.fields).length && result.warnings.length > 0;
        run = await input.repository.saveTerminalResult({
          runId: run.id,
          status: invalid ? "failed" : "succeeded",
          result,
          audit: {
            provider: "deepseek",
            model: run.model,
            promptVersion: run.promptVersion,
            status: invalid ? "failed" : "succeeded",
            requestSha256: gateway.requestSha256,
            responseSha256: gateway.responseSha256,
            startedAt: gateway.startedAt,
            completedAt: gateway.completedAt,
            durationMs: gateway.durationMs,
            fallbackReason: invalid ? "invalid_proposal" : undefined,
          },
          fallbackCode: invalid ? "invalid_proposal" : undefined,
        });
      } else {
        const outcomeUnknown = ["timeout", "network_error"].includes(
          gateway.code,
        );
        run = await input.repository.saveTerminalResult({
          runId: run.id,
          status: outcomeUnknown ? "outcome_unknown" : "failed",
          audit: failureAudit({
            run,
            code: gateway.code,
            outcomeUnknown,
            gateway,
          }),
          fallbackCode: gateway.code,
        });
      }
    }
    try {
      await input.projector.project({ run, idempotencyKey: effect.id });
      await input.repository.markProjected(run.id);
      return { kind: "succeeded", externalReference: run.id };
    } catch {
      return {
        kind: "retry",
        retryAt: new Date(Date.now() + 5_000).toISOString(),
        errorCode: "AI_TEXT_PROJECTION_FAILED",
        errorMessage: "AI supplement terminal result projection failed",
      };
    }
  };
}
