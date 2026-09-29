import {
  listExpenseTemplates,
  listWorkflowInstances,
  publishExpenseTemplate,
  saveExpenseTemplateDraft,
} from "../feishu/base-store";
import type {
  AdminWorkflowTemplate,
  ExpenseTemplateDraft,
  WorkflowInstance,
} from "../feishu/expense-poc";

export interface AdminOverview {
  templates: {
    total: number;
    published: number;
    drafts: number;
  };
  instances: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };
  recentInstances: WorkflowInstance[];
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const [templates, instances] = await Promise.all([
    listExpenseTemplates(),
    listWorkflowInstances(),
  ]);
  return {
    templates: {
      total: templates.length,
      published: templates.filter((template) => template.status === "Published")
        .length,
      drafts: templates.filter((template) => template.status === "Draft")
        .length,
    },
    instances: {
      total: instances.length,
      pending: instances.filter((instance) => instance.status === "Pending")
        .length,
      approved: instances.filter((instance) => instance.status === "Approved")
        .length,
      rejected: instances.filter((instance) => instance.status === "Rejected")
        .length,
    },
    recentInstances: instances.slice(0, 6),
  };
}

export async function getAdminTemplates(): Promise<AdminWorkflowTemplate[]> {
  return listExpenseTemplates();
}

export async function saveAdminTemplate(
  input: ExpenseTemplateDraft,
): Promise<AdminWorkflowTemplate> {
  return saveExpenseTemplateDraft(input);
}

export async function publishAdminTemplate(recordId: string) {
  return publishExpenseTemplate(recordId);
}

export async function getAdminInstances(
  status?: WorkflowInstance["status"],
): Promise<WorkflowInstance[]> {
  const instances = await listWorkflowInstances();
  return status
    ? instances.filter((instance) => instance.status === status)
    : instances;
}
