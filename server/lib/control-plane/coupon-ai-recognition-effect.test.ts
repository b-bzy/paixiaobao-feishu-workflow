import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import type { AiAuditSummary } from "../coupon-oa/three-source/types";
import type { CouponActivityCopyGateway } from "../feishu/deepseek-activity-copy-gateway";
import type { CouponThreeSourceAiGateway } from "../feishu/deepseek-chat-gateway";
import { createCouponAiRecognitionEffectHandler } from "./coupon-ai-recognition-effect";
import type {
  CouponAiRecognitionRepository,
  CouponAiRecognitionRun,
} from "./postgres-coupon-ai-recognition-repository";
import type { DurableEffect } from "./postgres-durable-effect-repository";

async function sourceBytes(dateWindow?: string) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("配券");
  sheet.getCell("A1").value = "活动名称";
  sheet.getCell("A2").value = "活动A";
  if (dateWindow) sheet.getCell("A3").value = dateWindow;
  sheet.getCell("B1").value = "开始日期";
  sheet.getCell("B2").value = "2026-09-30T00:00:00.000Z";
  sheet.getCell("C1").value = "结束日期";
  sheet.getCell("C2").value = "2026-10-10T23:59:00.000Z";
  sheet.getCell("D1").value = "渠道";
  sheet.getCell("D2").value = "京东商城";
  sheet.getCell("D3").value = "拍拍二手";
  sheet.getCell("E1").value = "优惠券名称";
  sheet.getCell("E2").value = "平板优惠券";
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
  it("uses the dedicated activity-copy prompt and persists both card fields", async () => {
    const bytes = await sourceBytes();
    const { createHash } = await import("node:crypto");
    const pending = {
      ...run("pending"),
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const repo = repository(pending);
    const gateway: CouponThreeSourceAiGateway = {
      recognize: vi.fn(async () => ({
        ok: true as const,
        proposal: {
          couponCandidates: [
            {
              couponType: "regular_full_reduction",
              displayName: "满100减20",
              sheetName: "配券",
              row: 2,
              evidenceCells: ["A2"],
            },
          ],
          fieldCandidates: [
            {
              key: "activityStartAt",
              sheetName: "配券",
              headerCell: "B1",
              valueCell: "B2",
              confidence: 1,
              reason: "开始日期",
              origin: "source_explicit",
              value: "2026-09-30T00:00:00.000Z",
            },
            {
              key: "activityEndAt",
              sheetName: "配券",
              headerCell: "C1",
              valueCell: "C2",
              confidence: 1,
              reason: "结束日期",
              origin: "source_explicit",
              value: "2026-10-10T23:59:00.000Z",
            },
            {
              key: "channels",
              sheetName: "配券",
              headerCell: "D1",
              valueCell: "D2",
              confidence: 1,
              reason: "渠道一",
              origin: "source_explicit",
              value: "京东商城",
            },
            {
              key: "channels",
              sheetName: "配券",
              headerCell: "D1",
              valueCell: "D3",
              confidence: 1,
              reason: "渠道二",
              origin: "source_explicit",
              value: "拍拍二手",
            },
          ],
        },
        requestSha256: "r".repeat(64),
        responseSha256: "s".repeat(64),
        startedAt: "2030-01-01T00:00:00.000Z",
        completedAt: "2030-01-01T00:00:01.000Z",
        durationMs: 1000,
      })),
    };
    const activityCopyGateway: CouponActivityCopyGateway = {
      generate: vi.fn(),
    };
    // Use the fact id supplied to the dedicated gateway instead of coupling
    // this test to the internal stable-id implementation.
    vi.mocked(activityCopyGateway.generate).mockImplementationOnce(
      async (facts) => ({
        ok: true as const,
        proposal: {
          nameComponents: { category: "平板" },
          activityBackground:
            "本期申请9.30-10.10平板优惠券，本期配置一档优惠券：满100减20。",
          coveredTierIds: facts.tiers.map((tier) => tier.id),
          usedFactIds: [
            ...facts.tiers.map((tier) => tier.id),
            "period",
            "nameHints",
          ],
        },
        requestSha256: "c".repeat(64),
        responseSha256: "d".repeat(64),
        startedAt: "2030-01-01T00:00:01.000Z",
        completedAt: "2030-01-01T00:00:02.000Z",
        durationMs: 1000,
      }),
    );
    const handler = createCouponAiRecognitionEffectHandler({
      repository: repo,
      gateway,
      activityCopyGateway,
      sourceLoader: {
        load: vi.fn(async () => ({ fileName: "coupon.xlsx", bytes })),
      },
      projector: { project: vi.fn(async () => undefined) },
    });

    await expect(handler(effect())).resolves.toMatchObject({
      kind: "succeeded",
    });
    expect(activityCopyGateway.generate).toHaveBeenCalledTimes(1);
    expect(activityCopyGateway.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        period: "2026-09-30至2026-10-10",
        productLabel: "京东商城、拍拍二手",
        nameHints: expect.arrayContaining(["coupon", "配券", "平板优惠券"]),
      }),
    );
    expect(repo.saveTerminalResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "succeeded",
        result: expect.objectContaining({
          activityCopyCandidates: [
            expect.objectContaining({
              key: "activityName",
              value: "9.30-10.10平板优惠券申请",
            }),
            expect.objectContaining({ key: "activityBackground" }),
          ],
        }),
        audit: expect.objectContaining({
          activityCopy: expect.objectContaining({ status: "succeeded" }),
        }),
      }),
    );
  });

  it("records a visible failure instead of treating missing activity copy as generated", async () => {
    const bytes = await sourceBytes();
    const { createHash } = await import("node:crypto");
    const pending = {
      ...run("pending"),
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const repo = repository(pending);
    const gateway: CouponThreeSourceAiGateway = {
      recognize: vi.fn(async () => ({
        ok: true as const,
        proposal: {
          couponCandidates: [
            {
              couponType: "regular_full_reduction",
              displayName: "100减20 / A (SKUID)",
              sheetName: "配券",
              row: 2,
              evidenceCells: ["A2"],
            },
          ],
        },
        requestSha256: "r".repeat(64),
        responseSha256: "s".repeat(64),
        startedAt: "2030-01-01T00:00:00.000Z",
        completedAt: "2030-01-01T00:00:01.000Z",
        durationMs: 1000,
      })),
    };
    const activityCopyGateway: CouponActivityCopyGateway = {
      generate: vi.fn(async () => ({
        ok: false as const,
        code: "timeout" as const,
        requestSha256: "c".repeat(64),
        startedAt: "2030-01-01T00:00:01.000Z",
        completedAt: "2030-01-01T00:00:46.000Z",
        durationMs: 45_000,
      })),
    };
    const handler = createCouponAiRecognitionEffectHandler({
      repository: repo,
      gateway,
      activityCopyGateway,
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
        result: expect.objectContaining({
          activityCopyCandidates: [],
          activityCopyAudit: expect.objectContaining({
            status: "failed",
            failureCode: "timeout",
          }),
          issues: expect.arrayContaining([
            expect.stringContaining("AI 活动文案生成失败"),
          ]),
        }),
      }),
    );
  });

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

  it("passes bounded public-calendar candidates to recognition and degrades safely", async () => {
    const bytes = await sourceBytes("9月30日-10月10日");
    const { createHash } = await import("node:crypto");
    const pending = {
      ...run("pending"),
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    };
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
    const calendarGateway = {
      lookup: vi.fn(async () => ({
        ok: true as const,
        candidates: [
          {
            name: "国庆促销期",
            startDate: "2030-09-30",
            endDate: "2030-10-10",
            sourceUrl: "https://calendar.example.test/campaign/1",
            fetchedAt: "2030-01-01T00:00:00.000Z",
          },
        ],
      })),
    };
    const handler = createCouponAiRecognitionEffectHandler({
      repository: repo,
      gateway,
      calendarGateway,
      sourceLoader: {
        load: vi.fn(async () => ({ fileName: "coupon.xlsx", bytes })),
      },
      projector: { project: vi.fn(async () => undefined) },
    });

    await expect(handler(effect())).resolves.toMatchObject({
      kind: "succeeded",
    });
    expect(calendarGateway.lookup).toHaveBeenCalledWith({
      startMonthDay: "09-30",
      endMonthDay: "10-10",
      locale: "zh-CN",
      queryVersion: "coupon-public-calendar-v1",
    });
    expect(gateway.recognize).toHaveBeenCalledWith(
      expect.objectContaining({
        publicCampaignCandidates: [
          expect.objectContaining({ name: "国庆促销期" }),
        ],
      }),
    );
  });
});
