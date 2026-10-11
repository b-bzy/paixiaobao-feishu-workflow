import { createHash } from "node:crypto";
import { buildCouponSupplementTextAiRequest } from "../coupon-oa/three-source/ai-text";
import type { CouponThreeSourceAiConfig } from "./coupon-oa/three-source/ai-config";
import type {
  AiGatewayFailureCode,
  AiGatewayResponse,
} from "./deepseek-chat-gateway";

export interface CouponSupplementTextGateway {
  recognizeText(input: { text: string }): Promise<AiGatewayResponse>;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function timestamp(): string {
  return new Date().toISOString();
}

async function boundedBytes(
  response: Response,
  maximumBytes: number,
  controller: AbortController,
): Promise<Uint8Array | undefined> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) {
    controller.abort();
    return undefined;
  }
  return bytes;
}

export function createDeepSeekTextGateway(
  config: CouponThreeSourceAiConfig,
  fetchImpl: typeof fetch = fetch,
): CouponSupplementTextGateway {
  if (!config.enabled || !config.apiKey) {
    throw new Error("P0 AI recognition is disabled or not configured");
  }
  return {
    async recognizeText(input) {
      const startedAt = timestamp();
      const start = Date.now();
      const prompt = buildCouponSupplementTextAiRequest(input.text);
      const body = JSON.stringify({
        model: config.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
      });
      const requestSha256 = sha256(body);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      const finish = () => ({
        startedAt,
        completedAt: timestamp(),
        durationMs: Date.now() - start,
      });
      try {
        const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body,
          signal: controller.signal,
        });
        const declaredLength = Number(response.headers.get("content-length"));
        if (
          Number.isFinite(declaredLength) &&
          declaredLength > config.maxResponseBytes
        ) {
          return {
            ok: false,
            code: "response_too_large",
            requestSha256,
            ...finish(),
          };
        }
        const bytes = await boundedBytes(
          response,
          config.maxResponseBytes,
          controller,
        );
        if (!bytes) {
          return {
            ok: false,
            code: "response_too_large",
            requestSha256,
            ...finish(),
          };
        }
        const responseSha256 = sha256(bytes);
        if (!response.ok) {
          const code: AiGatewayFailureCode =
            response.status === 429
              ? "rate_limited"
              : response.status === 400
                ? "context_rejected"
                : "provider_error";
          return {
            ok: false,
            code,
            requestSha256,
            responseSha256,
            ...finish(),
          };
        }
        let payload: unknown;
        try {
          payload = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          return {
            ok: false,
            code: "invalid_json",
            requestSha256,
            responseSha256,
            ...finish(),
          };
        }
        const content = (
          payload as { choices?: Array<{ message?: { content?: unknown } }> }
        ).choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) {
          return {
            ok: false,
            code: "missing_content",
            requestSha256,
            responseSha256,
            ...finish(),
          };
        }
        try {
          return {
            ok: true,
            proposal: JSON.parse(content) as unknown,
            requestSha256,
            responseSha256,
            ...finish(),
          };
        } catch {
          return {
            ok: false,
            code: "invalid_json",
            requestSha256,
            responseSha256,
            ...finish(),
          };
        }
      } catch (error) {
        return {
          ok: false,
          code:
            controller.signal.aborted ||
            (error instanceof Error && error.name === "AbortError")
              ? "timeout"
              : "network_error",
          requestSha256,
          ...finish(),
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
