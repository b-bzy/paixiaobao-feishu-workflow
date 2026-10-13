import { describe, expect, it } from "vitest";
import { couponThreeSourceE2eCases } from "./case-catalog";
import { runFastE2eCase } from "./fast-runner";

describe("coupon three-source 64-case fast matrix", () => {
  for (const caseValue of couponThreeSourceE2eCases) {
    it(`${caseValue.id} ${caseValue.title}`, async () => {
      const result = await runFastE2eCase(caseValue);
      expect(result.classification).toBe(caseValue.expected.classification);
      if (caseValue.expected.userFacingCode) {
        expect(result.code).toBe(caseValue.expected.userFacingCode);
      }
      expect(result.nativeOaCreated).toBe(false);
      expect(result.networkCalls).toBe(0);
      expect(result.sourceHashesAfter).toEqual(result.sourceHashesBefore);
    });
  }
});
