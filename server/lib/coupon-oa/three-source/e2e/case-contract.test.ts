import { describe, expect, it } from "vitest";
import {
  validateCouponThreeSourceE2eCase,
  validateCouponThreeSourceE2eCatalog,
} from "./case-contract";

const validCase = {
  id: "F01",
  title: "标准基准包",
  tags: ["file", "success"],
  inputs: {
    workbooks: [
      { role: "couponTable", recipe: "standard-coupon" },
      { role: "whitelist", recipe: "standard-whitelist" },
    ],
    aiReplay: "complete",
    ownerReplies: [],
  },
  expected: {
    classification: "passed",
    terminalState: "AwaitingFinalConfirmation",
    revision: 3,
    secondRoundCardCount: 1,
    artifactRoles: ["couponTable", "whitelist"],
    nativeOaCreated: false,
  },
} as const;

describe("coupon three-source E2E case contract", () => {
  it("accepts a complete safe case", () => {
    expect(validateCouponThreeSourceE2eCase(validCase).id).toBe("F01");
  });

  it("rejects a non-approved category prefix", () => {
    expect(() =>
      validateCouponThreeSourceE2eCase({ ...validCase, id: "X01" }),
    ).toThrow(/case id/iu);
  });

  it("requires successful cases to declare artifacts", () => {
    expect(() =>
      validateCouponThreeSourceE2eCase({
        ...validCase,
        expected: { ...validCase.expected, artifactRoles: [] },
      }),
    ).toThrow(/artifact/iu);
  });

  it("requires abnormal cases to expose a stable code", () => {
    expect(() =>
      validateCouponThreeSourceE2eCase({
        ...validCase,
        expected: {
          ...validCase.expected,
          classification: "expected_block",
          artifactRoles: [],
        },
      }),
    ).toThrow(/code/iu);
  });

  it("never permits native OA creation", () => {
    expect(() =>
      validateCouponThreeSourceE2eCase({
        ...validCase,
        expected: { ...validCase.expected, nativeOaCreated: true },
      }),
    ).toThrow(/nativeOaCreated/iu);
  });

  it("rejects duplicate case ids", () => {
    expect(() =>
      validateCouponThreeSourceE2eCatalog([validCase, validCase]),
    ).toThrow(/duplicate/iu);
  });
});
