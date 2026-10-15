import { CouponThreeSourceError } from "../../../coupon-oa/three-source/errors";

export type CouponThreeSourceResourceKind =
  | "excel_xlsx"
  | "image"
  | "unsupported_spreadsheet"
  | "unsupported_file";

const spreadsheetExtensions = [".xls", ".csv", ".ods"];
const imageExtensions = [".png", ".jpg", ".jpeg"];

export function classifyCouponThreeSourceResource(input: {
  resourceType: "file" | "image";
  fileName?: string;
}): CouponThreeSourceResourceKind {
  if (input.resourceType === "image") return "image";
  const fileName = input.fileName?.trim().toLowerCase() ?? "";
  if (fileName.endsWith(".xlsx")) return "excel_xlsx";
  if (imageExtensions.some((extension) => fileName.endsWith(extension))) {
    return "image";
  }
  if (spreadsheetExtensions.some((extension) => fileName.endsWith(extension))) {
    return "unsupported_spreadsheet";
  }
  return "unsupported_file";
}

export function unsupportedCouponThreeSourceFileError(
  kind: Extract<
    CouponThreeSourceResourceKind,
    "unsupported_spreadsheet" | "unsupported_file"
  >,
): CouponThreeSourceError {
  return new CouponThreeSourceError({
    code: "FILE_TYPE_UNSUPPORTED",
    message: `Unsupported coupon three-source resource: ${kind}`,
    userMessage:
      kind === "unsupported_spreadsheet"
        ? "当前只支持 .xlsx 文件，请转换格式后重新上传。"
        : "当前只支持 .xlsx 配券材料或 PNG/JPEG 测算图片。",
  });
}
