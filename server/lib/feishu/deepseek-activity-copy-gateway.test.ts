import { describe, expect, it, vi } from "vitest";
import { buildActivityCopyFacts } from "../coupon-oa/three-source/activity-copy";
import type { CouponThreeSourceAiConfig } from "./coupon-oa/three-source/ai-config";
import { createDeepSeekActivityCopyGateway } from "./deepseek-activity-copy-gateway";

const config: CouponThreeSourceAiConfig = {
  enabled: true,
  apiKey: "test-secret-never-log",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  timeoutMs: 1_000,
  maxResponseBytes: 1_048_576,
};

describe("DeepSeek activity-copy gateway", () => {
  it("calls the dedicated prompt without exposing the API key", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ content: string }>;
        };
        expect(body.messages[0]?.content).toContain("活动文案候选生成器");
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    activityName: "满100减20优惠券申请",
                    activityBackground:
                      "本期申请满100减20优惠券，本期配置一档优惠券：满100减20。",
                    coveredTierIds: ["tier-1"],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        );
      },
    );
    const facts = buildActivityCopyFacts({
      sourceHashes: { coupon: "a".repeat(64) },
      tiers: [
        {
          id: "tier-1",
          display: "满100减20",
          thresholdYuan: 100,
          discountAmountYuan: 20,
          evidenceCells: ["A2"],
        },
      ],
    });

    const result = await createDeepSeekActivityCopyGateway(
      config,
      fetchImpl as typeof fetch,
    ).generate(facts);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(result)).not.toContain(config.apiKey);
  });
});
