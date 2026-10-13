import { createHash } from "node:crypto";
import type {
  AiGatewayResponse,
  CouponThreeSourceAiGateway,
} from "../../../feishu/deepseek-chat-gateway";
import { e2eAiReplayScenarios } from "./ai-replays";

const replayTime = "2026-01-01T00:00:00.000Z";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface AiReplayGateway extends CouponThreeSourceAiGateway {
  audit(): { calls: number; uniqueRequests: number; networkCalls: 0 };
}

export function createAiReplayGateway(scenarioId: string): AiReplayGateway {
  const scenario = e2eAiReplayScenarios[scenarioId];
  if (!scenario)
    throw new Error(`AI replay scenario is not registered: ${scenarioId}`);
  let calls = 0;
  const requests = new Set<string>();
  return {
    async recognize(input): Promise<AiGatewayResponse> {
      calls += 1;
      const requestBody = JSON.stringify(input);
      const requestSha256 = sha256(requestBody);
      requests.add(requestSha256);
      if (scenario.kind === "failure") {
        return {
          ok: false,
          code: scenario.code,
          requestSha256,
          startedAt: replayTime,
          completedAt: replayTime,
          durationMs: 0,
        };
      }
      return {
        ok: true,
        proposal: structuredClone(scenario.proposal),
        requestSha256,
        responseSha256: sha256(JSON.stringify(scenario.proposal)),
        startedAt: replayTime,
        completedAt: replayTime,
        durationMs: 0,
      };
    },
    audit() {
      return { calls, uniqueRequests: requests.size, networkCalls: 0 };
    },
  };
}
