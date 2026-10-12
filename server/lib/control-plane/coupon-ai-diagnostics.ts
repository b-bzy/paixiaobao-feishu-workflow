import { buildCouponThreeSourceMappingCard } from "../feishu/coupon-oa/three-source/cards";
import {
  type CouponThreeSourcePilotDraft,
  getCouponThreeSourcePilotDraft,
} from "../feishu/coupon-oa/three-source/store";
import { getControlPlaneDatabase } from "./postgres-sql-database";
import type { SqlExecutor } from "./sql";

interface AiRunDiagnosticRow extends Record<string, unknown> {
  id: string;
  pilot_record_id: string;
  status: string;
  prompt_version: string;
  fallback_code?: string;
  request_sha256?: string;
  response_sha256?: string;
  duration_ms?: number;
  validated_result?: {
    issues?: string[];
    activityCopyAudit?: {
      status?: string;
      promptVersion?: string;
      requestSha256?: string;
      responseSha256?: string;
      failureCode?: string;
    };
    activityCopyCandidates?: Array<{
      key?: string;
      value?: unknown;
    }>;
    fieldCandidates?: Array<{ key?: string; value?: unknown }>;
  };
  projected_at?: string | Date;
  created_at: string | Date;
}

export interface CouponAiRunDiagnostic {
  createdAt: string;
  status: string;
  promptVersion: string;
  fallbackCode?: string;
  requestRecorded: boolean;
  responseRecorded: boolean;
  durationMs?: number;
  projected: boolean;
  validationIssues: string[];
  activityCopyCandidateKeys: string[];
  activityFieldCandidateKeys: string[];
  activityCopyCall: {
    status: string;
    promptVersion?: string;
    requestRecorded: boolean;
    responseRecorded: boolean;
    failureCode?: string;
  };
  draftProjection: {
    available: boolean;
    sameRun: boolean;
    primary: boolean;
    activityCopyEnabled: boolean;
    storedCandidateKeys: string[];
    mappingCardPersisted: boolean;
    renderedActivityName: boolean;
    renderedActivityBackground: boolean;
  };
}

function iso(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function activityKeys(
  candidates: Array<{ key?: string; value?: unknown }> | undefined,
): string[] {
  return (candidates ?? [])
    .filter(
      (candidate) =>
        ["activityName", "activityBackground"].includes(candidate.key ?? "") &&
        Boolean(String(candidate.value ?? "").trim()),
    )
    .map((candidate) => String(candidate.key));
}

function renderedDefault(card: unknown, name: string): boolean {
  if (!card || typeof card !== "object") return false;
  if (Array.isArray(card)) {
    return card.some((item) => renderedDefault(item, name));
  }
  const object = card as Record<string, unknown>;
  if (object.name === name) {
    return Boolean(String(object.default_value ?? "").trim());
  }
  return Object.values(object).some((value) => renderedDefault(value, name));
}

function emptyDraftProjection(): CouponAiRunDiagnostic["draftProjection"] {
  return {
    available: false,
    sameRun: false,
    primary: false,
    activityCopyEnabled: false,
    storedCandidateKeys: [],
    mappingCardPersisted: false,
    renderedActivityName: false,
    renderedActivityBackground: false,
  };
}

function inspectDraft(
  draft: CouponThreeSourcePilotDraft,
  runId: string,
): CouponAiRunDiagnostic["draftProjection"] {
  const ai = draft.recognitions.couponTable?.ai;
  const card = buildCouponThreeSourceMappingCard(draft);
  return {
    available: true,
    sameRun: ai?.runId === runId,
    primary: ai?.primary === true,
    activityCopyEnabled: ai?.activityCopyEnabled === true,
    storedCandidateKeys: activityKeys(ai?.result?.activityCopyCandidates),
    mappingCardPersisted: Boolean(draft.mappingCardDelivery?.messageId),
    renderedActivityName: renderedDefault(card, "owner_activityName"),
    renderedActivityBackground: renderedDefault(
      card,
      "owner_activityBackground",
    ),
  };
}

export async function getRecentCouponAiDiagnostics(
  dependencies: {
    database?: SqlExecutor;
    getDraft?: typeof getCouponThreeSourcePilotDraft;
  } = {},
): Promise<CouponAiRunDiagnostic[]> {
  const database = dependencies.database ?? getControlPlaneDatabase();
  const getDraft = dependencies.getDraft ?? getCouponThreeSourcePilotDraft;
  const result = await database.query<AiRunDiagnosticRow>(
    `SELECT id, pilot_record_id, status, prompt_version, fallback_code,
       request_sha256, response_sha256, duration_ms, validated_result,
       projected_at, created_at
     FROM coupon_ai_recognition_runs
     WHERE source_slot = 'couponTable'
     ORDER BY created_at DESC
     LIMIT 10`,
  );
  return Promise.all(
    result.rows.map(async (row) => {
      let draftProjection = emptyDraftProjection();
      try {
        draftProjection = inspectDraft(
          await getDraft(row.pilot_record_id),
          row.id,
        );
      } catch {
        // Diagnostics must remain useful when a draft was cleared or Base is unavailable.
      }
      const validated = row.validated_result;
      return {
        createdAt: iso(row.created_at),
        status: row.status,
        promptVersion: row.prompt_version,
        fallbackCode: row.fallback_code,
        requestRecorded: Boolean(row.request_sha256),
        responseRecorded: Boolean(row.response_sha256),
        durationMs: row.duration_ms,
        projected: Boolean(row.projected_at),
        validationIssues: (validated?.issues ?? []).map(String),
        activityCopyCandidateKeys: activityKeys(
          validated?.activityCopyCandidates,
        ),
        activityFieldCandidateKeys: activityKeys(validated?.fieldCandidates),
        activityCopyCall: {
          status: validated?.activityCopyAudit?.status ?? "not_recorded",
          promptVersion: validated?.activityCopyAudit?.promptVersion,
          requestRecorded: Boolean(validated?.activityCopyAudit?.requestSha256),
          responseRecorded: Boolean(
            validated?.activityCopyAudit?.responseSha256,
          ),
          failureCode: validated?.activityCopyAudit?.failureCode,
        },
        draftProjection,
      };
    }),
  );
}
