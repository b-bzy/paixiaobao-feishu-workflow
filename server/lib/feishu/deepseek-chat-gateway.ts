import { createHash } from "node:crypto";
import type { SerializedWorkbookForAi } from "../coupon-oa/three-source/ai-recognition";
import { buildCouponThreeSourceAiRequest } from "../coupon-oa/three-source/ai-recognition";
import type { PublicCampaignCandidate } from "../coupon-oa/three-source/public-calendar";
import type { CouponThreeSourceAiConfig } from "./coupon-oa/three-source/ai-config";

export type AiGatewayFailureCode =
  | "context_rejected"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "invalid_json"
  | "missing_content"
  | "response_too_large"
  | "provider_error";

export interface AiRecognitionRequest {
  workbook: SerializedWorkbookForAi;
  publicCampaignCandidates?: PublicCampaignCandidate[];
}

export type AiGatewayResponse =
  | {
      ok: true;
      proposal: unknown;
      requestSha256: string;
      responseSha256: string;
      startedAt: string;
      completedAt: string;
      durationMs: number;
    }
  | {
      ok: false;
      code: AiGatewayFailureCode;
      requestSha256?: string;
      responseSha256?: string;
      startedAt: string;
      completedAt: string;
      durationMs: number;
    };

export interface CouponThreeSourceAiGateway {
  recognize(input: AiRecognitionRequest): Promise<AiGatewayResponse>;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function timestamp(): string {
  return new Date().toISOString();
}

async function readBoundedResponse(
  response: Response,
  maximumBytes: number,
  controller: AbortController,
): Promise<Uint8Array | undefined> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength <= maximumBytes ? bytes : undefined;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maximumBytes) {
      controller.abort();
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createDeepSeekChatGateway(
  config: CouponThreeSourceAiConfig,
  fetchImpl: typeof fetch = fetch,
): CouponThreeSourceAiGateway {
  if (!config.enabled || !config.apiKey) {
    throw new Error("P0 AI recognition is disabled or not configured");
  }
  return {
    async recognize(input) {
      const startedAt = timestamp();
      const start = Date.now();
      const prompt = buildCouponThreeSourceAiRequest(input.workbook, {
        publicCampaignCandidates: input.publicCampaignCandidates,
      });
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
        const bytes = await readBoundedResponse(
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
          payload as {
            choices?: Array<{ message?: { content?: unknown } }>;
          }
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
        let proposal: unknown;
        try {
          proposal = JSON.parse(content);
        } catch {
          return {
            ok: false,
            code: "invalid_json",
            requestSha256,
            responseSha256,
            ...finish(),
          };
        }
        return {
          ok: true,
          proposal,
          requestSha256,
          responseSha256,
          ...finish(),
        };
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
