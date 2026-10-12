import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderCouponArtifactScreenshots } from "./calc-image";
import { parseMultiSheetTieredIdentifierList } from "./lists";
import { runOfflineThreeSourceWorkflow } from "./offline";
import {
  discoverRegularFullReductionCoupons,
  extractRegularFullReductionInput,
  inspectThreeSourceWorkbook,
} from "./recognition";
import type { OfflineSourceFile, WorkbookScreenshotRenderer } from "./types";

const fixtureDirectory = join(
  process.cwd(),
  "docs/oa-ticket-reimbursement-materials/reference/fixtures/three-mode-screenshots",
);
const templateDirectory = join(
  process.cwd(),
  "docs/oa-ticket-reimbursement-materials/reference/templates",
);

async function source(fileName: string): Promise<OfflineSourceFile> {
  return {
    fileName,
    bytes: new Uint8Array(await readFile(join(fixtureDirectory, fileName))),
  };
}

async function templates() {
  const [
    regularFullReductionTemplateBytes,
    whitelistTemplateBytes,
    blacklistTemplateBytes,
  ] = await Promise.all([
    readFile(join(templateDirectory, "配券信息表-常规满减券.xlsx")),
    readFile(join(templateDirectory, "商品明细白名单-多券档SKU-v1.xlsx")),
    readFile(join(templateDirectory, "商品明细黑名单-多券档SKU-v1.xlsx")),
  ]);
  return {
    regularFullReductionTemplateBytes,
    whitelistTemplateBytes,
    blacklistTemplateBytes,
  };
}

function renderer(businessMode: "寄卖" | "pop"): WorkbookScreenshotRenderer {
  return {
    render: ({ couponArtifact, revision }) =>
      renderCouponArtifactScreenshots({
        couponArtifact,
        revision,
        businessMode,
      }),
  };
}

async function runCase(input: {
  coupon: string;
  whitelist: string;
  mode: "严选" | "寄卖" | "pop";
}) {
  return runOfflineThreeSourceWorkflow({
    ownerId: "ou_local_fixture",
    revision: 1,
    couponTable: await source(input.coupon),
    whitelist: await source(input.whitelist),
    noBlacklistConfirmed: true,
    ...(input.mode === "严选"
      ? {}
      : { screenshotRenderer: renderer(input.mode) }),
    templates: await templates(),
    activityPointPercent: 5,
  });
}

describe("three-mode local XLSX fixtures", () => {
  it("keeps 严选 image-free", async () => {
    const result = await runCase({
      coupon: "case01-严选-配券表.xlsx",
      whitelist: "case01-严选-白名单.xlsx",
      mode: "严选",
    });
    expect(result.oaPrefill.values.businessMode).toBe("严选");
    expect(result.screenshots).toEqual([]);
  });

  it("generates deterministic screenshots for 寄卖", async () => {
    const result = await runCase({
      coupon: "case02-寄卖-配券表.xlsx",
      whitelist: "case02-寄卖-白名单.xlsx",
      mode: "寄卖",
    });
    expect(result.oaPrefill.values.businessMode).toBe("寄卖");
    expect(result.screenshots.length).toBeGreaterThan(0);
    expect(
      result.screenshots.every((item) => item.contentType === "image/png"),
    ).toBe(true);
  });

  it("preserves all POP tiers and multi-sheet whitelist input", async () => {
    const couponRecognition = await inspectThreeSourceWorkbook(
      await source("case03-POP-五券档配券表.xlsx"),
    );
    const listRecognition = await inspectThreeSourceWorkbook(
      await source("case03-POP-五券档白名单.xlsx"),
    );
    const coupons = await discoverRegularFullReductionCoupons({
      recognition: couponRecognition,
    });
    const whitelist = await parseMultiSheetTieredIdentifierList({
      recognition: listRecognition,
      role: "whitelist",
    });
    expect(coupons).toHaveLength(5);
    expect(whitelist.entries).toHaveLength(75);
    expect(new Set(whitelist.entries.map((entry) => entry.tier)).size).toBe(5);
  });

  it("recognizes a non-first-row header and multi-sheet whitelist", async () => {
    const couponRecognition = await inspectThreeSourceWorkbook(
      await source("case04-寄卖-非首行表头配券表.xlsx"),
    );
    const listRecognition = await inspectThreeSourceWorkbook(
      await source("case04-寄卖-多Sheet白名单.xlsx"),
    );
    const coupon = await extractRegularFullReductionInput({
      recognition: couponRecognition,
    });
    const whitelist = await parseMultiSheetTieredIdentifierList({
      recognition: listRecognition,
      role: "whitelist",
    });
    expect(coupon.input.businessMode).toBe("寄卖");
    expect(coupon.input.overDeduction).toBe("是");
    expect(whitelist.entries).toHaveLength(15);
  });
});
