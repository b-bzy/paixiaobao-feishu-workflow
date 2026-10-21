import { describe, expect, it } from "vitest";
import {
  CouponThreeSourceError,
  toCouponThreeSourceError,
  toCouponThreeSourceUserFailure,
} from "./errors";

describe("coupon three-source errors", () => {
  it("projects structured errors without exposing their cause", () => {
    const error = new CouponThreeSourceError({
      code: "WORKBOOK_UNREADABLE",
      message: "workbook load failed",
      userMessage: "工作簿无法读取，请检查文件后重新上传。",
      cause: new Error("ExcelJS central directory corrupt"),
    });

    expect(toCouponThreeSourceUserFailure(error)).toEqual({
      code: "WORKBOOK_UNREADABLE",
      message: "工作簿无法读取，请检查文件后重新上传。",
    });
  });

  it("maps known business validation errors to actionable Chinese copy", () => {
    expect(
      toCouponThreeSourceUserFailure(new Error("三源提报只接受 .xlsx 源文件")),
    ).toEqual({
      code: "FILE_TYPE_UNSUPPORTED",
      message: "当前只支持 .xlsx 文件，请转换格式后重新上传。",
    });
    expect(
      toCouponThreeSourceUserFailure(
        new Error("当前三源提报版本已变化，请使用最新卡片"),
      ),
    ).toEqual({
      code: "STALE_REVISION",
      message: "当前三源提报版本已变化，请使用最新卡片",
    });
    expect(
      toCouponThreeSourceUserFailure(
        new Error(
          "配券表字段不符合常规满减券规则：未识别到「申请总数量」的取值",
        ),
      ),
    ).toEqual({
      code: "VALIDATION_REQUIRED",
      message: "配券表字段不符合常规满减券规则：未识别到「申请总数量」的取值",
    });
    // 2026-10-19 事故：这两条可执行文案此前落入 UNEXPECTED_FAILURE 兜底。
    expect(
      toCouponThreeSourceUserFailure(
        new Error("请先上传配券表和商品白名单，再开始统一识别"),
      ),
    ).toEqual({
      code: "VALIDATION_REQUIRED",
      message: "请先上传配券表和商品白名单，再开始统一识别",
    });
    expect(
      toCouponThreeSourceUserFailure(
        new Error("请先确认无法唯一识别的材料角色"),
      ),
    ).toEqual({
      code: "VALIDATION_REQUIRED",
      message: "请先确认无法唯一识别的材料角色",
    });
    expect(
      toCouponThreeSourceUserFailure(
        new Error("三源提报源文件必须大于 0 且不超过 10 MB"),
      ),
    ).toEqual({
      code: "FILE_TOO_LARGE",
      message: "文件超过 10 MB，当前自动流程无法处理，请转人工提报。",
    });
    // 2026-10-21 bug-fix-6：名单数据问题是确定性业务拒绝,必须原样透出,
    // 不能落入「系统未完成本次处理…请稍后重试」的暂时性故障兜底。
    expect(
      toCouponThreeSourceUserFailure(
        new Error(
          "白名单存在未解决的数据问题：同一来源同时检测到多种标识列（SKU、商家 ID），请先选择本单使用的标识类型",
        ),
      ),
    ).toEqual({
      code: "VALIDATION_REQUIRED",
      message:
        "白名单存在未解决的数据问题：同一来源同时检测到多种标识列（SKU、商家 ID），请先选择本单使用的标识类型",
    });
    expect(
      toCouponThreeSourceUserFailure(
        new Error(
          "白名单存在未解决的数据问题：当前只支持 SKU 或商家 ID 名单，请先确认标识类型",
        ),
      ),
    ).toEqual({
      code: "VALIDATION_REQUIRED",
      message:
        "白名单存在未解决的数据问题：当前只支持 SKU 或商家 ID 名单，请先确认标识类型",
    });
  });

  it("never exposes unknown internal exception text", () => {
    const failure = toCouponThreeSourceUserFailure(
      new TypeError("Cannot read properties of undefined (reading 'sheets')"),
    );

    expect(failure).toEqual({
      code: "UNEXPECTED_FAILURE",
      message: "系统未完成本次处理，已保留当前材料，请稍后重试或联系处理。",
    });
    expect(failure.message).not.toContain("sheets");
  });

  it("keeps the original exception only as a cause", () => {
    const source = new Error("Feishu Drive file upload failed: secret detail");
    const normalized = toCouponThreeSourceError(source);

    expect(normalized.code).toBe("UNEXPECTED_FAILURE");
    expect(normalized.cause).toBe(source);
    expect(normalized.userMessage).not.toContain("secret detail");
  });
});
