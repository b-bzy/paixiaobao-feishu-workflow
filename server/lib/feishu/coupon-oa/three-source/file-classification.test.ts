import { describe, expect, it } from "vitest";
import {
  classifyCouponThreeSourceResource,
  unsupportedCouponThreeSourceFileError,
} from "./file-classification";

describe("coupon three-source resource classification", () => {
  it.each(["source.xlsx", "SOURCE.XLSX"])(
    "classifies %s as a workbook",
    (fileName) => {
      expect(
        classifyCouponThreeSourceResource({ resourceType: "file", fileName }),
      ).toBe("excel_xlsx");
    },
  );

  it.each(["calc.png", "calc.JPG", "calc.jpeg"])(
    "classifies %s as an image file",
    (fileName) => {
      expect(
        classifyCouponThreeSourceResource({ resourceType: "file", fileName }),
      ).toBe("image");
    },
  );

  it("classifies direct Feishu images independently of a file name", () => {
    expect(classifyCouponThreeSourceResource({ resourceType: "image" })).toBe(
      "image",
    );
  });

  it.each(["source.xls", "source.csv", "source.ods"])(
    "rejects the unsupported spreadsheet %s without treating it as an image",
    (fileName) => {
      const kind = classifyCouponThreeSourceResource({
        resourceType: "file",
        fileName,
      });
      expect(kind).toBe("unsupported_spreadsheet");
      if (kind !== "unsupported_spreadsheet") {
        throw new Error("expected an unsupported spreadsheet");
      }
      expect(unsupportedCouponThreeSourceFileError(kind).code).toBe(
        "FILE_TYPE_UNSUPPORTED",
      );
    },
  );

  it("classifies unknown files explicitly", () => {
    expect(
      classifyCouponThreeSourceResource({
        resourceType: "file",
        fileName: "readme.pdf",
      }),
    ).toBe("unsupported_file");
  });
});
