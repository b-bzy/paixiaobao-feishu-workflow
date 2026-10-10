import { describe, expect, it, vi } from "vitest";
import type { SerializedWorkbookForAi } from "../coupon-oa/three-source/ai-recognition";
import type { CouponThreeSourceAiConfig } from "./coupon-oa/three-source/ai-config";
import { createDeepSeekChatGateway } from "./deepseek-chat-gateway";

const config: CouponThreeSourceAiConfig = {
  enabled: true,
  apiKey: "test-secret-never-log",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  timeoutMs: 1_000,
  maxResponseBytes: 1_048_576,
};
const workbook: SerializedWorkbookForAi = {
  fileName: "test.xlsx",
  sourceHash: "a".repeat(64),
  byteLength: 1,
  sheets: [],
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("DeepSeek chat gateway", () => {
  it("makes one request and returns parsed JSON plus hashes", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: JSON.stringify({ warnings: [] }) } }],
      }),
    );
    const result = await createDeepSeekChatGateway(
      config,
      fetchImpl as typeof fetch,
    ).recognize({ workbook });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, proposal: { warnings: [] } });
    if (result.ok) {
      expect(result.requestSha256).toHaveLength(64);
      expect(result.responseSha256).toHaveLength(64);
    }
  });

  it.each([
    [400, "context_rejected"],
    [429, "rate_limited"],
    [500, "provider_error"],
  ] as const)("classifies HTTP %s", async (status, code) => {
    const result = await createDeepSeekChatGateway(config, (async () =>
      jsonResponse({ error: "hidden" }, status)) as typeof fetch).recognize({
      workbook,
    });
    expect(result).toMatchObject({ ok: false, code });
    expect(JSON.stringify(result)).not.toContain(config.apiKey);
  });

  it("classifies invalid JSON and missing content", async () => {
    const invalid = await createDeepSeekChatGateway(
      config,
      (async () => new Response("not json")) as typeof fetch,
    ).recognize({ workbook });
    expect(invalid).toMatchObject({ ok: false, code: "invalid_json" });

    const missing = await createDeepSeekChatGateway(config, (async () =>
      jsonResponse({ choices: [] })) as typeof fetch).recognize({ workbook });
    expect(missing).toMatchObject({ ok: false, code: "missing_content" });
  });

  it("enforces the response byte limit", async () => {
    const result = await createDeepSeekChatGateway(
      { ...config, maxResponseBytes: 10 },
      (async () => new Response("x".repeat(11))) as typeof fetch,
    ).recognize({ workbook });
    expect(result).toMatchObject({ ok: false, code: "response_too_large" });
  });

  it("classifies network and timeout failures without leaking the key", async () => {
    const network = await createDeepSeekChatGateway(config, (async () => {
      throw new Error("network down");
    }) as typeof fetch).recognize({ workbook });
    expect(network).toMatchObject({ ok: false, code: "network_error" });

    const timeout = await createDeepSeekChatGateway(
      { ...config, timeoutMs: 1 },
      (async (_url, init) => {
        await new Promise<void>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
        return jsonResponse({});
      }) as typeof fetch,
    ).recognize({ workbook });
    expect(timeout).toMatchObject({ ok: false, code: "timeout" });
    expect(JSON.stringify(timeout)).not.toContain(config.apiKey);
  });
});
