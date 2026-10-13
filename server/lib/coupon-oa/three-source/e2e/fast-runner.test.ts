import { describe, expect, it } from "vitest";
import { couponThreeSourceE2eCases } from "./case-catalog";
import { runFastE2eCase } from "./fast-runner";

describe("coupon three-source fast local E2E", () => {
  it("runs F01 through real recognition, generation and read-back", async () => {
    const caseValue = couponThreeSourceE2eCases.find(
      (item) => item.id === "F01",
    );
    if (!caseValue) throw new Error("F01 fixture is missing");
    const result = await runFastE2eCase(caseValue);
    expect(result).toMatchObject({
      caseId: "F01",
      classification: "passed",
      nativeOaCreated: false,
      networkCalls: 0,
    });
    expect(result.artifacts.map((item) => item.role).sort()).toEqual([
      "couponTable",
      "whitelist",
    ]);
    expect(result.artifacts.every((item) => item.readBackVerified)).toBe(true);
    expect(result.sourceHashesAfter).toEqual(result.sourceHashesBefore);
  });

  it.each([
    ["F02", "FILE_EMPTY"],
    ["F03", "WORKBOOK_CORRUPT"],
    ["F04", "WORKBOOK_ENCRYPTED"],
    ["F05", "FILE_FORMAT_UNSUPPORTED"],
    ["F06", "FILE_SIGNATURE_INVALID"],
    ["F07", "FILE_LIMIT_EXCEEDED"],
  ])("classifies %s before AI or generation", async (caseId, code) => {
    const caseValue = couponThreeSourceE2eCases.find(
      (item) => item.id === caseId,
    );
    if (!caseValue) throw new Error(`${caseId} fixture is missing`);
    const result = await runFastE2eCase(caseValue);
    expect(result).toMatchObject({
      caseId,
      classification: "expected_block",
      code,
      artifacts: [],
      nativeOaCreated: false,
      networkCalls: 0,
    });
  });
});
