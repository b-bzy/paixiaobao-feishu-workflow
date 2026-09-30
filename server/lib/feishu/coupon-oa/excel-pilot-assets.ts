import {
  regularFullReductionManifest,
  skuWhitelistPilotManifest,
} from "../../excel-template-engine/template-manifests";

const assetStorage = "assets:server";
const assetPrefix = "coupon-excel";

export async function loadCouponPilotTemplate(input: {
  kind: "coupon" | "whitelist";
}): Promise<Uint8Array> {
  const assetName =
    input.kind === "coupon"
      ? regularFullReductionManifest.assetName
      : skuWhitelistPilotManifest.assetName;
  const { useStorage } = await import("nitropack/runtime");
  const value = await useStorage(assetStorage).getItemRaw<Uint8Array>(
    `${assetPrefix}:${assetName}`,
  );
  if (!value) throw new Error(`Excel 试点模板不存在：${assetName}`);
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}
