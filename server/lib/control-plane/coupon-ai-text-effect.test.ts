import { describe, expect, it, vi } from "vitest";
import type { CouponSupplementTextGateway } from "../feishu/deepseek-text-gateway";
import { createCouponAiTextEffectHandler } from "./coupon-ai-text-effect";
import type {
  CouponAiTextRepository,
  CouponAiTextRun,
} from "./postgres-coupon-ai-text-repository";
import type { DurableEffect } from "./postgres-durable-effect-repository";

function run(status: CouponAiTextRun["status"]): CouponAiTextRun {
  return {
    id: "run-1",
    semanticKey: "semantic-1",
    pilotRecordId: "record-1",
    businessTaskId: "CTS-1",
    ownerOpenId: "ou_owner",
    revision: 1,
    supplementText: "活动背景是清仓",
    textSha256: "a".repeat(64),
    provider: "deepseek",
    model: "deepseek-chat",
    promptVersion: "coupon-three-source-p0-supplement-v1",
    status,
  };
}

function effect(): DurableEffect {
  return {
    id: "effect-1",
    kind: "coupon_three_source_ai_text",
    semanticKey: "coupon-ai-text:semantic-1",
    requestSha256: "request",
    requestPayload: {
      version: "coupon-ai-text-effect-v1",
      runId: "run-1",
      businessTaskId: "CTS-1",
    },
    state: "sending",
    attempts: 1,
    availableAt: new Date(0).toISOString(),
    leaseToken: "lease-1",
  };
}

function repository(initial: CouponAiTextRun): CouponAiTextRepository {
  let current = initial;
  return {
    prepare: vi.fn(),
    activate: vi.fn(),
    get: vi.fn(async () => current),
    saveTerminalResult: vi.fn(async (input) => {
      current = { ...current, ...input };
      return current;
    }),
    markProjected: vi.fn(async () => undefined),
  };
}

describe("coupon AI supplement effect", () => {
  it("persists the validated result before projection", async () => {
    const repo = repository(run("pending"));
    const gateway: CouponSupplementTextGateway = {
      recognizeText: vi.fn(async () => ({
        ok: true as const,
        proposal: {
          fields: { activityBackground: "清仓活动" },
          warnings: [],
        },
        requestSha256: "r".repeat(64),
        responseSha256: "s".repeat(64),
        startedAt: "2030-01-01T00:00:00.000Z",
        completedAt: "2030-01-01T00:00:01.000Z",
        durationMs: 1_000,
      })),
    };
    const projector = { project: vi.fn(async () => undefined) };
    const result = await createCouponAiTextEffectHandler({
      repository: repo,
      gateway,
      projector,
    })(effect());
    expect(result).toMatchObject({ kind: "succeeded" });
    expect(repo.saveTerminalResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: "succeeded" }),
    );
    expect(projector.project).toHaveBeenCalledTimes(1);
  });

  it("does not call DeepSeek again when only projection is retried", async () => {
    const repo = repository(run("succeeded"));
    const gateway = { recognizeText: vi.fn() } as CouponSupplementTextGateway;
    const result = await createCouponAiTextEffectHandler({
      repository: repo,
      gateway,
      projector: {
        project: vi.fn(async () => {
          throw new Error("Base unavailable");
        }),
      },
    })(effect());
    expect(result).toMatchObject({
      kind: "retry",
      errorCode: "AI_TEXT_PROJECTION_FAILED",
    });
    expect(gateway.recognizeText).not.toHaveBeenCalled();
  });
});
