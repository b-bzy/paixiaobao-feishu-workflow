/**
 * Wire-format codec for revisioned three-source card action names.
 *
 * Feishu rejects any card whose component `name` exceeds 100 characters
 * (ErrCode 11310, live-verified 2026-10-16), so the card builders and the
 * callback parser MUST share this module: 907c9a6 embedded the full 64-hex
 * context digest in the name and every mapping card silently failed to
 * deliver while recognition kept succeeding. Only the wire name truncates
 * the mapping context hash to 24 hex (96 bits — the hash only guards against
 * context drift within one draft revision, not cryptographic opponents);
 * the semantic action key and the Base-stored
 * `mappingCardDelivery.contextHash` keep the full digest.
 */

export const COUPON_THREE_SOURCE_ACTION_NAME_MAX_LENGTH = 100;
export const MAPPING_CONFIRM_HASH_HEX_LENGTH = 24;

export type CouponThreeSourceRevisionedActionName =
  | "coupon_three_source_mapping_confirm"
  | "coupon_three_source_supplement_recognition_start";

const revisionedActionPattern = new RegExp(
  `^(coupon_three_source_(?:mapping_confirm|supplement_recognition_start)):([^:]+):(\\d+)(?::([a-f0-9]{${MAPPING_CONFIRM_HASH_HEX_LENGTH}}))?$`,
);

export interface CouponThreeSourceRevisionedAction {
  action: CouponThreeSourceRevisionedActionName;
  recordId: string;
  revision: number;
  mappingContextHash?: string;
}

export function shortCouponThreeSourceMappingContextHash(
  fullHash: string,
): string {
  if (fullHash.length < MAPPING_CONFIRM_HASH_HEX_LENGTH) {
    throw new Error(
      `三源上下文哈希长度异常：期望至少 ${MAPPING_CONFIRM_HASH_HEX_LENGTH} 位十六进制`,
    );
  }
  return fullHash.slice(0, MAPPING_CONFIRM_HASH_HEX_LENGTH);
}

export function buildCouponThreeSourceRevisionedActionName(input: {
  action: CouponThreeSourceRevisionedActionName;
  recordId: string;
  revision: number;
  mappingContextHash?: string;
}): string {
  const segments = [input.action, input.recordId, String(input.revision)];
  if (input.action === "coupon_three_source_mapping_confirm") {
    if (!input.mappingContextHash) {
      throw new Error("三源映射确认动作缺少上下文哈希，拒绝构建卡片按钮");
    }
    segments.push(
      shortCouponThreeSourceMappingContextHash(input.mappingContextHash),
    );
  } else if (input.mappingContextHash) {
    throw new Error("三源补充识别动作不应携带上下文哈希");
  }
  const name = segments.join(":");
  if (name.length > COUPON_THREE_SOURCE_ACTION_NAME_MAX_LENGTH) {
    throw new Error(
      `三源卡片动作 name ${name.length} 字符超过飞书 100 字符上限，拒绝发送：${name.slice(0, 64)}`,
    );
  }
  return name;
}

export function parseCouponThreeSourceRevisionedAction(
  action: string,
): CouponThreeSourceRevisionedAction | undefined {
  const match = revisionedActionPattern.exec(action);
  if (!match) return undefined;
  return {
    action: match[1] as CouponThreeSourceRevisionedActionName,
    recordId: match[2],
    revision: Number(match[3]),
    ...(match[4] ? { mappingContextHash: match[4] } : {}),
  };
}
