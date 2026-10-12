import { z } from "zod";
import type { PublicCampaignCandidate } from "../coupon-oa/three-source/public-calendar";
import type { CouponPublicCalendarConfig } from "./coupon-oa/three-source/ai-config";

const responseSchema = z.object({
  candidates: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        sourceUrl: z.url().refine((value) => value.startsWith("https://")),
        fetchedAt: z.iso.datetime(),
      }),
    )
    .max(100),
});

export type PublicCampaignCalendarResponse =
  | { ok: true; candidates: PublicCampaignCandidate[] }
  | {
      ok: false;
      code:
        | "disabled"
        | "timeout"
        | "network_error"
        | "provider_error"
        | "invalid_json"
        | "invalid_schema"
        | "response_too_large";
    };

export interface PublicCampaignCalendarGateway {
  lookup(input: {
    startMonthDay: string;
    endMonthDay: string;
    locale: "zh-CN";
    queryVersion: string;
  }): Promise<PublicCampaignCalendarResponse>;
}

function unsafeHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".local") ||
    /^127\./.test(normalized) ||
    /^10\./.test(normalized) ||
    /^192\.168\./.test(normalized) ||
    /^169\.254\./.test(normalized) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(normalized) ||
    normalized === "::1"
  );
}

export function createPublicCampaignCalendarGateway(
  config: CouponPublicCalendarConfig,
  fetchImpl: typeof fetch = fetch,
): PublicCampaignCalendarGateway {
  if (!config.enabled || !config.endpoint) {
    return {
      async lookup() {
        return { ok: false, code: "disabled" };
      },
    };
  }
  const endpoint = new URL(config.endpoint);
  if (unsafeHost(endpoint.hostname)) {
    throw new Error("Public calendar endpoint host is not allowed");
  }
  return {
    async lookup(input) {
      const url = new URL(endpoint);
      url.search = "";
      url.searchParams.set("start_month_day", input.startMonthDay);
      url.searchParams.set("end_month_day", input.endMonthDay);
      url.searchParams.set("locale", input.locale);
      url.searchParams.set("query_version", input.queryVersion);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetchImpl(url, {
          headers: { Accept: "application/json" },
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) return { ok: false, code: "provider_error" };
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) {
          return { ok: false, code: "invalid_json" };
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > config.maxResponseBytes) {
          return { ok: false, code: "response_too_large" };
        }
        let value: unknown;
        try {
          value = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          return { ok: false, code: "invalid_json" };
        }
        const parsed = responseSchema.safeParse(value);
        return parsed.success
          ? { ok: true, candidates: parsed.data.candidates }
          : { ok: false, code: "invalid_schema" };
      } catch (error) {
        return {
          ok: false,
          code:
            controller.signal.aborted ||
            (error instanceof Error && error.name === "AbortError")
              ? "timeout"
              : "network_error",
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
