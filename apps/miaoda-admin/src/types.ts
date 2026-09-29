export type TemplateStatus = "Draft" | "Published";
export type InstanceStatus = "Pending" | "Approved" | "Rejected";

export type ExpenseField =
  | {
      key: "title" | "description";
      label: string;
      type: "text";
      required: boolean;
      multiline: boolean;
    }
  | { key: "amount"; label: string; type: "number"; required: boolean }
  | {
      key: "category";
      label: string;
      type: "select";
      required: boolean;
      options: string[];
    };

export interface TemplateView {
  recordId: string;
  templateId: "expense";
  name: string;
  status: TemplateStatus;
  version: number;
  defaultApproverOpenId: string;
  fields: ExpenseField[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface InstanceView {
  recordId: string;
  instanceId: string;
  templateId: string;
  templateVersion: number;
  templateName: string;
  submitterOpenId: string;
  approverOpenId: string;
  status: InstanceStatus;
  data: {
    title: string;
    amount: number;
    category: string;
    description: string;
  };
  submittedAt?: string;
  decidedAt?: string;
  approvalLog?: Array<{
    decision: "Approved" | "Rejected";
    operatorOpenId: string;
    decidedAt: string;
  }>;
}

export interface AdminOverview {
  templates: { total: number; published: number; drafts: number };
  instances: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };
  recentInstances: InstanceView[];
}

export interface TemplateDraft {
  recordId?: string;
  name: string;
  defaultApproverOpenId: string;
  fields: ExpenseField[];
}
