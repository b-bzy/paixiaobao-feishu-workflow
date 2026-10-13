import { describe, expect, it } from "vitest";
import { classifyE2eFailure } from "./error-classification";

describe("coupon three-source E2E error classification", () => {
  it.each([
    ["三源提报只接受 .xlsx 源文件", "FILE_FORMAT_UNSUPPORTED"],
    ["工作簿没有可读取的 Sheet", "WORKBOOK_EMPTY"],
    ["当前三源提报版本已变化，请使用最新卡片", "STALE_REVISION"],
    ["只有当前三源提报创建人可以继续操作", "OWNER_FORBIDDEN"],
    ["SKU 是数值格式，无法确认前导零", "SKU_PRECISION_LOST"],
  ])("maps %s to %s", (message, code) => {
    expect(classifyE2eFailure(new Error(message))).toMatchObject({ code });
  });

  it("redacts unknown error messages", () => {
    const result = classifyE2eFailure(
      new Error("token=secret SKU=10081516646822 raw provider body"),
    );
    expect(result.code).toBe("UNCLASSIFIED_FAILURE");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("10081516646822");
  });
});
