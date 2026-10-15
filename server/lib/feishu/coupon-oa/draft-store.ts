import { randomUUID } from "node:crypto";
import { getTenantAccessToken } from "../client";
import type { CouponOaDraftValues } from "./approval-schema";
import {
  assertCouponOaDraftStoreConfigured,
  getCouponOaDraftTableId,
} from "./config";

export const couponOaDraftStatuses = [
  "Draft",
  "Validated",
  "Confirmed",
  "Submitting",
  "Submitted",
  "CreatedNeedsReview",
  "SubmissionUnknown",
  "Failed",
  "Canceled",
] as const;
export type CouponOaDraftStatus = (typeof couponOaDraftStatuses)[number];

const terminalCouponOaDraftStatuses: readonly CouponOaDraftStatus[] = [
  "Submitted",
  "CreatedNeedsReview",
  "SubmissionUnknown",
  "Canceled",
];

/** Schema version stamped on OA drafts created by the three-source handoff. */
export const COUPON_OA_THREE_SOURCE_PILOT_SCHEMA_VERSION =
  "coupon-three-source-pilot-v1";

export interface CouponOaAttachment {
  artifactId?: string;
  order?: number;
  role:
    | "calcImage"
    | "couponTable"
    | "productWhitelist"
    | "productBlacklist"
    | "addItems"
    | "removeItems";
  fileName: string;
  fileCode: string;
  /** Frozen Drive file token; present on three-source handoff attachments. */
  fileToken?: string;
  sha256: string;
  bytes: number;
  contentType?: "image/png" | "image/jpeg";
}

export interface CouponOaDraft {
  recordId: string;
  draftId: string;
  ownerOpenId: string;
  status: CouponOaDraftStatus;
  schemaVersion: string;
  definitionHash?: string;
  values: CouponOaDraftValues;
  attachments: CouponOaAttachment[];
  validationIssues: string[];
  confirmedAt?: string;
  approvalInstanceCode?: string;
  approvalInstanceLink?: string;
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

function toIso(value: unknown): string | undefined {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString()
    : undefined;
}

async function request(
  path: string,
  init: RequestInit = {},
): Promise<BaseRecord> {
  assertCouponOaDraftStoreConfigured();
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
  const record = result.data?.record;
  if (!response.ok || result.code !== 0 || !record) {
    throw new Error(`Feishu coupon draft request failed: ${result.msg}`);
  }
  return record;
}

function fields(
  input: Omit<CouponOaDraft, "recordId" | "createdAt" | "updatedAt">,
) {
  return {
    "Draft ID": input.draftId,
    "Owner Open ID": input.ownerOpenId,
    Status: input.status,
    "Schema Version": input.schemaVersion,
    "Definition Hash": input.definitionHash ?? "",
    "Fields JSON": JSON.stringify(input.values),
    "Attachments JSON": JSON.stringify(input.attachments),
    "Validation Issues JSON": JSON.stringify(input.validationIssues),
    "Confirmed At": input.confirmedAt ? Date.parse(input.confirmedAt) : null,
    "Approval Instance Code": input.approvalInstanceCode ?? "",
    "Approval Instance Link": input.approvalInstanceLink ?? "",
    "Failure Reason": input.failureReason ?? "",
  };
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseRecord(record: BaseRecord): CouponOaDraft {
  const status = scalar(record.fields.Status);
  if (!couponOaDraftStatuses.includes(status as CouponOaDraftStatus)) {
    throw new Error("Coupon OA draft has an unsupported status");
  }
  const values = parseJson<CouponOaDraftValues | null>(
    record.fields["Fields JSON"],
    null,
  );
  if (!values) throw new Error("Coupon OA draft is missing field values");
  return {
    recordId: record.record_id,
    draftId: String(record.fields["Draft ID"] ?? ""),
    ownerOpenId: String(record.fields["Owner Open ID"] ?? ""),
    status: status as CouponOaDraftStatus,
    schemaVersion: String(record.fields["Schema Version"] ?? ""),
    definitionHash: scalar(record.fields["Definition Hash"]) || undefined,
    values,
    attachments: parseJson<CouponOaAttachment[]>(
      record.fields["Attachments JSON"],
      [],
    ),
    validationIssues: parseJson<string[]>(
      record.fields["Validation Issues JSON"],
      [],
    ),
    confirmedAt: toIso(record.fields["Confirmed At"]),
    approvalInstanceCode:
      scalar(record.fields["Approval Instance Code"]) || undefined,
    approvalInstanceLink:
      scalar(record.fields["Approval Instance Link"]) || undefined,
    failureReason: scalar(record.fields["Failure Reason"]) || undefined,
    createdAt: toIso(record.created_time),
    updatedAt: toIso(record.last_modified_time),
  };
}

export async function createCouponOaDraft(input: {
  ownerOpenId: string;
  schemaVersion: string;
  draftId?: string;
  values: CouponOaDraftValues;
  attachments?: CouponOaAttachment[];
  validationIssues?: string[];
}): Promise<CouponOaDraft> {
  const tableId = getCouponOaDraftTableId();
  const draft = {
    draftId: input.draftId ?? `COA-${randomUUID()}`,
    ownerOpenId: input.ownerOpenId,
    status: "Draft" as const,
    schemaVersion: input.schemaVersion,
    values: input.values,
    attachments: input.attachments ?? [],
    validationIssues: input.validationIssues ?? [],
  };
  const record = await request(
    `/bitable/v1/apps/${process.env.FEISHU_BASE_APP_TOKEN}/tables/${tableId}/records`,
    {
      method: "POST",
      body: JSON.stringify({ fields: fields(draft) }),
    },
  );
  return parseRecord(record);
}

export async function getCouponOaDraft(
  recordId: string,
): Promise<CouponOaDraft> {
  const tableId = getCouponOaDraftTableId();
  const record = await request(
    `/bitable/v1/apps/${process.env.FEISHU_BASE_APP_TOKEN}/tables/${tableId}/records/${recordId}`,
  );
  return parseRecord(record);
}

export async function listActiveCouponOaDrafts(
  ownerOpenId: string,
): Promise<CouponOaDraft[]> {
  assertCouponOaDraftStoreConfigured();
  const tableId = getCouponOaDraftTableId();
  const appToken = process.env.FEISHU_BASE_APP_TOKEN;
  const token = await getTenantAccessToken();
  const response = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const result = (await response.json()) as BaseResponse;
  if (!response.ok || result.code !== 0) {
    throw new Error(`Feishu coupon draft request failed: ${result.msg}`);
  }
  return (result.data?.items ?? [])
    .map(parseRecord)
    .filter(
      (draft) =>
        draft.ownerOpenId === ownerOpenId &&
        [
          "Draft",
          "Validated",
          "Confirmed",
          "Submitting",
          "SubmissionUnknown",
          "Failed",
        ].includes(draft.status),
    )
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export async function saveCouponOaDraft(input: {
  ownerOpenId: string;
  schemaVersion: string;
  values: CouponOaDraftValues;
}): Promise<CouponOaDraft> {
  const existing = (await listActiveCouponOaDrafts(input.ownerOpenId))[0];
  if (!existing) return createCouponOaDraft(input);
  if (!["Draft", "Validated", "Failed"].includes(existing.status)) {
    throw new Error(
      "An existing coupon OA draft is awaiting confirmation or reconciliation",
    );
  }

  return updateCouponOaDraft(existing, {
    status: "Draft",
    schemaVersion: input.schemaVersion,
    values: input.values,
    attachments: [],
    validationIssues: [],
    definitionHash: undefined,
    confirmedAt: undefined,
    approvalInstanceCode: undefined,
    approvalInstanceLink: undefined,
    failureReason: undefined,
  });
}

export async function updateCouponOaDraft(
  draft: CouponOaDraft,
  updates: Partial<
    Omit<
      CouponOaDraft,
      "recordId" | "draftId" | "ownerOpenId" | "createdAt" | "updatedAt"
    >
  >,
): Promise<CouponOaDraft> {
  if (terminalCouponOaDraftStatuses.includes(draft.status)) {
    throw new Error(
      "Submitted, review-required, submission-unknown, or canceled coupon OA drafts cannot be changed",
    );
  }
  // Base has no compare-and-swap, so re-read the stored record before every
  // write: a status drift means another handler moved the draft concurrently
  // and this stale snapshot must not overwrite it.
  const stored = await getCouponOaDraft(draft.recordId);
  if (terminalCouponOaDraftStatuses.includes(stored.status)) {
    throw new Error(
      `Coupon OA draft is already ${stored.status}; reload it before changing`,
    );
  }
  if (stored.status !== draft.status) {
    throw new Error(
      `Coupon OA draft status changed concurrently (${draft.status} → ${stored.status}); reload it before changing`,
    );
  }
  const tableId = getCouponOaDraftTableId();
  const next = { ...draft, ...updates };
  const record = await request(
    `/bitable/v1/apps/${process.env.FEISHU_BASE_APP_TOKEN}/tables/${tableId}/records/${draft.recordId}`,
    { method: "PUT", body: JSON.stringify({ fields: fields(next) }) },
  );
  const persisted = parseRecord(record);
  if (updates.status && persisted.status !== updates.status) {
    throw new Error(
      `Coupon OA draft write was not persisted as ${updates.status}`,
    );
  }
  return persisted;
}

/**
 * Persists a submission outcome from a FRESH stored snapshot. If a concurrent
 * attempt already settled the draft into a terminal state, that outcome wins
 * and is returned untouched — reconciliation must never overwrite it.
 */
export async function persistCouponOaSubmissionOutcome(
  draft: CouponOaDraft,
  updates: Partial<
    Omit<
      CouponOaDraft,
      "recordId" | "draftId" | "ownerOpenId" | "createdAt" | "updatedAt"
    >
  >,
): Promise<CouponOaDraft> {
  const stored = await getCouponOaDraft(draft.recordId);
  if (terminalCouponOaDraftStatuses.includes(stored.status)) {
    return stored;
  }
  return updateCouponOaDraft(stored, updates);
}
