import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import type { AiAuditSummary } from "../coupon-oa/three-source/types";
import type { CouponThreeSourceAiGateway } from "../feishu/deepseek-chat-gateway";
import { createCouponAiRecognitionEffectHandler } from "./coupon-ai-recognition-effect";
import type {
  CouponAiRecognitionRepository,
  CouponAiRecognitionRun,
} from "./postgres-coupon-ai-recognition-repository";
import type { DurableEffect } from "./postgres-durable-effect-repository";

async function sourceBytes() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("配券");
  sheet.getCell("A1").value = "活动名称";
  sheet.getCell("A2").value = "活动A";
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function effect(): DurableEffect {
  return {
    id: "effect-1",
    kind: "coupon_three_source_ai_recognition",
    semanticKey: "coupon-ai:run-1",
    requestSha256: "request",
    requestPayload: {
      version: "coupon-ai-recognition-effect-v1",
      runId: "run-1",
      businessTaskId: "CTS-1",
    },
    state: "sending",
    attempts: 1,
    availableAt: new Date(0).toISOString(),
    leaseToken: "lease-1",
  };
}

function run(status: CouponAiRecognitionRun["status"]): CouponAiRecognitionRun {
  return {
    id: "run-1",
    semanticKey: "semantic-1",
    pilotRecordId: "record-1",
    businessTaskId: "CTS-1",
    ownerOpenId: "ou_owner",
    revision: 1,
    sourceSlot: "couponTable",
    sourceReference: {},
    sourceSha256: "",
    sourceFileName: "coupon.xlsx",
    provider: "deepseek",
    model: "deepseek-chat",
    promptVersion: "coupon-three-source-p0-ai-v1",
    status,
  };
}

function repository(initial: CouponAiRecognitionRun) {
  let current = initial;
  const value: CouponAiRecognitionRepository = {
    prepare: vi.fn(),
    activate: vi.fn(),
    enqueue: vi.fn(),
    get: vi.fn(async () => current),
    saveTerminalResult: vi.fn(async (input) => {
      current = {
        ...current,
        status: input.status,
        result: input.result,
        audit: input.audit,
        fallbackCode: input.fallbackCode,
      };
      return current;
    }),
    markProjected: vi.fn(async () => undefined),
  };
  return value;
}

describe("coupon AI recognition effect", () => {
  it("calls the provider once, saves terminal result, then projects", async () => {
    const bytes = await sourceBytes();
    const pending = { ...run("pending"), sourceSha256: "" };
    const { createHash } = await import("node:crypto");
    pending.sourceSha256 = createHash("sha256").update(bytes).digest("hex");
    const repo = repository(pending);
    const gateway: CouponThreeSourceAiGateway = {
      recognize: vi.fn(async () => ({
        ok: true as const,
        proposal: { warnings: [] },
        requestSha256: "r".repeat(64),
        responseSha256: "s".repeat(64),
        startedAt: "2030-01-01T00:00:00.000Z",
        completedAt: "2030-01-01T00:00:01.000Z",
        durationMs: 1000,
      })),
    };
    const projector = { project: vi.fn(async () => undefined) };
    const handler = createCouponAiRecognitionEffectHandler({
      repository: repo,
      gateway,
      sourceLoader: {
        load: vi.fn(async () => ({ fileName: "coupon.xlsx", bytes })),
      },
      projector,
    });
    await expect(handler(effect())).resolves.toMatchObject({
      kind: "succeeded",
    });
    expect(gateway.recognize).toHaveBeenCalledTimes(1);
    expect(repo.saveTerminalResult).toHaveBeenCalledTimes(1);
    expect(projector.project).toHaveBeenCalledTimes(1);
    expect(repo.markProjected).toHaveBeenCalledWith("run-1");
  });

  it("retries only projection for a stored terminal run", async () => {
    const terminal = run("succeeded");
    terminal.audit = {} as AiAuditSummary;
    const repo = repository(terminal);
    const gateway = { recognize: vi.fn() } as CouponThreeSourceAiGateway;
    const projector = {
      project: vi.fn(async () => {
        throw new Error("Base unavailable");
      }),
    };
    const handler = createCouponAiRecognitionEffectHandler({
      repository: repo,
      gateway,
      sourceLoader: { load: vi.fn() },
      projector,
    });
    await expect(handler(effect())).resolves.toMatchObject({
      kind: "retry",
      errorCode: "AI_PROJECTION_FAILED",
    });
    expect(gateway.recognize).not.toHaveBeenCalled();
    expect(repo.saveTerminalResult).not.toHaveBeenCalled();
  });

  it("persists timeout as terminal outcome_unknown without provider retry", async () => {
    const bytes = await sourceBytes();
    const { createHash } = await import("node:crypto");
    const pending = {
      ...run("pending"),
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const repo = repository(pending);
    const gateway: CouponThreeSourceAiGateway = {
      recognize: vi.fn(async () => ({
        ok: false as const,
        code: "timeout" as const,
        requestSha256: "r".repeat(64),
        startedAt: "2030-01-01T00:00:00.000Z",
        completedAt: "2030-01-01T00:00:01.000Z",
        durationMs: 1000,
      })),
    };
    const handler = createCouponAiRecognitionEffectHandler({
      repository: repo,
      gateway,
      sourceLoader: {
        load: vi.fn(async () => ({ fileName: "coupon.xlsx", bytes })),
      },
      projector: { project: vi.fn(async () => undefined) },
    });
    await expect(handler(effect())).resolves.toMatchObject({
      kind: "succeeded",
    });
    expect(repo.saveTerminalResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "outcome_unknown",
        fallbackCode: "timeout",
      }),
    );
    expect(gateway.recognize).toHaveBeenCalledTimes(1);
  });
});
