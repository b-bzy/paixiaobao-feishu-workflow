import { describe, expect, it } from "vitest";

import { getServiceStatus } from "./health";

describe("getServiceStatus", () => {
  it("identifies the independent aihuishou service", () => {
    expect(getServiceStatus()).toEqual({
      service: "aihuishou-feishu-workflow",
      status: "ok",
      scope: "expense-approval-poc",
    });
  });
});
