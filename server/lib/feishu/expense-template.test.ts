import { describe, expect, it } from "vitest";
import { expenseTemplateDraftSchema } from "./expense-poc";

const validDraft = {
  name: "员工报销",
  defaultApproverOpenId: "ou_approver",
  fields: [
    {
      key: "title",
      label: "事由",
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
      options: ["交通"],
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

describe("expense template administrator draft", () => {
  it("accepts the four fields implemented by the Feishu card", () => {
    expect(expenseTemplateDraftSchema.parse(validDraft)).toMatchObject({
      name: "员工报销",
    });
  });

  it("rejects unsupported or missing form fields", () => {
    expect(
      expenseTemplateDraftSchema.safeParse({
        ...validDraft,
        fields: validDraft.fields.slice(0, 3),
      }).success,
    ).toBe(false);
  });
});
