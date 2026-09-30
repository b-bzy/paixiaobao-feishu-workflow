import { createHash, randomUUID } from "node:crypto";
import { getTenantAccessToken } from "../client";
import type { CouponOaAttachment } from "./draft-store";
import { getCouponExcelPilotTableId } from "./excel-pilot-config";
import type { CouponPilotInput } from "./excel-pilot-schema";

export const couponExcelPilotStatuses = [
  "Collecting",
  "AwaitingInputConfirmation",
  "AwaitingWhitelistUpload",
  "AwaitingWhitelistMapping",
  "Generating",
  "AwaitingOutputConfirmation",
  "HandingOffToOa",
  "GeneratedConfirmed",
  "NeedsInput",
  "RetryableFailure",
  "Canceled",
] as const;
export type CouponExcelPilotStatus = (typeof couponExcelPilotStatuses)[number];

export interface CouponExcelPilotSourceFile {
  messageId: string;
  fileKey: string;
  fileName: string;
  bytes: number;
  sha256: string;
  candidates?: Array<{
    sheetName: string;
    column: string;
    header: string;
    nonEmptyCount: number;
    sampleValues: string[];
  }>;
}

export interface CouponExcelPilotMapping {
  sheetName: string;
  column: string;
  header: string;
}

export interface CouponExcelPilotArtifact {
  role: "couponTable" | "productWhitelist";
  fileName: string;
  /** Token for the frozen ordinary-Drive artifact used by the OA handoff. */
  fileToken: string;
  /** Token for the duplicate media owned by this Bitable attachment field. */
  baseFileToken?: string;
  bytes: number;
  sha256: string;
  templateId: string;
  templateVersion: string;
}

export interface CouponExcelPilotOaHandoff {
  approvalAttachments?: CouponOaAttachment[];
  oaDraftRecordId?: string;
}

export interface CouponExcelPilotDraft {
  recordId: string;
  pilotId: string;
  ownerOpenId: string;
  status: CouponExcelPilotStatus;
  revision: number;
  schemaVersion: string;
  candidateInput?: Record<string, unknown>;
  input?: CouponPilotInput;
  sourceWhitelist?: CouponExcelPilotSourceFile;
  whitelistMapping?: CouponExcelPilotMapping;
  artifacts: CouponExcelPilotArtifact[];
  oaHandoff?: CouponExcelPilotOaHandoff;
  validationIssues: string[];
  processedMessageIds: string[];
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

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function iso(value: unknown): string | undefined {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString()
    : undefined;
}

async function request(
  path: string,
  init: RequestInit = {},
): Promise<BaseResponse> {
  const appToken = process.env.FEISHU_BASE_APP_TOKEN;
  if (!appToken) throw new Error("Feishu Base POC is not configured");
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
    throw new Error(`Feishu Excel pilot draft request failed: ${result.msg}`);
  }
  return result;
}

function attachmentField(artifact: CouponExcelPilotArtifact | undefined) {
  if (!artifact?.baseFileToken) return [];
  return [
    {
      file_token: artifact.baseFileToken,
      name: artifact.fileName,
      size: artifact.bytes,
    },
  ];
}

function recordFields(
  input: Omit<CouponExcelPilotDraft, "recordId" | "createdAt" | "updatedAt">,
): Record<string, unknown> {
  const couponArtifact = input.artifacts.find(
    (artifact) => artifact.role === "couponTable",
  );
  const whitelistArtifact = input.artifacts.find(
    (artifact) => artifact.role === "productWhitelist",
  );
  return {
    "Pilot ID": input.pilotId,
    "Owner Open ID": input.ownerOpenId,
    Status: input.status,
    Revision: input.revision,
    "Schema Version": input.schemaVersion,
    "Candidate Input JSON": JSON.stringify(input.candidateInput ?? {}),
    "Input JSON": JSON.stringify(input.input ?? {}),
    "Source Whitelist JSON": JSON.stringify(input.sourceWhitelist ?? null),
    "Whitelist Mapping JSON": JSON.stringify(input.whitelistMapping ?? null),
    "Generated Coupon File": attachmentField(couponArtifact),
    "Generated Whitelist File": attachmentField(whitelistArtifact),
    "Generated Files JSON": JSON.stringify(input.artifacts),
    "OA Handoff JSON": JSON.stringify(input.oaHandoff ?? null),
    "Validation Issues JSON": JSON.stringify(input.validationIssues),
    "Processed Message IDs JSON": JSON.stringify(input.processedMessageIds),
    "Failure Reason": input.failureReason ?? "",
  };
}

function parseRecord(record: BaseRecord): CouponExcelPilotDraft {
  const status = scalar(record.fields.Status);
  if (!couponExcelPilotStatuses.includes(status as CouponExcelPilotStatus)) {
    throw new Error("Excel pilot draft has an unsupported status");
  }
  const candidateInput = parseJson<Record<string, unknown>>(
    record.fields["Candidate Input JSON"],
    {},
  );
  const input = parseJson<CouponPilotInput | null>(
    record.fields["Input JSON"],
    null,
  );
  return {
    recordId: record.record_id,
    pilotId: String(record.fields["Pilot ID"] ?? ""),
    ownerOpenId: String(record.fields["Owner Open ID"] ?? ""),
    status: status as CouponExcelPilotStatus,
    revision: Number(record.fields.Revision ?? 0),
    schemaVersion: String(record.fields["Schema Version"] ?? ""),
    candidateInput: Object.keys(candidateInput).length
      ? candidateInput
      : undefined,
    input: input ?? undefined,
    sourceWhitelist: parseJson<CouponExcelPilotSourceFile | undefined>(
      record.fields["Source Whitelist JSON"],
      undefined,
    ),
    whitelistMapping: parseJson<CouponExcelPilotMapping | undefined>(
      record.fields["Whitelist Mapping JSON"],
      undefined,
    ),
    artifacts: parseJson<CouponExcelPilotArtifact[]>(
      record.fields["Generated Files JSON"],
      [],
    ),
    oaHandoff: parseJson<CouponExcelPilotOaHandoff | undefined>(
      record.fields["OA Handoff JSON"],
      undefined,
    ),
    validationIssues: parseJson<string[]>(
      record.fields["Validation Issues JSON"],
      [],
    ),
    processedMessageIds: parseJson<string[]>(
      record.fields["Processed Message IDs JSON"],
      [],
    ),
    failureReason: scalar(record.fields["Failure Reason"]) || undefined,
    createdAt: iso(record.created_time),
    updatedAt: iso(record.last_modified_time),
  };
}

export async function createCouponExcelPilotDraft(input: {
  ownerOpenId: string;
  schemaVersion: string;
}): Promise<CouponExcelPilotDraft> {
  const tableId = getCouponExcelPilotTableId();
  const appToken = process.env.FEISHU_BASE_APP_TOKEN;
  if (!appToken) throw new Error("Feishu Base POC is not configured");
  const value = {
    pilotId: `CEP-${randomUUID()}`,
    ownerOpenId: input.ownerOpenId,
    status: "Collecting" as const,
    revision: 1,
    schemaVersion: input.schemaVersion,
    artifacts: [],
    validationIssues: [],
    processedMessageIds: [],
  };
  const result = await request(
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
    { method: "POST", body: JSON.stringify({ fields: recordFields(value) }) },
  );
  if (!result.data?.record) {
    throw new Error("Feishu Base did not return an Excel pilot draft");
  }
  return parseRecord(result.data.record);
}

export async function getCouponExcelPilotDraft(
  recordId: string,
): Promise<CouponExcelPilotDraft> {
  const tableId = getCouponExcelPilotTableId();
  const appToken = process.env.FEISHU_BASE_APP_TOKEN;
  if (!appToken) throw new Error("Feishu Base POC is not configured");
  const result = await request(
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
  );
  if (!result.data?.record) throw new Error("Excel pilot draft was not found");
  return parseRecord(result.data.record);
}

export async function listActiveCouponExcelPilotDrafts(
  ownerOpenId: string,
): Promise<CouponExcelPilotDraft[]> {
  const tableId = getCouponExcelPilotTableId();
  const appToken = process.env.FEISHU_BASE_APP_TOKEN;
  if (!appToken) throw new Error("Feishu Base POC is not configured");
  const result = await request(
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=100`,
  );
  return (result.data?.items ?? [])
    .map(parseRecord)
    .filter(
      (draft) =>
        draft.ownerOpenId === ownerOpenId &&
        !["GeneratedConfirmed", "Canceled"].includes(draft.status),
    )
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export async function updateCouponExcelPilotDraft(
  draft: CouponExcelPilotDraft,
  updates: Partial<
    Omit<
      CouponExcelPilotDraft,
      "recordId" | "pilotId" | "ownerOpenId" | "createdAt" | "updatedAt"
    >
  >,
  expectedRevision = draft.revision,
): Promise<CouponExcelPilotDraft> {
  if (draft.revision !== expectedRevision) {
    throw new Error(
      "Excel pilot draft version changed; reopen the latest card",
    );
  }
  if (["GeneratedConfirmed", "Canceled"].includes(draft.status)) {
    throw new Error(
      "Confirmed or canceled Excel pilot drafts cannot be changed",
    );
  }
  const tableId = getCouponExcelPilotTableId();
  const appToken = process.env.FEISHU_BASE_APP_TOKEN;
  if (!appToken) throw new Error("Feishu Base POC is not configured");
  const next = {
    ...draft,
    ...updates,
    revision: draft.revision + 1,
  };
  const result = await request(
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${draft.recordId}`,
    {
      method: "PUT",
      body: JSON.stringify({ fields: recordFields(next) }),
    },
  );
  if (!result.data?.record) {
    throw new Error("Feishu Base did not return an updated Excel pilot draft");
  }
  return parseRecord(result.data.record);
}

export function sourceFileMetadata(input: {
  messageId: string;
  fileKey: string;
  fileName: string;
  bytes: Uint8Array;
  candidates?: CouponExcelPilotSourceFile["candidates"];
}): CouponExcelPilotSourceFile {
  return {
    messageId: input.messageId,
    fileKey: input.fileKey,
    fileName: input.fileName,
    bytes: input.bytes.byteLength,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
    candidates: input.candidates,
  };
}
