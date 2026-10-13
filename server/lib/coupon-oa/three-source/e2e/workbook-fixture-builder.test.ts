import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  buildE2eWorkbook,
  classifyGeneratedWorkbook,
} from "./workbook-fixture-builder";

async function load(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  return workbook;
}

describe("coupon E2E workbook fixture builder", () => {
  it.each([
    ["header-row-1:coupon", 1],
    ["header-row-2:coupon", 2],
    ["header-row-10:coupon", 10],
  ])("places the header for %s", async (recipe, row) => {
    const generated = await buildE2eWorkbook({ recipe, variant: 1 });
    const workbook = await load(generated.bytes);
    expect(workbook.worksheets[0]?.getCell(`A${row}`).text).toBe("活动名称");
  });

  it.each([
    ["sku-column-position:whitelist", 1, "A"],
    ["sku-column-position:whitelist", 2, "C"],
    ["sku-column-position:whitelist", 3, "Z"],
  ])(
    "places the SKU column in %s variant %i",
    async (recipe, variant, column) => {
      const generated = await buildE2eWorkbook({ recipe, variant });
      const workbook = await load(generated.bytes);
      expect(workbook.worksheets[0]?.getCell(`${column}1`).text).toBe("sku");
    },
  );

  it("creates ten independently named list sheets", async () => {
    const generated = await buildE2eWorkbook({
      recipe: "dynamic-list-sheets:whitelist",
      variant: 4,
    });
    const workbook = await load(generated.bytes);
    expect(workbook.worksheets).toHaveLength(10);
    expect(new Set(workbook.worksheets.map((sheet) => sheet.name)).size).toBe(
      10,
    );
  });

  it("keeps leading-zero identifiers as text", async () => {
    const generated = await buildE2eWorkbook({
      recipe: "leading-zero-sku:whitelist",
      variant: 1,
    });
    const workbook = await load(generated.bytes);
    expect(workbook.worksheets[0]?.getCell("A2").value).toBe("001234567890");
    expect(workbook.worksheets[0]?.getCell("A2").numFmt).toBe("@");
  });

  it("classifies empty, fake and legacy inputs without parsing them", async () => {
    await expect(
      classifyGeneratedWorkbook(
        await buildE2eWorkbook({ recipe: "zero-byte:coupon", variant: 1 }),
      ),
    ).resolves.toBe("empty");
    await expect(
      classifyGeneratedWorkbook(
        await buildE2eWorkbook({
          recipe: "fake-xlsx-signature:coupon",
          variant: 1,
        }),
      ),
    ).resolves.toBe("signature_invalid");
    await expect(
      classifyGeneratedWorkbook(
        await buildE2eWorkbook({ recipe: "legacy-xls:coupon", variant: 1 }),
      ),
    ).resolves.toBe("legacy_xls");
  });

  it("produces a stable semantic fingerprint", async () => {
    const first = await buildE2eWorkbook({
      recipe: "standard:coupon",
      variant: 1,
    });
    const second = await buildE2eWorkbook({
      recipe: "standard:coupon",
      variant: 1,
    });
    expect(first.semanticFingerprint).toBe(second.semanticFingerprint);
  });
});
