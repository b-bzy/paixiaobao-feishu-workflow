import type { WorkflowInstance, WorkflowTemplate } from "./expense-poc";

export const testTemplate: WorkflowTemplate = {
  recordId: "rec-template",
  templateId: "expense",
  name: "员工报销",
  status: "Published",
  version: 3,
  defaultApproverOpenId: "ou_approver",
  fields: [
    {
      key: "title",
      label: "报销事由",
      type: "text",
      required: true,
      multiline: false,
    },
    { key: "amount", label: "金额", type: "number", required: true },
    {
      key: "category",
      label: "类别",
      type: "select",
      required: true,
      options: ["交通", "餐饮", "其他"],
    },
    {
      key: "description",
      label: "说明",
      type: "text",
      required: true,
      multiline: true,
    },
  ],
};

export const testInstance: WorkflowInstance = {
  recordId: "rec-instance",
  instanceId: "EXP-12345678",
  templateId: "expense",
  templateVersion: 3,
  templateName: "员工报销",
  submitterOpenId: "ou_submitter",
  approverOpenId: "ou_approver",
  status: "Pending",
  data: {
    title: "客户拜访",
    amount: 150,
    category: "交通",
    description: "打车",
  },
};
