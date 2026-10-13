import { describe, expect, it } from "vitest";
import { couponThreeSourceE2eCases } from "./case-catalog";
import { plannedWorkbookCount } from "./case-contract";

const categoryCounts = {
  F: 8,
  L: 14,
  C: 16,
  S: 16,
  B: 10,
} as const;

describe("coupon three-source E2E case catalog", () => {
  it("contains the complete approved 64-case matrix", () => {
    expect(couponThreeSourceE2eCases).toHaveLength(64);
    expect(new Set(couponThreeSourceE2eCases.map((item) => item.id)).size).toBe(
      64,
    );
    for (const [prefix, count] of Object.entries(categoryCounts)) {
      expect(
        couponThreeSourceE2eCases.filter((item) => item.id.startsWith(prefix)),
      ).toHaveLength(count);
    }
  });

  it("plans more than one hundred generated workbooks", () => {
    expect(plannedWorkbookCount(couponThreeSourceE2eCases)).toBeGreaterThan(
      100,
    );
  });

  it("keeps OA disabled and declares read-back artifacts for every success", () => {
    for (const item of couponThreeSourceE2eCases) {
      expect(item.expected.nativeOaCreated).toBe(false);
      expect(item.inputs.workbooks.length).toBeGreaterThan(0);
      if (item.expected.classification === "passed") {
        expect(item.expected.artifactRoles.length).toBeGreaterThan(0);
      } else {
        expect(item.expected.userFacingCode).toBeTruthy();
      }
    }
  });
});
