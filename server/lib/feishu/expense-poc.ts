import { z } from "zod";

export const templateFieldSchema = z.discriminatedUnion("type", [
  z.object({
    key: z.string(),
    label: z.string(),
    type: z.literal("text"),
    required: z.boolean(),
    multiline: z.boolean(),
  }),
  z.object({
    key: z.string(),
    label: z.string(),
    type: z.literal("number"),
    required: z.boolean(),
  }),
  z.object({
    key: z.string(),
    label: z.string(),
    type: z.literal("select"),
    required: z.boolean(),
    options: z.array(z.string()).min(1),
  }),
]);

const templateBaseSchema = z.object({
  recordId: z.string().min(1),
  templateId: z.literal("expense"),
  name: z.string().min(1),
  version: z.number().int().positive(),
  defaultApproverOpenId: z.string().min(1),
  fields: z.array(templateFieldSchema).min(1),
});

export const workflowTemplateSchema = templateBaseSchema.extend({
  status: z.literal("Published"),
});
export type WorkflowTemplate = z.infer<typeof workflowTemplateSchema>;

export const adminWorkflowTemplateSchema = templateBaseSchema.extend({
  status: z.enum(["Draft", "Published"]),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
});
export type AdminWorkflowTemplate = z.infer<typeof adminWorkflowTemplateSchema>;

const supportedFieldKeys = [
  "title",
  "amount",
  "category",
  "description",
] as const;
export type SupportedExpenseFieldKey = (typeof supportedFieldKeys)[number];

export const expenseTemplateDraftSchema = z
  .object({
    recordId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(120),
    defaultApproverOpenId: z.string().trim().min(1),
    fields: z.array(templateFieldSchema).length(supportedFieldKeys.length),
  })
  .superRefine((value, ctx) => {
    const fieldsByKey = new Map(
      value.fields.map((field) => [field.key, field]),
    );

    for (const key of supportedFieldKeys) {
      if (!fieldsByKey.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["fields"],
          message: `缺少机器人支持的 ${key} 字段`,
        });
      }
    }
    if (fieldsByKey.size !== value.fields.length) {
      ctx.addIssue({
        code: "custom",
        path: ["fields"],
        message: "字段键不能重复",
      });
    }

    const title = fieldsByKey.get("title");
    const amount = fieldsByKey.get("amount");
    const category = fieldsByKey.get("category");
    const description = fieldsByKey.get("description");
    if (title?.type !== "text" || amount?.type !== "number") {
      ctx.addIssue({
        code: "custom",
        path: ["fields"],
        message: "报销事由必须为文本，金额必须为数值",
      });
    }
    if (category?.type !== "select") {
      ctx.addIssue({
        code: "custom",
        path: ["fields"],
        message: "报销类别必须为下拉选项",
      });
    }
    if (description?.type !== "text") {
      ctx.addIssue({
        code: "custom",
        path: ["fields"],
        message: "报销说明必须为文本",
      });
    }
  });
export type ExpenseTemplateDraft = z.infer<typeof expenseTemplateDraftSchema>;

export const expenseSubmissionSchema = z.object({
  title: z.string().min(1),
  amount: z.number().positive(),
  category: z.string().min(1),
  description: z.string().min(1),
});
export type ExpenseSubmission = z.infer<typeof expenseSubmissionSchema>;

export interface ApprovalLogEntry {
  decision: "Approved" | "Rejected";
  operatorOpenId: string;
  decidedAt: string;
}

export interface WorkflowInstance {
  recordId: string;
  instanceId: string;
  templateId: string;
  templateVersion: number;
  templateName: string;
  submitterOpenId: string;
  approverOpenId: string;
  status: "Pending" | "Approved" | "Rejected";
  data: ExpenseSubmission;
  submittedAt?: string;
  decidedAt?: string;
  approvalLog?: ApprovalLogEntry[];
}

export interface FeishuCard {
  schema: "2.0";
  config: { update_multi: true; width_mode: "default" };
  header: Record<string, unknown>;
  body: {
    direction: "vertical";
    padding: string;
    vertical_spacing: string;
    elements: Array<Record<string, unknown>>;
  };
}

const plainText = (content: string) => ({ tag: "plain_text", content });

function baseCard(
  title: string,
  subtitle: string,
  template: string,
  status: string,
  elements: Array<Record<string, unknown>>,
): FeishuCard {
  const color =
    status === "已通过" ? "green" : status === "已拒绝" ? "red" : "yellow";
  return {
    schema: "2.0",
    config: { update_multi: true, width_mode: "default" },
    header: {
      title: plainText(title),
      subtitle: plainText(subtitle),
      template,
      icon: { tag: "standard_icon", token: "approval_colorful" },
      text_tag_list: [{ tag: "text_tag", text: plainText(status), color }],
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 20px 12px",
      vertical_spacing: "12px",
      elements,
    },
  };
}

function buildFormField(
  field: WorkflowTemplate["fields"][number],
): Record<string, unknown> {
  if (field.type === "select") {
    return {
      tag: "select_static",
      name: field.key,
      required: field.required,
      placeholder: plainText(`请选择${field.label}`),
      width: "fill",
      options: field.options.map((option) => ({
        text: plainText(option),
        value: option,
      })),
    };
  }
  return {
    tag: "input",
    name: field.key,
    required: field.required,
    label: plainText(`${field.label}：`),
    placeholder: plainText(`请输入${field.label}`),
    input_type:
      field.type === "text" && field.multiline ? "multiline_text" : "text",
    ...(field.type === "text" && field.multiline ? { rows: 3 } : {}),
    width: "fill",
  };
}

export function buildExpenseFormCard(template: WorkflowTemplate): FeishuCard {
  return baseCard(
    template.name,
    `由管理员发布 · 模板 v${template.version}`,
    "blue",
    "填写中",
    [
      {
        tag: "column_set",
        flex_mode: "none",
        background_style: "blue-50",
        margin: "0px 0px 12px 0px",
        columns: [
          {
            tag: "column",
            width: "weighted",
            weight: 1,
            padding: "12px",
            elements: [
              {
                tag: "markdown",
                content: "**请填写报销信息**\n提交后将按照管理员配置进入审批。",
              },
            ],
          },
        ],
      },
      {
        tag: "form",
        name: "expense_form",
        vertical_spacing: "12px",
        elements: [
          ...template.fields.map(buildFormField),
          {
            tag: "button",
            text: plainText("提交审批"),
            type: "primary_filled",
            width: "fill",
            form_action_type: "submit",
            name: `expense_submit:${template.recordId}:${template.version}`,
          },
        ],
      },
    ],
  );
}

function instanceDetails(instance: WorkflowInstance): Record<string, unknown> {
  return {
    tag: "column_set",
    flex_mode: "none",
    background_style: "grey-50",
    margin: "0px 0px 12px 0px",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        padding: "12px",
        elements: [
          {
            tag: "markdown",
            content: [
              `**单号：** ${instance.instanceId}`,
              `**事由：** ${instance.data.title}`,
              `**金额：** ¥${instance.data.amount.toFixed(2)}`,
              `**类别：** ${instance.data.category}`,
              `**说明：** ${instance.data.description}`,
              `**模板：** ${instance.templateName} v${instance.templateVersion}`,
            ].join("\n"),
          },
        ],
      },
    ],
  };
}

export function buildExpenseApprovalCard(
  instance: WorkflowInstance,
): FeishuCard {
  const value = {
    instanceRecordId: instance.recordId,
    instanceId: instance.instanceId,
  };
  return baseCard("报销审批", "管理员配置的审批流程", "orange", "待审批", [
    instanceDetails(instance),
    {
      tag: "column_set",
      flex_mode: "bisect",
      horizontal_spacing: "12px",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          padding: "12px",
          elements: [
            {
              tag: "button",
              text: plainText("通过"),
              type: "primary_filled",
              width: "fill",
              behaviors: [
                {
                  type: "callback",
                  value: { action: "expense_approve", ...value },
                },
              ],
            },
          ],
        },
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          elements: [
            {
              tag: "button",
              text: plainText("拒绝"),
              type: "danger",
              width: "fill",
              behaviors: [
                {
                  type: "callback",
                  value: { action: "expense_reject", ...value },
                },
              ],
            },
          ],
        },
      ],
    },
  ]);
}

export function buildExpenseResultCard(instance: WorkflowInstance): FeishuCard {
  const approved = instance.status === "Approved";
  return baseCard(
    approved ? "报销已通过" : "报销已拒绝",
    `流程实例 ${instance.instanceId}`,
    approved ? "green" : "red",
    approved ? "已通过" : "已拒绝",
    [instanceDetails(instance)],
  );
}

export function parseExpenseFormValue(
  value: Record<string, unknown>,
): ExpenseSubmission {
  return expenseSubmissionSchema.parse({
    title: value.title,
    amount:
      typeof value.amount === "number"
        ? value.amount
        : Number.parseFloat(String(value.amount ?? "")),
    category: value.category,
    description: value.description,
  });
}
