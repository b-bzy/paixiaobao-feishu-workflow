import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runOfflineThreeSourceWorkflow } from "../offline";
import type { OfflineSourceFile } from "../types";
import { assertGeneratedCouponArtifacts } from "./artifact-assertions";
import { buildE2eWorkbook } from "./workbook-fixture-builder";

const templateDirectory = join(
  process.cwd(),
  "docs/oa-ticket-reimbursement-materials/reference/templates",
);

async function generated(recipe: string): Promise<OfflineSourceFile> {
  const item = await buildE2eWorkbook({ recipe, variant: 1 });
  return { fileName: item.fileName, bytes: item.bytes };
}

describe("generated artifact read-back", () => {
  it("reopens the standard coupon and whitelist artifacts", async () => {
    const result = await runOfflineThreeSourceWorkflow({
      ownerId: "ou_synthetic_fast_e2e",
      revision: 1,
      couponTable: await generated("standard:coupon"),
      whitelist: await generated("standard:whitelist"),
      noBlacklistConfirmed: true,
      templates: {
        regularFullReductionTemplateBytes: await readFile(
          join(templateDirectory, "配券信息表-常规满减券.xlsx"),
        ),
        whitelistTemplateBytes: await readFile(
          join(templateDirectory, "商品明细白名单-多券档SKU-v1.xlsx"),
        ),
        blacklistTemplateBytes: await readFile(
          join(templateDirectory, "商品明细黑名单-多券档SKU-v1.xlsx"),
        ),
      },
      activityPointPercent: 5,
    });
    const verified = await assertGeneratedCouponArtifacts(result.artifacts);
    expect(verified.every((item) => item.readBackVerified)).toBe(true);
  });
});
