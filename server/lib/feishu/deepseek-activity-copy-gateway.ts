import {
  type ActivityCopyFacts,
  buildActivityCopyAiRequest,
} from "../coupon-oa/three-source/activity-copy";
import type { CouponThreeSourceAiConfig } from "./coupon-oa/three-source/ai-config";
import {
  type AiGatewayResponse,
  callDeepSeekJson,
} from "./deepseek-chat-gateway";

export interface CouponActivityCopyGateway {
  generate(facts: ActivityCopyFacts): Promise<AiGatewayResponse>;
}

export function createDeepSeekActivityCopyGateway(
  config: CouponThreeSourceAiConfig,
  fetchImpl: typeof fetch = fetch,
): CouponActivityCopyGateway {
  if (!config.enabled || !config.apiKey) {
    throw new Error("P0 AI activity copy is disabled or not configured");
  }
  return {
    generate(facts) {
      return callDeepSeekJson(
        config,
        buildActivityCopyAiRequest(facts),
        fetchImpl,
      );
    },
  };
}
