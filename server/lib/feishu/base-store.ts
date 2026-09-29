import { randomUUID } from "node:crypto";
import { getTenantAccessToken } from "./client";
import {
  type AdminWorkflowTemplate,
  type ApprovalLogEntry,
  adminWorkflowTemplateSchema,
  type ExpenseSubmission,
  type ExpenseTemplateDraft,
  type WorkflowInstance,
  type WorkflowTemplate,
  workflowTemplateSchema,
} from "./expense-poc";

interface BaseRecord {
  record_id: string;
  created_time?: number;
  last_modified_time?: number;
  fields: Record<string, unknown>;
}
interface BaseResponse {
  code: number;
  msg: string;
  data?: { items?: BaseRecord[]; record?: BaseRecord };
}

type TemplateStatus = AdminWorkflowTemplate["status"];

function config() {
  const appToken = process.env.FEISHU_BASE_APP_TOKEN;
  const templateTableId = process.env.FEISHU_TEMPLATE_TABLE_ID;
  const instanceTableId = process.env.FEISHU_INSTANCE_TABLE_ID;
  if (!appToken || !templateTableId || !instanceTableId) {
    throw new Error("Feishu Base POC is not configured");
  }
  return { appToken, templateTableId, instanceTableId };
}

async function request(
  path: string,
  init: RequestInit = {},
): Promise<BaseResponse> {
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
    throw new Error(`Feishu Base request failed: ${result.msg}`);
  }
  return result;
}

const scalar = (value: unknown) =>
  Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");

const toIsoTime = (value: unknown): string | undefined => {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return undefined;
  return new Date(timestamp).toISOString();
};

function parseApprovalLog(value: unknown): ApprovalLogEntry[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      if (
        (item.decision !== "Approved" && item.decision !== "Rejected") ||
        typeof item.operatorOpenId !== "string" ||
        typeof item.decidedAt !== "string"
      ) {
        return [];
      }
      return [
        {
          decision: item.decision,
          operatorOpenId: item.operatorOpenId,
          decidedAt: item.decidedAt,
        },
      ];
    });
  } catch {
    return [];
  }
}

function templateFields(record: BaseRecord): Record<string, unknown> {
  return {
    recordId: record.record_id,
    templateId: record.fields["Template ID"],
    name: record.fields.Name,
    status: scalar(record.fields.Status),
    version: Number(record.fields.Version),
    defaultApproverOpenId: record.fields["Default Approver Open ID"],
    fields: JSON.parse(String(record.fields["Fields JSON"] ?? "[]")),
    createdAt: toIsoTime(record.created_time),
    updatedAt: toIsoTime(record.last_modified_time),
  };
}

function toAdminTemplate(record: BaseRecord): AdminWorkflowTemplate | null {
  if (String(record.fields["Template ID"] ?? "") !== "expense") return null;
  const status = scalar(record.fields.Status);
  if (status !== "Draft" && status !== "Published") return null;
  return adminWorkflowTemplateSchema.parse(templateFields(record));
}

function _toTemplate(record: BaseRecord): WorkflowTemplate | null {
  const template = toAdminTemplate(record);
  if (!template || template.status !== "Published") return null;
  return workflowTemplateSchema.parse(template);
}

function toWorkflowInstance(record: BaseRecord): WorkflowInstance {
  const fields = record.fields;
  const status = scalar(fields.Status);
  if (!["Pending", "Approved", "Rejected"].includes(status)) {
    throw new Error(`Unsupported workflow instance status: ${status}`);
  }
  return {
    recordId: record.record_id,
    instanceId: String(fields["Instance ID"] ?? ""),
    templateId: String(fields["Template ID"] ?? ""),
    templateVersion: Number(fields["Template Version"]),
    templateName: String(fields["Template Name"] ?? ""),
    submitterOpenId: String(fields["Submitter Open ID"] ?? ""),
    approverOpenId: String(fields["Approver Open ID"] ?? ""),
    status: status as WorkflowInstance["status"],
    data: {
      title: String(fields.Title ?? ""),
      amount: Number(fields.Amount),
      category: scalar(fields.Category),
      description: String(fields.Description ?? ""),
    },
    submittedAt: toIsoTime(fields["Submitted At"] ?? record.created_time),
    decidedAt: toIsoTime(fields["Decision At"]),
    approvalLog: parseApprovalLog(fields["Approval Log JSON"]),
  };
}

async function listRecords(tableId: string): Promise<BaseRecord[]> {
  const { appToken } = config();
  const result = await request(
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=100`,
  );
  return result.data?.items ?? [];
}

async function getRecord(
  tableId: string,
  recordId: string,
): Promise<BaseRecord> {
  const { appToken } = config();
  const result = await request(
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
  );
  const record = result.data?.record;
  if (!record) throw new Error("Feishu Base record was not found");
  return record;
}

async function updateRecord(
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>,
): Promise<BaseRecord> {
  const { appToken } = config();
  const result = await request(
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
    {
      method: "PUT",
      body: JSON.stringify({ fields }),
    },
  );
  const record = result.data?.record;
  if (!record) throw new Error("Feishu Base did not return an updated record");
  return record;
}

export async function listExpenseTemplates(): Promise<AdminWorkflowTemplate[]> {
  const { templateTableId } = config();
  return (await listRecords(templateTableId))
    .map(toAdminTemplate)
    .filter((item): item is AdminWorkflowTemplate => item !== null)
    .sort((a, b) => b.version - a.version);
}

export async function getPublishedExpenseTemplate(): Promise<WorkflowTemplate> {
  const template = (await listExpenseTemplates()).find(
    (item) => item.status === "Published",
  );
  if (!template) throw new Error("No published expense template found");
  return workflowTemplateSchema.parse(template);
}

export async function getTemplateByRecordId(
  recordId: string,
): Promise<WorkflowTemplate> {
  const template = await getPublishedExpenseTemplate();
  if (template.recordId !== recordId) {
    throw new Error("Template changed; reopen the expense form");
  }
  return template;
}

function templateRecordFields(
  input: Omit<ExpenseTemplateDraft, "recordId">,
  version: number,
  status: TemplateStatus,
): Record<string, unknown> {
  return {
    "Template ID": "expense",
    Name: input.name,
    Status: status,
    Version: version,
    "Default Approver Open ID": input.defaultApproverOpenId,
    "Fields JSON": JSON.stringify(input.fields),
  };
}

export async function saveExpenseTemplateDraft(
  input: ExpenseTemplateDraft,
): Promise<AdminWorkflowTemplate> {
  const { templateTableId, appToken } = config();
  const { recordId, ...draft } = input;

  if (recordId) {
    const existing = toAdminTemplate(
      await getRecord(templateTableId, recordId),
    );
    if (!existing) throw new Error("Expense template draft was not found");
    if (existing.status === "Published") {
      throw new Error(
        "Published templates cannot be edited; create a new draft",
      );
    }
    return adminWorkflowTemplateSchema.parse(
      templateFields(
        await updateRecord(
          templateTableId,
          recordId,
          templateRecordFields(draft, existing.version, "Draft"),
        ),
      ),
    );
  }

  const templates = await listExpenseTemplates();
  const nextVersion = Math.max(0, ...templates.map((item) => item.version)) + 1;
  const result = await request(
    `/bitable/v1/apps/${appToken}/tables/${templateTableId}/records`,
    {
      method: "POST",
      body: JSON.stringify({
        fields: templateRecordFields(draft, nextVersion, "Draft"),
      }),
    },
  );
  const record = result.data?.record;
  if (!record) throw new Error("Feishu Base did not return a draft record");
  return adminWorkflowTemplateSchema.parse(templateFields(record));
}

export async function publishExpenseTemplate(
  recordId: string,
): Promise<WorkflowTemplate> {
  const { templateTableId } = config();
  const candidate = toAdminTemplate(await getRecord(templateTableId, recordId));
  if (!candidate) throw new Error("Expense template draft was not found");
  if (candidate.status === "Published")
    return workflowTemplateSchema.parse(candidate);

  const publishedRecord = await updateRecord(templateTableId, recordId, {
    Status: "Published",
  });
  const published = workflowTemplateSchema.parse(
    templateFields(publishedRecord),
  );

  const olderPublished = (await listExpenseTemplates()).filter(
    (template) =>
      template.recordId !== recordId &&
      template.status === "Published" &&
      template.version < published.version,
  );
  await Promise.all(
    olderPublished.map((template) =>
      updateRecord(templateTableId, template.recordId, { Status: "Draft" }),
    ),
  );

  return published;
}

export async function createWorkflowInstance(params: {
  template: WorkflowTemplate;
  submitterOpenId: string;
  data: ExpenseSubmission;
}): Promise<WorkflowInstance> {
  const { appToken, instanceTableId } = config();
  const value = {
    instanceId: `EXP-${randomUUID().slice(0, 8).toUpperCase()}`,
    templateId: params.template.templateId,
    templateVersion: params.template.version,
    templateName: params.template.name,
    submitterOpenId: params.submitterOpenId,
    approverOpenId: params.template.defaultApproverOpenId,
    status: "Pending" as const,
    data: params.data,
  };
  const result = await request(
    `/bitable/v1/apps/${appToken}/tables/${instanceTableId}/records`,
    {
      method: "POST",
      body: JSON.stringify({
        fields: {
          "Instance ID": value.instanceId,
          "Template ID": value.templateId,
          "Template Version": value.templateVersion,
          "Template Name": value.templateName,
          "Submitter Open ID": value.submitterOpenId,
          "Approver Open ID": value.approverOpenId,
          Status: value.status,
          Title: value.data.title,
          Amount: value.data.amount,
          Category: value.data.category,
          Description: value.data.description,
          "Submitted At": Date.now(),
          "Approval Log JSON": "[]",
        },
      }),
    },
  );
  const recordId = result.data?.record?.record_id;
  if (!recordId) throw new Error("Base did not return an instance record ID");
  return { recordId, ...value, submittedAt: new Date().toISOString() };
}

export async function listWorkflowInstances(): Promise<WorkflowInstance[]> {
  const { instanceTableId } = config();
  return (await listRecords(instanceTableId))
    .map(toWorkflowInstance)
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));
}

export async function getWorkflowInstance(
  recordId: string,
): Promise<WorkflowInstance> {
  const { instanceTableId } = config();
  return toWorkflowInstance(await getRecord(instanceTableId, recordId));
}

export async function decideWorkflowInstance(params: {
  recordId: string;
  decision: "Approved" | "Rejected";
  operatorOpenId: string;
}): Promise<WorkflowInstance> {
  const instance = await getWorkflowInstance(params.recordId);
  if (instance.status !== "Pending") {
    throw new Error(`Workflow instance is already ${instance.status}`);
  }
  if (instance.approverOpenId !== params.operatorOpenId) {
    throw new Error("Only the configured approver can decide this instance");
  }
  const { instanceTableId } = config();
  const decidedAt = new Date().toISOString();
  await updateRecord(instanceTableId, params.recordId, {
    Status: params.decision,
    "Decision At": Date.parse(decidedAt),
    "Approval Log JSON": JSON.stringify([
      {
        decision: params.decision,
        operatorOpenId: params.operatorOpenId,
        decidedAt,
      },
    ]),
  });
  return {
    ...instance,
    status: params.decision,
    decidedAt,
    approvalLog: [
      {
        decision: params.decision,
        operatorOpenId: params.operatorOpenId,
        decidedAt,
      },
    ],
  };
}
