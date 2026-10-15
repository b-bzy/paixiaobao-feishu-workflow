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
