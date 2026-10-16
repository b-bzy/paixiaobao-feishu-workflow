import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  extractCouponScreenshotTable,
  inspectUserCalcImage,
  paginateCouponScreenshotTable,
  renderCouponArtifactScreenshots,
} from "./calc-image";

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

async function couponArtifact(rowCount = 49, columnCount = 10) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("满减券");
  sheet.addRow(
    Array.from({ length: columnCount }, (_, index) =>
      index === 0 ? "券档" : `字段${index}`,
    ),
  );
  for (let row = 0; row < rowCount; row += 1) {
    sheet.addRow(
      Array.from({ length: columnCount }, (_, index) =>
        index === 0 ? `满${999 + row}减60` : `值-${row + 1}-${index}`,
      ),
    );
  }
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  return {
    role: "couponTable" as const,
    fileName: "标准配券表.xlsx",
    bytes,
    sha256: sha256(bytes),
    rowCount,
    template: { id: "test", version: "1" },
  };
}

describe("coupon calculation images", () => {
  it("accepts real PNG/JPEG bytes and rejects filename-like garbage", async () => {
    const png = new Uint8Array(
      await sharp({
        create: { width: 80, height: 40, channels: 3, background: "white" },
      })
        .png()
        .toBuffer(),
    );
    await expect(inspectUserCalcImage(png)).resolves.toMatchObject({
      contentType: "image/png",
      width: 80,
      height: 40,
    });
    await expect(
      inspectUserCalcImage(new TextEncoder().encode("not a png")),
    ).rejects.toThrow("真实 PNG 或 JPEG");
  });

  it("renders all columns on one page and splits rows only past the pixel budget", async () => {
    const table = await extractCouponScreenshotTable({
      couponArtifact: await couponArtifact(),
    });
    const pages = paginateCouponScreenshotTable(table);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.rows).toHaveLength(49);
    expect(pages[0]?.columnIndexes).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const wideTable = await extractCouponScreenshotTable({
      couponArtifact: await couponArtifact(2, 30),
    });
    const widePages = paginateCouponScreenshotTable(wideTable);
    expect(widePages).toHaveLength(1);
    expect(widePages[0]?.headers).toHaveLength(30);

    const tallTable = await extractCouponScreenshotTable({
      couponArtifact: await couponArtifact(130, 10),
    });
    const tallPages = paginateCouponScreenshotTable(tallTable);
    expect(tallPages.map((page) => page.rows.length)).toEqual([115, 15]);
    expect(tallPages[1]?.startRow).toBe(117);
    expect(tallPages[1]?.endRow).toBe(131);
  });

  it("renders ordered deterministic PNG pages from the frozen workbook", async () => {
    const artifact = await couponArtifact(2, 3);
    const first = await renderCouponArtifactScreenshots({
      couponArtifact: artifact,
      revision: 7,
      businessMode: "寄卖",
    });
    const second = await renderCouponArtifactScreenshots({
      couponArtifact: artifact,
      revision: 7,
      businessMode: "寄卖",
    });
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      order: 0,
      page: 1,
      pageCount: 1,
      fileName: "满减券测算明细-1of1.png",
      contentType: "image/png",
      sourceArtifactSha256: artifact.sha256,
    });
    expect(first[0].sha256).toBe(second[0].sha256);
    await expect(inspectUserCalcImage(first[0].bytes)).resolves.toMatchObject({
      contentType: "image/png",
      width: 680,
    });
  });
});
