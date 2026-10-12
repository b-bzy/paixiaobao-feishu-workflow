import { randomUUID } from "node:crypto";
import type { ValidatedCouponSupplementText } from "../../../coupon-oa/three-source/ai-text";
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
  "coupon-three-source-pilot-v1";

export interface CouponThreeSourceSourceReference {
  messageId: string;
  fileKey: string;
  fileName: string;
  bytes: number;
  sha256: string;
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
  pendingRecognition?: StoredWorkbookRecognition;
  supplementRecognition?: {
    text: string;
    textSha256: string;
    runId: string;
    revision: number;
    status: "pending" | "succeeded" | "failed" | "outcome_unknown";
    result?: ValidatedCouponSupplementText;
    audit?: AiAuditSummary;
    fallbackCode?: string;
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
    pendingRecognition: input.pendingRecognition,
    supplementRecognition: input.supplementRecognition,
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
  if (stored.task.schemaVersion !== couponThreeSourceTaskSchemaVersion) {
    throw new Error("Three-source pilot record has an unsupported task schema");
  }
  return {
    recordId: record.record_id,
    pilotId: scalar(record.fields["Pilot ID"]),
    ownerOpenId: scalar(record.fields["Owner Open ID"]),
    schemaVersion: scalar(
      record.fields["Schema Version"],
    ) as typeof couponThreeSourcePilotSchemaVersion,
    ...stored,
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
  const next = { ...draft, ...updates };
  const {
    recordId: _,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...value
  } = next;
  const result = await request(
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${draft.recordId}`,
    { method: "PUT", body: JSON.stringify({ fields: fields(value) }) },
  );
  if (!result.data?.record) {
    throw new Error(
      "Feishu Base did not return an updated three-source pilot record",
    );
  }
  return parseRecord(result.data.record);
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
