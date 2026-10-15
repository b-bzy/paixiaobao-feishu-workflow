import { createHash, randomUUID } from "node:crypto";
import type { ValidatedCouponSupplementText } from "../../../coupon-oa/three-source/ai-text";
import { toCouponThreeSourceUserFailure } from "../../../coupon-oa/three-source/errors";
import type { ListColumnSelection } from "../../../coupon-oa/three-source/offline";
import {
  type CouponThreeSourceTask,
  couponThreeSourceTaskSchemaVersion,
} from "../../../coupon-oa/three-source/task";
import type {
  AiAuditSummary,
  CanonicalPackage,
  ConfirmedCouponSetSource,
  ConfirmedCouponSource,
  CouponCandidate,
  CouponFieldKey,
  CouponType,
  ListColumnCandidate,
  OaPrefillSnapshot,
  OverlapDecision,
  ParsedSingleCouponIdentifierList,
  ParsedTieredIdentifierList,
  SourceRoleCandidate,
  ValidatedAiRecognition,
  WorkbookRecognition,
} from "../../../coupon-oa/three-source/types";
import { getTenantAccessToken } from "../../client";
import type { FrozenThreeSourceArtifact } from "./handoff";
import {
  getCouponThreeSourcePilotBaseAppToken,
  getCouponThreeSourcePilotTableId,
} from "./pilot-config";

export const couponThreeSourcePilotSchemaVersion =
  "coupon-three-source-pilot-v2";

const THREE_SOURCE_PILOT_REQUEST_TIMEOUT_MS = 20_000;

export interface CouponThreeSourceSourceReference {
  messageId: string;
  fileKey: string;
  fileName: string;
  bytes: number;
  sha256: string;
}

export interface PendingCouponThreeSourceSource {
  source: CouponThreeSourceSourceReference;
  receivedOrder: number;
  recognition: StoredWorkbookRecognition;
}

export interface StoredWorkbookRecognition
  extends Omit<WorkbookRecognition, "source"> {
  source: CouponThreeSourceSourceReference;
  couponCandidates?: CouponCandidate[];
  ai?: {
    runId: string;
    revision: number;
    sourceSha256: string;
    status: "pending" | "succeeded" | "failed" | "outcome_unknown";
    result?: ValidatedAiRecognition;
    audit?: AiAuditSummary;
    fallbackCode?: string;
    primary?: boolean;
    activityCopyEnabled?: boolean;
  };
}

export interface CouponThreeSourcePilotSelections {
  couponFieldCandidateIds?: Partial<Record<CouponFieldKey, string>>;
  couponType?: CouponType;
  couponCandidateId?: string;
  ownerFieldValues?: Partial<Record<CouponFieldKey, unknown>>;
  overrideReasons?: Partial<Record<CouponFieldKey, string>>;
  whitelist?: ListColumnSelection & { selectedSheetName?: string };
  blacklist?: ListColumnSelection & { selectedSheetName?: string };
  identifierDimensionConfirmations?: Partial<
    Record<
      "whitelist" | "blacklist",
      {
        sourceSha256: string;
        detectedDimension: "SPU" | "MERCHANT_ID" | "UNKNOWN";
        confirmedAs: "SKU";
        reason: string;
      }
    >
  >;
  activityPointPercent?: number;
  overlapDecision?: OverlapDecision;
}

export interface CouponThreeSourcePilotDraft {
  recordId: string;
  pilotId: string;
  ownerOpenId: string;
  task: CouponThreeSourceTask;
  schemaVersion: typeof couponThreeSourcePilotSchemaVersion;
  recognitions: Partial<
    Record<"couponTable" | "whitelist" | "blacklist", StoredWorkbookRecognition>
  >;
  pendingSources?: PendingCouponThreeSourceSource[];
  pendingRecognition?: StoredWorkbookRecognition;
  supplementRecognition?: {
    kind?: "owner_supplement" | "form_repair";
    text: string;
    textSha256: string;
    runId: string;
    revision: number;
    status: "pending" | "succeeded" | "failed" | "outcome_unknown";
    result?: ValidatedCouponSupplementText;
    audit?: AiAuditSummary;
    fallbackCode?: string;
    replaceOwnerFieldKeys?: CouponFieldKey[];
  };
  mappingCardDelivery?: {
    messageId: string;
    revision: number;
    contextHash?: string;
  };
  selections: CouponThreeSourcePilotSelections;
  coupon?: ConfirmedCouponSource;
  couponSet?: ConfirmedCouponSetSource;
  whitelist?: ParsedSingleCouponIdentifierList | ParsedTieredIdentifierList;
  blacklist?: ParsedSingleCouponIdentifierList | ParsedTieredIdentifierList;
  package?: CanonicalPackage;
  artifacts: FrozenThreeSourceArtifact[];
  oaPrefill?: OaPrefillSnapshot;
  oaDraftRecordId?: string;
  processedMessageIds: string[];
  validationIssues: string[];
  failureReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export function computeCouponThreeSourceMappingContextHash(
  draft: CouponThreeSourcePilotDraft,
): string {
  const roles = (["couponTable", "whitelist", "blacklist"] as const).map(
    (role) => {
      const recognition = draft.recognitions[role];
      return {
        role,
        sourceSha256: draft.task.sources[role]?.sha256 ?? null,
        listCandidates: (recognition?.listCandidates ?? []).map(
          (candidate) => ({
            id: candidate.id,
            kind: candidate.kind,
            dimension: candidate.dimension ?? null,
            sheetName: candidate.sheetName,
            column: candidate.column,
            headerRow: candidate.headerRow,
          }),
        ),
      };
    },
  );
  const pending = (draft.pendingSources ?? [])
    .map((item) => ({
      sourceSha256: item.recognition.sourceHash,
      receivedOrder: item.receivedOrder,
    }))
    .sort((left, right) => left.sourceSha256.localeCompare(right.sourceSha256));
  return createHash("sha256")
    .update(
      JSON.stringify({
        taskId: draft.task.taskId,
        revision: draft.task.revision,
        roles,
        pending,
        blacklistStatus: draft.task.blacklistStatus,
      }),
    )
    .digest("hex");
}

interface BaseRecord {
  record_id: string;
  created_time?: number;
  last_modified_time?: number;
  fields: Record<string, unknown>;
}

interface BaseResponse {
  code: number;
  msg: string;
  data?: { record?: BaseRecord; items?: BaseRecord[] };
}

function scalar(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

function iso(value: unknown): string | undefined {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString()
    : undefined;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function request(
  path: string,
  init: RequestInit = {},
): Promise<BaseResponse> {
  getCouponThreeSourcePilotBaseAppToken();
  const token = await getTenantAccessToken();
  const response = await fetch(`https://open.feishu.cn/open-apis${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(THREE_SOURCE_PILOT_REQUEST_TIMEOUT_MS),
  });
  const result = (await response.json()) as BaseResponse;
  if (!response.ok || result.code !== 0) {
    throw new Error(`Feishu three-source pilot request failed: ${result.msg}`);
  }
  return result;
}

function state(
  input: Omit<
    CouponThreeSourcePilotDraft,
    "recordId" | "createdAt" | "updatedAt"
  >,
) {
  return {
    task: input.task,
    recognitions: input.recognitions,
    pendingSources: input.pendingSources ?? [],
    pendingRecognition: input.pendingRecognition,
    supplementRecognition: input.supplementRecognition,
    mappingCardDelivery: input.mappingCardDelivery,
    selections: input.selections,
    coupon: input.coupon,
    couponSet: input.couponSet,
    whitelist: input.whitelist,
    blacklist: input.blacklist,
    package: input.package,
    artifacts: input.artifacts,
    oaPrefill: input.oaPrefill,
    oaDraftRecordId: input.oaDraftRecordId,
    processedMessageIds: input.processedMessageIds,
    validationIssues: input.validationIssues,
    failureReason: input.failureReason,
  };
}

function fields(
  input: Omit<
    CouponThreeSourcePilotDraft,
    "recordId" | "createdAt" | "updatedAt"
  >,
) {
  return {
    "Pilot ID": input.pilotId,
    "Owner Open ID": input.ownerOpenId,
    Status: input.task.status,
    Revision: input.task.revision,
    "Schema Version": input.schemaVersion,
    "Task ID": input.task.taskId,
    "State JSON": JSON.stringify(state(input)),
  };
}

function normalizeStoredRecognition(
  recognition: StoredWorkbookRecognition | undefined,
): StoredWorkbookRecognition | undefined {
  if (!recognition) return undefined;
  const result = recognition.ai?.result;
  return {
    ...recognition,
    roleCandidates: recognition.roleCandidates ?? [],
    couponFieldCandidates: recognition.couponFieldCandidates ?? {},
    listCandidates: recognition.listCandidates ?? [],
    couponCandidates: recognition.couponCandidates ?? [],
    issues: recognition.issues ?? [],
    ai: recognition.ai
      ? {
          ...recognition.ai,
          result: result
            ? {
                ...result,
                roleCandidates: result.roleCandidates ?? [],
                couponCandidates: result.couponCandidates ?? [],
                fieldCandidates: result.fieldCandidates ?? [],
                listCandidates: result.listCandidates ?? [],
                activityCopyCandidates: result.activityCopyCandidates ?? [],
                templateCandidates: result.templateCandidates ?? [],
                tierCandidates: result.tierCandidates ?? [],
                skuRegionCandidates: result.skuRegionCandidates ?? [],
                issues: result.issues ?? [],
              }
            : undefined,
        }
      : undefined,
  };
}

export function normalizeCouponThreeSourcePilotDraftState(
  stored: Omit<
    CouponThreeSourcePilotDraft,
    | "recordId"
    | "pilotId"
    | "ownerOpenId"
    | "schemaVersion"
    | "createdAt"
    | "updatedAt"
  >,
): typeof stored {
  const legacyTask = stored.task as CouponThreeSourceTask & {
    schemaVersion: string;
    sources?: CouponThreeSourceTask["sources"];
    confirmedCalcImages?: CouponThreeSourceTask["confirmedCalcImages"];
    pendingCalcImages?: CouponThreeSourceTask["pendingCalcImages"];
    processedCalcImageOperationIds?: string[];
    artifacts?: CouponThreeSourceTask["artifacts"];
  };
  const recognitions = stored.recognitions ?? {};
  return {
    ...stored,
    task: {
      ...legacyTask,
      schemaVersion: couponThreeSourceTaskSchemaVersion,
      sources: legacyTask.sources ?? {},
      confirmedCalcImages: legacyTask.confirmedCalcImages ?? [],
      pendingCalcImages: legacyTask.pendingCalcImages ?? [],
      processedCalcImageOperationIds:
        legacyTask.processedCalcImageOperationIds ?? [],
      artifacts: (legacyTask.artifacts ?? []).map((artifact, index) => ({
        ...artifact,
        artifactId:
          artifact.artifactId ?? `${artifact.role}-${artifact.sha256}`,
        order: artifact.order ?? index,
      })),
    },
    recognitions: {
      couponTable: normalizeStoredRecognition(recognitions.couponTable),
      whitelist: normalizeStoredRecognition(recognitions.whitelist),
      blacklist: normalizeStoredRecognition(recognitions.blacklist),
    },
    pendingSources: (stored.pendingSources ?? []).map((pending) => ({
      ...pending,
      recognition:
        normalizeStoredRecognition(pending.recognition) ?? pending.recognition,
    })),
    pendingRecognition: normalizeStoredRecognition(stored.pendingRecognition),
    selections: stored.selections ?? {},
    artifacts: stored.artifacts ?? [],
    processedMessageIds: stored.processedMessageIds ?? [],
    validationIssues: stored.validationIssues ?? [],
    failureReason: stored.failureReason
      ? toCouponThreeSourceUserFailure(new Error(stored.failureReason)).message
      : undefined,
  };
}

function parseRecord(record: BaseRecord): CouponThreeSourcePilotDraft {
  const stored = parseJson<Omit<
    CouponThreeSourcePilotDraft,
    | "recordId"
    | "pilotId"
    | "ownerOpenId"
    | "schemaVersion"
    | "createdAt"
    | "updatedAt"
  > | null>(record.fields["State JSON"], null);
  if (!stored?.task) {
    throw new Error("Three-source pilot record is missing state");
  }
  const legacyTask = stored.task as CouponThreeSourceTask & {
    schemaVersion: string;
  };
  if (
    legacyTask.schemaVersion !== couponThreeSourceTaskSchemaVersion &&
    legacyTask.schemaVersion !== "coupon-three-source-r2-v1"
  ) {
    throw new Error("Three-source pilot record has an unsupported task schema");
  }
  const normalized = normalizeCouponThreeSourcePilotDraftState(stored);
  return {
    recordId: record.record_id,
    pilotId: scalar(record.fields["Pilot ID"]),
    ownerOpenId: scalar(record.fields["Owner Open ID"]),
    schemaVersion: couponThreeSourcePilotSchemaVersion,
    ...normalized,
    createdAt: iso(record.created_time),
    updatedAt: iso(record.last_modified_time),
  };
}

function isActive(draft: CouponThreeSourcePilotDraft): boolean {
  return !["DraftOnlyConfirmed", "Canceled"].includes(draft.task.status);
}

export async function createCouponThreeSourcePilotDraft(input: {
  ownerOpenId: string;
  task: CouponThreeSourceTask;
}): Promise<CouponThreeSourcePilotDraft> {
  const tableId = getCouponThreeSourcePilotTableId();
  const appToken = getCouponThreeSourcePilotBaseAppToken();
  const draft = {
    pilotId: `CTS-${randomUUID()}`,
    ownerOpenId: input.ownerOpenId,
    task: input.task,
    schemaVersion: couponThreeSourcePilotSchemaVersion,
    recognitions: {},
    pendingSources: [],
    selections: {},
    artifacts: [],
    processedMessageIds: [],
    validationIssues: [],
  } satisfies Omit<
    CouponThreeSourcePilotDraft,
    "recordId" | "createdAt" | "updatedAt"
  >;
  const result = await request(
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
    { method: "POST", body: JSON.stringify({ fields: fields(draft) }) },
  );
  if (!result.data?.record) {
    throw new Error("Feishu Base did not return a three-source pilot record");
  }
  return parseRecord(result.data.record);
}

export async function getCouponThreeSourcePilotDraft(
  recordId: string,
): Promise<CouponThreeSourcePilotDraft> {
  const tableId = getCouponThreeSourcePilotTableId();
  const appToken = getCouponThreeSourcePilotBaseAppToken();
  const result = await request(
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
  );
  if (!result.data?.record)
    throw new Error("Three-source pilot record was not found");
  return parseRecord(result.data.record);
}

export async function listActiveCouponThreeSourcePilotDrafts(
  ownerOpenId: string,
): Promise<CouponThreeSourcePilotDraft[]> {
  const tableId = getCouponThreeSourcePilotTableId();
  const appToken = getCouponThreeSourcePilotBaseAppToken();
  const result = await request(
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=100`,
  );
  return (result.data?.items ?? [])
    .map(parseRecord)
    .filter((draft) => draft.ownerOpenId === ownerOpenId && isActive(draft))
    .sort((left, right) =>
      (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
    );
}

// Feishu Base silently drops text-field writes beyond its cell limit (the
// API still echoes success), so state must stay well below it and every
// write must be verified against a fresh read of the stored record.
const maxStateJsonChars = 90_000;

export async function updateCouponThreeSourcePilotDraft(
  draft: CouponThreeSourcePilotDraft,
  updates: Partial<
    Omit<
      CouponThreeSourcePilotDraft,
      | "recordId"
      | "pilotId"
      | "ownerOpenId"
      | "schemaVersion"
      | "createdAt"
      | "updatedAt"
    >
  >,
  expectedRevision = draft.task.revision,
): Promise<CouponThreeSourcePilotDraft> {
  if (draft.task.revision !== expectedRevision) {
    throw new Error(
      "Three-source pilot version changed; reopen the latest card",
    );
  }
  if (!isActive(draft)) {
    throw new Error(
      "Confirmed or canceled three-source pilot drafts cannot be changed",
    );
  }
  const tableId = getCouponThreeSourcePilotTableId();
  const appToken = getCouponThreeSourcePilotBaseAppToken();
  // Base has no conditional write, so guard the read-modify-write by
  // re-reading the stored revision and refusing to overwrite a newer one.
  // The in-memory check above only validates the caller's stale snapshot.
  const stored = await getCouponThreeSourcePilotDraft(draft.recordId);
  if (stored.task.revision !== expectedRevision) {
    throw new Error(
      "Three-source pilot version changed; reopen the latest card",
    );
  }
  if (!isActive(stored)) {
    throw new Error(
      "Confirmed or canceled three-source pilot drafts cannot be changed",
    );
  }
  const next = { ...stored, ...updates };
  const {
    recordId: _,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...value
  } = next;
  const stateJson = JSON.stringify(state(value));
  if (stateJson.length > maxStateJsonChars) {
    throw new Error(
      `三源提报状态超出 Base 存储预算（${stateJson.length} > ${maxStateJsonChars} 字符），已拒绝写入以避免静默丢失`,
    );
  }
  const result = await request(
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${draft.recordId}`,
    { method: "PUT", body: JSON.stringify({ fields: fields(value) }) },
  );
  if (!result.data?.record) {
    throw new Error(
      "Feishu Base did not return an updated three-source pilot record",
    );
  }
  // The PUT response only echoes the submitted fields; re-read the record to
  // verify Base actually persisted the revision and status.
  const verified = await getCouponThreeSourcePilotDraft(draft.recordId);
  if (
    verified.task.revision !== next.task.revision ||
    verified.task.status !== next.task.status
  ) {
    throw new Error(
      "Three-source pilot persistence verification failed; reopen the latest card",
    );
  }
  return verified;
}

export function toStoredWorkbookRecognition(input: {
  recognition: WorkbookRecognition;
  source: CouponThreeSourceSourceReference;
  couponCandidates?: CouponCandidate[];
}): StoredWorkbookRecognition {
  return {
    source: input.source,
    sourceHash: input.recognition.sourceHash,
    roleCandidates: input.recognition.roleCandidates as SourceRoleCandidate[],
    couponFieldCandidates: input.recognition.couponFieldCandidates,
    listCandidates: input.recognition.listCandidates as ListColumnCandidate[],
    issues: input.recognition.issues,
    couponCandidates: input.couponCandidates,
  };
}
