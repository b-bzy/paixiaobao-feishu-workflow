import { randomUUID } from "node:crypto";
import { getTenantAccessToken } from "../client";
import type { CouponOaDraftValues } from "./approval-schema";
import { getCouponOaDraftTableId } from "./config";

export const couponOaDraftStatuses = [
  "Draft",
  "Validated",
  "Confirmed",
  "Submitting",
  "Submitted",
  "CreatedNeedsReview",
  "Failed",
  "Canceled",
] as const;
export type CouponOaDraftStatus = (typeof couponOaDraftStatuses)[number];

export interface CouponOaAttachment {
  role:
    | "calcImage"
    | "couponTable"
    | "productWhitelist"
    | "productBlacklist"
    | "addItems"
    | "removeItems";
  fileName: string;
  fileCode: string;
  sha256: string;
  bytes: number;
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
  values: CouponOaDraftValues;
  attachments?: CouponOaAttachment[];
  validationIssues?: string[];
}): Promise<CouponOaDraft> {
  const tableId = getCouponOaDraftTableId();
  const draft = {
    draftId: `COA-${randomUUID()}`,
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
  const tableId = getCouponOaDraftTableId();
  const appToken = process.env.FEISHU_BASE_APP_TOKEN;
  if (!appToken) throw new Error("Feishu Base POC is not configured");
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
        ["Draft", "Validated", "Failed"].includes(draft.status),
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
  if (["Submitted", "CreatedNeedsReview", "Canceled"].includes(draft.status)) {
    throw new Error(
      "Submitted, review-required, or canceled coupon OA drafts cannot be changed",
    );
  }
  const tableId = getCouponOaDraftTableId();
  const next = { ...draft, ...updates };
  const record = await request(
    `/bitable/v1/apps/${process.env.FEISHU_BASE_APP_TOKEN}/tables/${tableId}/records/${draft.recordId}`,
    { method: "PUT", body: JSON.stringify({ fields: fields(next) }) },
  );
  return parseRecord(record);
}
