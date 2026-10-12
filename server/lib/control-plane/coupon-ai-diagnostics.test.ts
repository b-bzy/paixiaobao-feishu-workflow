import { describe, expect, it, vi } from "vitest";
import { createCouponThreeSourceTask } from "../coupon-oa/three-source/task";
import type { CouponThreeSourcePilotDraft } from "../feishu/coupon-oa/three-source/store";
import { getRecentCouponAiDiagnostics } from "./coupon-ai-diagnostics";

describe("coupon AI diagnostics", () => {
  it("reports each AI-to-card boundary without exposing source values", async () => {
    const database = {
      query: vi.fn(async () => ({
        rowCount: 1,
        rows: [
          {
            id: "run-1",
            pilot_record_id: "record-1",
            status: "succeeded",
            prompt_version: "prompt-v2",
            request_sha256: "request-hash",
            response_sha256: "response-hash",
            duration_ms: 1200,
            validated_result: {
              issues: [],
              activityCopyCandidates: [
                { key: "activityName", value: "AI 活动名称" },
                { key: "activityBackground", value: "AI 活动背景" },
              ],
              fieldCandidates: [],
            },
            projected_at: "2026-10-12T01:00:01.000Z",
            created_at: "2026-10-12T01:00:00.000Z",
          },
        ],
      })),
    };
    const task = createCouponThreeSourceTask({
      taskId: "task-1",
      ownerOpenId: "owner-1",
    });
    task.status = "AwaitingSourceConfirmation";
    task.blacklistStatus = "absent_confirmed";
    const draft = {
      recordId: "record-1",
      pilotId: "pilot-1",
      ownerOpenId: "owner-1",
      task,
      schemaVersion: "coupon-three-source-pilot-v1",
      recognitions: {
        couponTable: {
          source: {
            messageId: "message-source",
            fileKey: "file-source",
            fileName: "source.xlsx",
            bytes: 1,
            sha256: "a".repeat(64),
          },
          sourceHash: "a".repeat(64),
          roleCandidates: [],
          couponFieldCandidates: {},
          listCandidates: [],
          issues: [],
          ai: {
            runId: "run-1",
            revision: 1,
            sourceSha256: "a".repeat(64),
            status: "succeeded",
            primary: true,
            activityCopyEnabled: true,
            result: {
              fieldCandidates: [],
              activityCopyCandidates: [
                { key: "activityName", value: "AI 活动名称" },
                { key: "activityBackground", value: "AI 活动背景" },
              ],
            },
          },
        },
      },
      selections: {},
      artifacts: [],
      processedMessageIds: [],
      validationIssues: [],
      mappingCardDelivery: { messageId: "message-1", revision: 1 },
    } as unknown as CouponThreeSourcePilotDraft;

    await expect(
      getRecentCouponAiDiagnostics({
        database: database as never,
        getDraft: vi.fn(async () => draft),
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        status: "succeeded",
        requestRecorded: true,
        responseRecorded: true,
        activityCopyCandidateKeys: ["activityName", "activityBackground"],
        draftProjection: expect.objectContaining({
          sameRun: true,
          primary: true,
          activityCopyEnabled: true,
          renderedActivityName: true,
          renderedActivityBackground: true,
        }),
      }),
    ]);
  });
});
