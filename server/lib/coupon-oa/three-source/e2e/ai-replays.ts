import type { AiGatewayFailureCode } from "../../../feishu/deepseek-chat-gateway";

export interface E2eAiReplaySuccess {
  kind: "success";
  proposal: unknown;
}

export interface E2eAiReplayFailure {
  kind: "failure";
  code: AiGatewayFailureCode;
}

export type E2eAiReplayScenario = E2eAiReplaySuccess | E2eAiReplayFailure;

const emptyValidProposal = {
  templateCandidates: [],
  tierCandidates: [],
  sourceRoleCandidates: [],
  couponCandidates: [],
  fieldCandidates: [],
  listCandidates: [],
  skuRegionCandidates: [],
  activityCopyCandidates: [],
  warnings: [],
};

export const e2eAiReplayScenarios: Readonly<
  Record<string, E2eAiReplayScenario>
> = {
  complete: { kind: "success", proposal: emptyValidProposal },
  "activity-copy": {
    kind: "success",
    proposal: {
      ...emptyValidProposal,
      activityCopyCandidates: [
        {
          key: "activityName",
          value: "合成测试优惠券活动",
          evidence: { sheetName: "配券表", cells: ["A1"] },
        },
      ],
    },
  },
  "low-confidence-layout": { kind: "success", proposal: emptyValidProposal },
  "low-confidence-identifier": {
    kind: "success",
    proposal: emptyValidProposal,
  },
  "partial-valid": {
    kind: "success",
    proposal: {
      ...emptyValidProposal,
      fieldCandidates: [
        {
          key: "activityName",
          sheetName: "配券表",
          headerCell: "A1",
          valueCell: "A2",
          confidence: 0.99,
          reason: "合成有效候选",
          value: "合成测试活动",
        },
        {
          key: "activityBackground",
          sheetName: "不存在",
          headerCell: "A1",
          valueCell: "A2",
          confidence: 0.99,
          reason: "合成非法候选",
          value: "不得被提升",
        },
      ],
    },
  },
  "invalid-evidence": {
    kind: "success",
    proposal: {
      ...emptyValidProposal,
      sourceRoleCandidates: [
        {
          role: "couponTable",
          confidence: 1,
          reasons: ["合成越界证据"],
          evidence: { sheetName: "不存在", cells: ["Z999"] },
        },
      ],
    },
  },
  timeout: { kind: "failure", code: "timeout" },
  "rate-limited": { kind: "failure", code: "rate_limited" },
  "invalid-json": { kind: "failure", code: "invalid_json" },
  "provider-error": { kind: "failure", code: "provider_error" },
};
