export const couponExcelTemplateIds = [
  "coupon-regular-full-reduction-v1",
  "coupon-sku-whitelist-pilot-v1",
  "coupon-multi-tier-sku-whitelist-v1",
  "coupon-multi-tier-sku-blacklist-v1",
  "coupon-single-sku-whitelist-v1",
  "coupon-single-sku-blacklist-v1",
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

export const multiTierSkuSheetNames = [
  "满999减60",
  "满1999减120",
  "满2999减120",
  "满3999减240",
  "满4999减300",
] as const;

export type MultiTierSkuSheetName = (typeof multiTierSkuSheetNames)[number];

export interface MultiTierSkuListWorkbookManifest {
  id:
    | "coupon-multi-tier-sku-whitelist-v1"
    | "coupon-multi-tier-sku-blacklist-v1";
  version: "v1";
  assetName: string;
  sha256: string;
  sheets: typeof multiTierSkuSheetNames;
  header: "sku";
  dataStartRow: 2;
  dataEndRow: 3000;
}

export interface SingleCouponSkuListWorkbookManifest {
  id: "coupon-single-sku-whitelist-v1" | "coupon-single-sku-blacklist-v1";
  version: "v1";
  assetName: string;
  sha256: string;
  blueprintSheet: MultiTierSkuSheetName;
  header: "sku";
  dataStartRow: 2;
  dataEndRow: 3000;
}

const multiTierSkuTemplateSha256 =
  "62b7b56d6fe5e94a98d44726f84b95209e62fc466a052ecbf08e2fc0b5cffd1c";

export const multiTierSkuWhitelistManifest: MultiTierSkuListWorkbookManifest = {
  id: "coupon-multi-tier-sku-whitelist-v1",
  version: "v1",
  assetName: "商品明细白名单-多券档SKU-v1.xlsx",
  sha256: multiTierSkuTemplateSha256,
  sheets: multiTierSkuSheetNames,
  header: "sku",
  dataStartRow: 2,
  dataEndRow: 3000,
};

export const multiTierSkuBlacklistManifest: MultiTierSkuListWorkbookManifest = {
  id: "coupon-multi-tier-sku-blacklist-v1",
  version: "v1",
  assetName: "商品明细黑名单-多券档SKU-v1.xlsx",
  sha256: multiTierSkuTemplateSha256,
  sheets: multiTierSkuSheetNames,
  header: "sku",
  dataStartRow: 2,
  dataEndRow: 3000,
};

export const singleCouponSkuWhitelistManifest: SingleCouponSkuListWorkbookManifest =
  {
    id: "coupon-single-sku-whitelist-v1",
    version: "v1",
    assetName: "商品明细白名单-多券档SKU-v1.xlsx",
    sha256: multiTierSkuTemplateSha256,
    blueprintSheet: "满999减60",
    header: "sku",
    dataStartRow: 2,
    dataEndRow: 3000,
  };

export const singleCouponSkuBlacklistManifest: SingleCouponSkuListWorkbookManifest =
  {
    id: "coupon-single-sku-blacklist-v1",
    version: "v1",
    assetName: "商品明细黑名单-多券档SKU-v1.xlsx",
    sha256: multiTierSkuTemplateSha256,
    blueprintSheet: "满999减60",
    header: "sku",
    dataStartRow: 2,
    dataEndRow: 3000,
  };
