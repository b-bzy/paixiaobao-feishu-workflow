import {
  activityCopyPromptVersion,
  buildActivityCopyFacts,
  validateActivityCopyProposal,
} from "../coupon-oa/three-source/activity-copy";
import {
  couponThreeSourceAiPromptVersion,
  serializeWorkbookForAi,
  validateCouponThreeSourceAiProposal,
} from "../coupon-oa/three-source/ai-recognition";
import { findMonthDayWindowInTexts } from "../coupon-oa/three-source/public-calendar";
import type {
  AiAuditSummary,
  OfflineSourceFile,
} from "../coupon-oa/three-source/types";
import type { CouponActivityCopyGateway } from "../feishu/deepseek-activity-copy-gateway";
import type { CouponThreeSourceAiGateway } from "../feishu/deepseek-chat-gateway";
import type { PublicCampaignCalendarGateway } from "../feishu/public-campaign-calendar-gateway";
import type { DurableEffectResult } from "./durable-effect-worker";
import { sha256Bytes } from "./object-store";
import type {
  CouponAiRecognitionRepository,
  CouponAiRecognitionRun,
} from "./postgres-coupon-ai-recognition-repository";
import type { DurableEffect } from "./postgres-durable-effect-repository";

export interface CouponAiRecognitionProjector {
  project(input: {
    run: CouponAiRecognitionRun;
    idempotencyKey: string;
  }): Promise<void>;
}

export interface CouponAiSourceLoader {
  load(run: CouponAiRecognitionRun): Promise<OfflineSourceFile>;
}

function stringField(
  result: ReturnType<typeof validateCouponThreeSourceAiProposal>,
  key: "activityName" | "activityStartAt" | "activityEndAt" | "businessMode",
): string | undefined {
  const value = result.fieldCandidates.find(
    (candidate) => candidate.key === key && candidate.value !== undefined,
  )?.value;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseTier(display: string):
  | {
      thresholdYuan: number;
      discountAmountYuan: number;
    }
  | undefined {
  const normalized = display.replace(/[,，\s]/g, "");
  const match = normalized.match(/(?:满)?(\d+(?:\.\d+)?)减(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const thresholdYuan = Number(match[1]);
  const discountAmountYuan = Number(match[2]);
  if (
    !Number.isFinite(thresholdYuan) ||
    !Number.isFinite(discountAmountYuan) ||
    thresholdYuan <= discountAmountYuan
  ) {
    return undefined;
  }
  return { thresholdYuan, discountAmountYuan };
}

function activityCopyFacts(input: {
  result: ReturnType<typeof validateCouponThreeSourceAiProposal>;
  campaignTheme?: string;
}) {
  const seenTiers = new Set<string>();
  const tiers = input.result.couponCandidates.flatMap((candidate) => {
    const amounts = parseTier(candidate.displayName);
    if (!amounts) return [];
    const canonicalDisplay = `满${amounts.thresholdYuan}减${amounts.discountAmountYuan}`;
    if (seenTiers.has(canonicalDisplay)) return [];
    seenTiers.add(canonicalDisplay);
    return [
      {
        id: candidate.id,
        display: canonicalDisplay,
        ...amounts,
        evidenceCells: candidate.evidenceCells,
      },
    ];
  });
  if (!tiers.length) return undefined;
  const businessModeValue = stringField(input.result, "businessMode");
  const businessMode =
    businessModeValue === "严选" || businessModeValue === "寄卖"
      ? businessModeValue
      : businessModeValue?.toLowerCase() === "pop"
        ? "pop"
        : undefined;
  const start = stringField(input.result, "activityStartAt");
  const end = stringField(input.result, "activityEndAt");
  return buildActivityCopyFacts({
    sourceHashes: { coupon: input.result.sourceHash },
    period: start && end ? `${start}至${end}` : (start ?? end),
    businessMode,
    campaignTheme:
      input.result.campaignThemeCandidates?.[0]?.value ?? input.campaignTheme,
    tiers,
    sourceActivityNames: [stringField(input.result, "activityName") ?? ""],
  });
}

function payload(effect: DurableEffect): {
  runId: string;
  businessTaskId: string;
} {
  const value = effect.requestPayload;
  if (
    value.version !== "coupon-ai-recognition-effect-v1" ||
    typeof value.runId !== "string" ||
    !value.runId ||
    typeof value.businessTaskId !== "string" ||
    !value.businessTaskId
  ) {
    throw new Error("Invalid coupon AI recognition effect payload");
  }
  return {
    runId: value.runId,
    businessTaskId: value.businessTaskId,
  };
}

function auditForFailure(input: {
  run: CouponAiRecognitionRun;
  code: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  requestSha256?: string;
  responseSha256?: string;
  outcomeUnknown?: boolean;
}): AiAuditSummary {
  const now = new Date().toISOString();
  return {
    provider: "deepseek",
    model: input.run.model,
    promptVersion: input.run.promptVersion,
    status: input.outcomeUnknown ? "outcome_unknown" : "failed",
    requestSha256: input.requestSha256,
    responseSha256: input.responseSha256,
    startedAt: input.startedAt ?? now,
    completedAt: input.completedAt ?? now,
    durationMs: input.durationMs ?? 0,
    fallbackReason: input.code,
  };
}

export function createCouponAiRecognitionEffectHandler(input: {
  repository: CouponAiRecognitionRepository;
  gateway: CouponThreeSourceAiGateway;
  sourceLoader: CouponAiSourceLoader;
  projector: CouponAiRecognitionProjector;
  calendarGateway?: PublicCampaignCalendarGateway;
  activityCopyGateway?: CouponActivityCopyGateway;
}): (effect: DurableEffect) => Promise<DurableEffectResult> {
  return async (effect) => {
    let reference: { runId: string; businessTaskId: string };
    try {
      reference = payload(effect);
    } catch {
      return {
        kind: "dead_letter",
        errorCode: "INVALID_EFFECT_PAYLOAD",
        errorMessage: "Coupon AI recognition effect payload is invalid",
      };
    }
    let run = await input.repository.get(reference.runId);
    if (!run || run.businessTaskId !== reference.businessTaskId) {
      return {
        kind: "dead_letter",
        errorCode: "AI_RUN_NOT_FOUND",
        errorMessage: "Coupon AI recognition run is missing",
      };
    }

    if (run.status === "pending") {
      let source: OfflineSourceFile;
      try {
        source = await input.sourceLoader.load(run);
        if (sha256Bytes(source.bytes) !== run.sourceSha256) {
          throw new Error("source_hash_mismatch");
        }
      } catch {
        return {
          kind: "retry",
          retryAt: new Date(Date.now() + 5_000).toISOString(),
          errorCode: "AI_SOURCE_UNAVAILABLE",
          errorMessage: "AI source could not be loaded and verified",
        };
      }
      const workbook = await serializeWorkbookForAi(source);
      const monthDayWindow = findMonthDayWindowInTexts(
        workbook.sheets.flatMap((sheet) =>
          sheet.rows.flatMap((row) =>
            row.cells.flatMap((cell) =>
              typeof cell.value === "string" ? [cell.value] : [],
            ),
          ),
        ),
      );
      let calendar:
        | Awaited<ReturnType<PublicCampaignCalendarGateway["lookup"]>>
        | undefined;
      if (monthDayWindow && input.calendarGateway) {
        try {
          calendar = await input.calendarGateway.lookup({
            ...monthDayWindow,
            locale: "zh-CN",
            queryVersion: "coupon-public-calendar-v1",
          });
        } catch {
          calendar = { ok: false, code: "network_error" };
        }
      }
      const gateway = await input.gateway.recognize({
        workbook,
        publicCampaignCandidates: calendar?.ok
          ? calendar.candidates
          : undefined,
      });
      if (gateway.ok) {
        const result = validateCouponThreeSourceAiProposal({
          proposal: gateway.proposal,
          workbook,
        });
        let activityCopyAudit: AiAuditSummary["activityCopy"] = {
          status: "skipped",
          promptVersion: activityCopyPromptVersion,
          failureCode: "activity_copy_disabled",
        };
        if (input.activityCopyGateway && run.sourceSlot === "couponTable") {
          const facts = activityCopyFacts({
            result,
            campaignTheme: calendar?.ok
              ? calendar.candidates[0]?.name
              : undefined,
          });
          if (!facts) {
            result.issues.push("AI 未识别出可校验的券档，未生成活动文案");
            activityCopyAudit = {
              status: "skipped",
              promptVersion: activityCopyPromptVersion,
              failureCode: "missing_validated_tiers",
            };
          } else {
            const copyResponse =
              await input.activityCopyGateway.generate(facts);
            if (copyResponse.ok) {
              const copy = validateActivityCopyProposal({
                facts,
                proposal: copyResponse.proposal,
              });
              if (
                copy.status === "valid" &&
                copy.activityName &&
                copy.activityBackground
              ) {
                const evidenceCells = facts.tiers.flatMap(
                  (tier) => tier.evidenceCells,
                );
                result.activityCopyCandidates = [
                  {
                    key: "activityName",
                    value: copy.activityName,
                    evidenceCells,
                  },
                  {
                    key: "activityBackground",
                    value: copy.activityBackground,
                    evidenceCells,
                  },
                ];
                activityCopyAudit = {
                  status: "succeeded",
                  promptVersion: activityCopyPromptVersion,
                  requestSha256: copyResponse.requestSha256,
                  responseSha256: copyResponse.responseSha256,
                  durationMs: copyResponse.durationMs,
                };
              } else {
                result.issues.push(...copy.issues);
                activityCopyAudit = {
                  status: "failed",
                  promptVersion: activityCopyPromptVersion,
                  requestSha256: copyResponse.requestSha256,
                  responseSha256: copyResponse.responseSha256,
                  durationMs: copyResponse.durationMs,
                  failureCode: "invalid_activity_copy",
                };
              }
            } else {
              result.issues.push(`AI 活动文案生成失败：${copyResponse.code}`);
              activityCopyAudit = {
                status: "failed",
                promptVersion: activityCopyPromptVersion,
                requestSha256: copyResponse.requestSha256,
                responseSha256: copyResponse.responseSha256,
                durationMs: copyResponse.durationMs,
                failureCode: copyResponse.code,
              };
            }
          }
        }
        result.activityCopyAudit = activityCopyAudit;
        const missingCouponCandidates =
          run.sourceSlot === "couponTable" &&
          result.couponCandidates.length === 0;
        if (missingCouponCandidates) {
          result.issues.push("AI 未返回任何可校验的优惠券候选");
        }
        const invalid =
          missingCouponCandidates ||
          result.issues.some((issue) => issue.includes("schema"));
        const audit: AiAuditSummary = {
          provider: "deepseek",
          model: run.model,
          promptVersion: couponThreeSourceAiPromptVersion,
          status: invalid ? "failed" : "succeeded",
          requestSha256: gateway.requestSha256,
          responseSha256: gateway.responseSha256,
          startedAt: gateway.startedAt,
          completedAt: gateway.completedAt,
          durationMs: gateway.durationMs,
          fallbackReason: invalid ? "invalid_proposal" : undefined,
          activityCopy: activityCopyAudit,
        };
        run = await input.repository.saveTerminalResult({
          runId: run.id,
          status: invalid ? "failed" : "succeeded",
          result,
          audit,
          fallbackCode: invalid ? "invalid_proposal" : undefined,
        });
      } else {
        const outcomeUnknown = ["timeout", "network_error"].includes(
          gateway.code,
        );
        run = await input.repository.saveTerminalResult({
          runId: run.id,
          status: outcomeUnknown ? "outcome_unknown" : "failed",
          audit: auditForFailure({
            run,
            code: gateway.code,
            startedAt: gateway.startedAt,
            completedAt: gateway.completedAt,
            durationMs: gateway.durationMs,
            requestSha256: gateway.requestSha256,
            responseSha256: gateway.responseSha256,
            outcomeUnknown,
          }),
          fallbackCode: gateway.code,
        });
      }
    }

    try {
      await input.projector.project({
        run,
        idempotencyKey: effect.id,
      });
      await input.repository.markProjected(run.id);
      return { kind: "succeeded", externalReference: run.id };
    } catch {
      return {
        kind: "retry",
        retryAt: new Date(Date.now() + 5_000).toISOString(),
        errorCode: "AI_PROJECTION_FAILED",
        errorMessage: "AI terminal result projection failed",
      };
    }
  };
}
