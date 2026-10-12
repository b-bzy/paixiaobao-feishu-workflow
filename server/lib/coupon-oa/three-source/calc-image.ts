import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import type { Metadata } from "sharp";
import sharp from "sharp";
import type { OfflineArtifact, RenderedCouponScreenshot } from "./types";

export const couponCalcImageRendererVersion = "coupon-calc-image-v1";
export const maximumCalcImageBytes = 10 * 1024 * 1024;
export const maximumCalcImagePixels = 40_000_000;
const rowsPerPage = 24;
const columnsPerPage = 8;

export interface InspectedUserCalcImage {
  contentType: "image/png" | "image/jpeg";
  extension: "png" | "jpg";
  bytes: number;
  width: number;
  height: number;
  sha256: string;
}

export interface CouponScreenshotTable {
  sheetName: string;
  headers: string[];
  rows: string[][];
  displayedValuesSha256: string;
}

export interface CouponScreenshotPage {
  page: number;
  pageCount: number;
  startRow: number;
  endRow: number;
  columnIndexes: number[];
  headers: string[];
  rows: string[][];
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function inspectUserCalcImage(
  bytes: Uint8Array,
): Promise<InspectedUserCalcImage> {
  if (!bytes.byteLength || bytes.byteLength > maximumCalcImageBytes) {
    throw new Error("测算图片必须大于 0 且不超过 10 MB");
  }
  const isPng =
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => bytes[index] === value,
    );
  const isJpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  if (!isPng && !isJpeg) {
    throw new Error("测算图片只接受真实 PNG 或 JPEG 内容");
  }
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, {
      animated: false,
      limitInputPixels: maximumCalcImagePixels,
    }).metadata();
  } catch {
    throw new Error("测算图片已损坏或像素数量超过限制");
  }
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width * metadata.height > maximumCalcImagePixels
  ) {
    throw new Error("测算图片尺寸无效或像素数量超过限制");
  }
  const actual =
    metadata.format === "png"
      ? "png"
      : metadata.format === "jpeg"
        ? "jpg"
        : undefined;
  if (!actual || (isPng && actual !== "png") || (isJpeg && actual !== "jpg")) {
    throw new Error("测算图片格式声明与实际内容不一致");
  }
  return {
    contentType: actual === "png" ? "image/png" : "image/jpeg",
    extension: actual,
    bytes: bytes.byteLength,
    width: metadata.width,
    height: metadata.height,
    sha256: sha256(bytes),
  };
}

export async function extractCouponScreenshotTable(input: {
  couponArtifact: OfflineArtifact;
}): Promise<CouponScreenshotTable> {
  if (input.couponArtifact.role !== "couponTable") {
    throw new Error("自动截图只能读取标准配券表产物");
  }
  if (sha256(input.couponArtifact.bytes) !== input.couponArtifact.sha256) {
    throw new Error("标准配券表 bytes 与冻结 hash 不一致");
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(input.couponArtifact.bytes) as never);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.actualRowCount < 2 || sheet.actualColumnCount < 1) {
    throw new Error("标准配券表没有可渲染的数据区域");
  }
  const columnCount = sheet.actualColumnCount;
  const headers = Array.from({ length: columnCount }, (_, index) =>
    sheet.getCell(1, index + 1).text.trim(),
  );
  const rows = Array.from({ length: sheet.actualRowCount - 1 }, (_, rowIndex) =>
    Array.from({ length: columnCount }, (_, columnIndex) =>
      sheet.getCell(rowIndex + 2, columnIndex + 1).text.trim(),
    ),
  ).filter((row) => row.some(Boolean));
  if (!headers.some(Boolean) || !rows.length) {
    throw new Error("标准配券表没有可渲染的表头或数据行");
  }
  return {
    sheetName: sheet.name,
    headers,
    rows,
    displayedValuesSha256: sha256(
      new TextEncoder().encode(JSON.stringify({ headers, rows })),
    ),
  };
}

export function paginateCouponScreenshotTable(
  table: CouponScreenshotTable,
): CouponScreenshotPage[] {
  const rowGroups = Math.ceil(table.rows.length / rowsPerPage);
  const remainingColumns = Array.from(
    { length: Math.max(0, table.headers.length - 1) },
    (_, index) => index + 1,
  );
  const columnGroups: number[][] = [];
  if (!remainingColumns.length) columnGroups.push([0]);
  for (
    let offset = 0;
    offset < remainingColumns.length;
    offset += columnsPerPage - 1
  ) {
    columnGroups.push([
      0,
      ...remainingColumns.slice(offset, offset + columnsPerPage - 1),
    ]);
  }
  const pageCount = rowGroups * columnGroups.length;
  const pages: CouponScreenshotPage[] = [];
  for (let rowGroup = 0; rowGroup < rowGroups; rowGroup += 1) {
    const start = rowGroup * rowsPerPage;
    const end = Math.min(start + rowsPerPage, table.rows.length);
    for (const columnIndexes of columnGroups) {
      pages.push({
        page: pages.length + 1,
        pageCount,
        startRow: start + 2,
        endRow: end + 1,
        columnIndexes,
        headers: columnIndexes.map((index) => table.headers[index]),
        rows: table.rows
          .slice(start, end)
          .map((row) => columnIndexes.map((index) => row[index] ?? "")),
      });
    }
  }
  return pages;
}

function renderPageSvg(input: {
  page: CouponScreenshotPage;
  businessMode: string;
  revision: number;
  shortHash: string;
}): string {
  const width = 1600;
  const top = 138;
  const rowHeight = 48;
  const height = top + (input.page.rows.length + 1) * rowHeight + 70;
  const columnWidth = Math.floor((width - 80) / input.page.headers.length);
  const cells = [input.page.headers, ...input.page.rows]
    .map((row, rowIndex) =>
      row
        .map((value, columnIndex) => {
          const x = 40 + columnIndex * columnWidth;
          const y = top + rowIndex * rowHeight;
          const fill =
            rowIndex === 0 ? "#1F4E78" : rowIndex % 2 ? "#FFFFFF" : "#F5F7FA";
          const color = rowIndex === 0 ? "#FFFFFF" : "#1F2937";
          const text = escapeXml(
            value.length > 26 ? `${value.slice(0, 25)}…` : value,
          );
          return `<rect x="${x}" y="${y}" width="${columnWidth}" height="${rowHeight}" fill="${fill}" stroke="#D0D5DD"/><text x="${x + 12}" y="${y + 30}" font-size="19" fill="${color}" font-family="Arial, sans-serif">${text}</text>`;
        })
        .join(""),
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#FFFFFF"/><text x="40" y="52" font-size="30" font-weight="700" fill="#101828" font-family="Arial, sans-serif">满减券测算明细</text><text x="40" y="92" font-size="20" fill="#475467" font-family="Arial, sans-serif">业务模式：${escapeXml(input.businessMode)}　revision：${input.revision}　数据 hash：${input.shortHash}　第 ${input.page.page}/${input.page.pageCount} 页</text>${cells}</svg>`;
}

export async function renderCouponArtifactScreenshots(input: {
  couponArtifact: OfflineArtifact;
  revision: number;
  businessMode: "严选" | "寄卖" | "pop";
}): Promise<RenderedCouponScreenshot[]> {
  if (input.businessMode === "严选") return [];
  const table = await extractCouponScreenshotTable({
    couponArtifact: input.couponArtifact,
  });
  const pages = paginateCouponScreenshotTable(table);
  return Promise.all(
    pages.map(async (page, order) => {
      const png = await sharp(
        Buffer.from(
          renderPageSvg({
            page,
            businessMode:
              input.businessMode === "pop" ? "POP" : input.businessMode,
            revision: input.revision,
            shortHash: table.displayedValuesSha256.slice(0, 12),
          }),
        ),
      )
        .png({ compressionLevel: 9, adaptiveFiltering: false })
        .toBuffer();
      const bytes = new Uint8Array(png);
      return {
        artifactId: `calc-image-auto-${input.revision}-${page.page}`,
        order,
        role: "calcImage",
        provenance: "generated",
        fileName: `满减券测算明细-${page.page}of${page.pageCount}.png`,
        bytes,
        sha256: sha256(bytes),
        sourceArtifactSha256: input.couponArtifact.sha256,
        templateId: "coupon-table-display-values",
        templateVersion: "1",
        renderRange: `${table.sheetName}!R${page.startRow}:R${page.endRow}`,
        contentType: "image/png",
        rendererVersion: couponCalcImageRendererVersion,
        page: page.page,
        pageCount: page.pageCount,
        displayedValuesSha256: table.displayedValuesSha256,
      } satisfies RenderedCouponScreenshot;
    }),
  );
}
