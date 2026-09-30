export const couponExcelTemplateIds = [
  "coupon-regular-full-reduction-v1",
  "coupon-sku-whitelist-pilot-v1",
] as const;

export type CouponExcelTemplateId = (typeof couponExcelTemplateIds)[number];

export interface CouponWorkbookManifest {
  id: "coupon-regular-full-reduction-v1";
  version: "v1";
  assetName: string;
  sheetName: "满减券";
  headerRow: 1;
  blueprintRow: 2;
  instructionRows: readonly [3, 4];
  futureBackfillColumns: readonly ["A", "B", "C", "D", "E"];
  formulaColumns: readonly ["J", "Q", "U", "V"];
}

export interface SkuWhitelistWorkbookManifest {
  id: "coupon-sku-whitelist-pilot-v1";
  version: "v1";
  assetName: string;
  sheetName: string;
  header: "SKUID";
}

export const regularFullReductionManifest: CouponWorkbookManifest = {
  id: "coupon-regular-full-reduction-v1",
  version: "v1",
  assetName: "配券信息表-常规满减券.xlsx",
  sheetName: "满减券",
  headerRow: 1,
  blueprintRow: 2,
  instructionRows: [3, 4],
  futureBackfillColumns: ["A", "B", "C", "D", "E"],
  formulaColumns: ["J", "Q", "U", "V"],
};

export const skuWhitelistPilotManifest: SkuWhitelistWorkbookManifest = {
  id: "coupon-sku-whitelist-pilot-v1",
  version: "v1",
  assetName: "商品明细白名单-自动填报演练.xlsx",
  sheetName: "100减1",
  header: "SKUID",
};
