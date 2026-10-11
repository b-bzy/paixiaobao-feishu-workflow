import { describe, expect, it, vi } from "vitest";
import type { CouponThreeSourceAiConfig } from "./coupon-oa/three-source/ai-config";
import { createDeepSeekTextGateway } from "./deepseek-text-gateway";

const config: CouponThreeSourceAiConfig = {
  enabled: true,
  apiKey: "test-secret-never-log",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  timeoutMs: 1_000,
  maxResponseBytes: 1_048_576,
};

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

describe("DeepSeek supplement text gateway", () => {
  it("returns a structured candidate without exposing the API key", async () => {
    const fetchImpl = vi.fn(async () =>
      response({
        choices: [
          {
            message: {
              content: JSON.stringify({
                fields: { activityBackground: "清仓活动" },
                warnings: [],
              }),
            },
          },
        ],
      }),
    );
    const result = await createDeepSeekTextGateway(
      config,
      fetchImpl as typeof fetch,
    ).recognizeText({ text: "背景是清仓活动" });
    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(result)).not.toContain(config.apiKey);
  });

  it.each([
    [400, "context_rejected"],
    [429, "rate_limited"],
    [500, "provider_error"],
  ] as const)("classifies HTTP %s", async (status, code) => {
    const result = await createDeepSeekTextGateway(config, (async () =>
      response({ error: "hidden" }, status)) as typeof fetch).recognizeText({
      text: "测试",
    });
    expect(result).toMatchObject({ ok: false, code });
  });

  it("classifies a timeout without retrying in the gateway", async () => {
    const result = await createDeepSeekTextGateway(
      { ...config, timeoutMs: 1 },
      (async (_url, init) => {
        await new Promise<void>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
        return response({});
      }) as typeof fetch,
    ).recognizeText({ text: "测试" });
    expect(result).toMatchObject({ ok: false, code: "timeout" });
  });
});
