import { describe, expect, it } from "vitest";
import {
  buildCouponThreeSourceRevisionedActionName,
  parseCouponThreeSourceRevisionedAction,
  shortCouponThreeSourceMappingContextHash,
} from "./action-name";

const fullHash = "a".repeat(64);

describe("coupon three-source revisioned action names", () => {
  it("builds and parses mapping confirm names with a 24-hex context hash", () => {
    const name = buildCouponThreeSourceRevisionedActionName({
      action: "coupon_three_source_mapping_confirm",
      recordId: "reczz28NtbiBLSvW",
      revision: 3,
      mappingContextHash: fullHash,
    });
    expect(name).toBe(
      `coupon_three_source_mapping_confirm:reczz28NtbiBLSvW:3:${"a".repeat(24)}`,
    );
    expect(name.length).toBeLessThanOrEqual(100);
    expect(parseCouponThreeSourceRevisionedAction(name)).toEqual({
      action: "coupon_three_source_mapping_confirm",
      recordId: "reczz28NtbiBLSvW",
      revision: 3,
      mappingContextHash: "a".repeat(24),
    });
  });

  it("keeps supplement recognition names hash-free but parseable", () => {
    const name = buildCouponThreeSourceRevisionedActionName({
      action: "coupon_three_source_supplement_recognition_start",
      recordId: "rec-three-source",
      revision: 12,
    });
    expect(name).toBe(
      "coupon_three_source_supplement_recognition_start:rec-three-source:12",
    );
    expect(parseCouponThreeSourceRevisionedAction(name)).toEqual({
      action: "coupon_three_source_supplement_recognition_start",
      recordId: "rec-three-source",
      revision: 12,
    });
  });

  it("still parses legacy names without a hash suffix", () => {
    expect(
      parseCouponThreeSourceRevisionedAction(
        "coupon_three_source_mapping_confirm:rec-legacy:4",
      ),
    ).toEqual({
      action: "coupon_three_source_mapping_confirm",
      recordId: "rec-legacy",
      revision: 4,
    });
  });

  it("rejects over-long names at build time instead of at the Feishu API", () => {
    expect(() =>
      buildCouponThreeSourceRevisionedActionName({
        action: "coupon_three_source_mapping_confirm",
        recordId: `rec-${"x".repeat(90)}`,
        revision: 3,
        mappingContextHash: fullHash,
      }),
    ).toThrow("100 字符上限");
  });

  it("requires the context hash on mapping confirm and forbids it elsewhere", () => {
    expect(() =>
      buildCouponThreeSourceRevisionedActionName({
        action: "coupon_three_source_mapping_confirm",
        recordId: "rec-x",
        revision: 3,
      }),
    ).toThrow("缺少上下文哈希");
    expect(() =>
      buildCouponThreeSourceRevisionedActionName({
        action: "coupon_three_source_supplement_recognition_start",
        recordId: "rec-x",
        revision: 3,
        mappingContextHash: fullHash,
      }),
    ).toThrow("不应携带上下文哈希");
  });

  it("rejects malformed hashes and unknown action shapes when parsing", () => {
    expect(
      parseCouponThreeSourceRevisionedAction(
        `coupon_three_source_mapping_confirm:rec-x:3:${fullHash}`,
      ),
    ).toBeUndefined();
    expect(
      parseCouponThreeSourceRevisionedAction(
        "coupon_three_source_mapping_confirm",
      ),
    ).toBeUndefined();
    expect(
      parseCouponThreeSourceRevisionedAction(
        "coupon_three_source_cancel:rec:1",
      ),
    ).toBeUndefined();
  });

  it("truncates only the wire form of the context hash", () => {
    expect(shortCouponThreeSourceMappingContextHash(fullHash)).toBe(
      "a".repeat(24),
    );
    expect(() => shortCouponThreeSourceMappingContextHash("abc")).toThrow(
      "长度异常",
    );
  });
});
