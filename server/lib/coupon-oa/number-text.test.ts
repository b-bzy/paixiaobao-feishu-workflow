import { describe, expect, it } from "vitest";
import { foldFullWidth, parseFlexibleNumber } from "./number-text";

describe("parseFlexibleNumber", () => {
  it.each([
    ["1000", 1000],
    ["10,000", 10_000],
    ["10，000", 10_000],
    ["１０００", 1000],
    ["10 000", 10_000],
    ["10,000张", 10_000],
    ["1000枚", 1000],
    ["共1万", 10_000],
    ["1.5万", 15_000],
    ["2亿", 200_000_000],
    ["12万元", 120_000],
    ["￥199", 199],
    ["约 2,000 元", 2_000],
    ["0.5", 0.5],
    ["＋86", 86],
    ["满100减20", undefined],
    ["待定", undefined],
    ["", undefined],
  ])("parses %s into %s", (input, expected) => {
    expect(parseFlexibleNumber(input)).toBe(expected);
  });

  it("folds full-width ASCII punctuation to half-width", () => {
    expect(foldFullWidth("１０，０００（张）")).toBe("10,000(张)");
  });
});
