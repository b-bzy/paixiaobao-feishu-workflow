import { describe, expect, it } from "vitest";
import { createDeepSeekChatGateway } from "../../../feishu/deepseek-chat-gateway";
import {
  serializeWorkbookForAi,
  validateCouponThreeSourceAiProposal,
} from "../ai-recognition";
import { buildE2eWorkbook } from "./workbook-fixture-builder";

const enabled = process.env.COUPON_E2E_ALLOW_DEEPSEEK === "true";

describe.skipIf(!enabled)("DeepSeek three-source contract", () => {
  it("recognizes a synthetic coupon workbook through the official JSON gateway", async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required");
    const source = await buildE2eWorkbook({
      recipe: "standard:coupon",
      variant: 1,
    });
    const workbook = await serializeWorkbookForAi({
      fileName: source.fileName,
      bytes: source.bytes,
    });
    const response = await createDeepSeekChatGateway({
      enabled: true,
      apiKey,
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      timeoutMs: 45_000,
      maxResponseBytes: 1_048_576,
    }).recognize({ workbook });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error(`DeepSeek contract failed with ${response.code}`);
    }
    const validated = validateCouponThreeSourceAiProposal({
      proposal: response.proposal,
      workbook,
    });
    expect(validated.roleCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "couponTable" }),
      ]),
    );
    expect(validated.couponCandidates.length).toBeGreaterThan(0);
    expect(validated.couponCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          couponType: "regular_full_reduction",
          sourceHash: workbook.sourceHash,
        }),
      ]),
    );
    expect(JSON.stringify(validated)).not.toContain(apiKey);
  }, 90_000);
});
