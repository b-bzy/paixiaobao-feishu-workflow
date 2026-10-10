import {
  multiTierSkuBlacklistManifest,
  multiTierSkuWhitelistManifest,
  regularFullReductionManifest,
} from "../../../excel-template-engine/template-manifests";
import { loadCouponExcelTemplate } from "../excel-pilot-assets";

export async function loadCouponThreeSourceTemplates(): Promise<{
  regularFullReductionTemplateBytes: Uint8Array;
  whitelistTemplateBytes: Uint8Array;
  blacklistTemplateBytes: Uint8Array;
}> {
  const [
    regularFullReductionTemplateBytes,
    whitelistTemplateBytes,
    blacklistTemplateBytes,
  ] = await Promise.all([
    loadCouponExcelTemplate(regularFullReductionManifest.assetName),
    loadCouponExcelTemplate(multiTierSkuWhitelistManifest.assetName),
    loadCouponExcelTemplate(multiTierSkuBlacklistManifest.assetName),
  ]);
  return {
    regularFullReductionTemplateBytes,
    whitelistTemplateBytes,
    blacklistTemplateBytes,
  };
}
