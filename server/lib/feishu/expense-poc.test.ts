import { describe, expect, it } from "vitest";
import {
  buildExpenseApprovalCard,
  buildExpenseFormCard,
  buildExpenseResultCard,
  parseExpenseFormValue,
} from "./expense-poc";
import { testInstance, testTemplate } from "./test-fixtures";

describe("admin-configured Feishu expense POC", () => {
  it("renders administrator fields and template version", () => {
    const json = JSON.stringify(buildExpenseFormCard(testTemplate));
    expect(json).toContain("模板 v3");
    expect(json).toContain("交通");
    expect(json).toContain("expense_submit:rec-template:3");
  });

  it("parses employee form values", () => {
    expect(
      parseExpenseFormValue({
        title: "客户拜访",
        amount: "150.50",
        category: "交通",
        description: "打车",
      }),
    ).toEqual({
      title: "客户拜访",
      amount: 150.5,
      category: "交通",
      description: "打车",
    });
  });

  it("embeds the instance in approval and result cards", () => {
    expect(JSON.stringify(buildExpenseApprovalCard(testInstance))).toContain(
      "rec-instance",
    );
    expect(
      buildExpenseResultCard({ ...testInstance, status: "Approved" }).header,
    ).toMatchObject({ template: "green" });
  });
});
