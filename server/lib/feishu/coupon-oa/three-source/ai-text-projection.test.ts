import { describe, expect, it, vi } from "vitest";
import type { CouponAiTextRun } from "../../../control-plane/postgres-coupon-ai-text-repository";
import { createCouponThreeSourceTask } from "../../../coupon-oa/three-source/task";
import { createCouponAiTextProjector } from "./ai-text-projection";
import type { CouponThreeSourcePilotDraft } from "./store";

function draft(): CouponThreeSourcePilotDraft {
  const task = createCouponThreeSourceTask({
    taskId: "task-1",
    ownerOpenId: "ou-owner",
  });
  task.revision = 2;
  return {
    recordId: "record-1",
    pilotId: "pilot-1",
    ownerOpenId: "ou-owner",
    task,
    schemaVersion: "coupon-three-source-pilot-v2",
    recognitions: {},
    supplementRecognition: {
      text: "活动名称是双十一严选优惠券申请，活动背景是双十一优惠活动",
      textSha256: "a".repeat(64),
      runId: "run-text",
      revision: 2,
      status: "pending",
    },
    selections: {
      ownerFieldValues: {
        activityName: "业务员已填写的活动名称",
        activityBackground: "",
      },
    },
    artifacts: [],
    processedMessageIds: [],
    validationIssues: [],
  };
}

function run(): CouponAiTextRun {
  return {
    id: "run-text",
    semanticKey: "semantic-text",
    pilotRecordId: "record-1",
    businessTaskId: "task-1",
    ownerOpenId: "ou-owner",
    revision: 2,
    supplementText: "活动名称是双十一严选优惠券申请，活动背景是双十一优惠活动",
    textSha256: "a".repeat(64),
    provider: "deepseek",
    model: "deepseek-chat",
    promptVersion: "coupon-three-source-p0-supplement-v1",
    status: "succeeded",
    result: {
      fields: {
        activityName: "AI 活动名称",
        activityBackground: "AI 活动背景",
      },
      warnings: [],
    },
    audit: {
      provider: "deepseek",
      model: "deepseek-chat",
      promptVersion: "coupon-three-source-p0-supplement-v1",
      status: "succeeded",
      startedAt: "2026-10-12T00:00:00.000Z",
      completedAt: "2026-10-12T00:00:01.000Z",
      durationMs: 1000,
    },
  };
}

describe("coupon AI supplement projection", () => {
  it("fills blank fields without overwriting owner-confirmed values", async () => {
    let current = draft();
    const deliverMappingCard = vi.fn(async ({ draft: delivered }) => delivered);
    const projector = createCouponAiTextProjector({
      getDraft: vi.fn(async () => current),
      updateDraft: vi.fn(async (_draft, updates) => {
        current = { ...current, ...updates };
        return current;
      }) as never,
      deliverMappingCard,
    });

    await projector.project({ run: run(), idempotencyKey: "effect-text" });

    expect(current.selections.ownerFieldValues).toMatchObject({
      activityName: "业务员已填写的活动名称",
      activityBackground: "AI 活动背景",
    });
    expect(deliverMappingCard).toHaveBeenCalledOnce();
  });

  it("replaces only invalid form fields and keeps unresolved validation issues", async () => {
    let current = draft();
    const supplementRecognition = current.supplementRecognition;
    if (!supplementRecognition)
      throw new Error("supplement fixture is missing");
    current.supplementRecognition = {
      ...supplementRecognition,
      kind: "form_repair",
      replaceOwnerFieldKeys: ["activityStartAt", "businessMode"],
    };
    current.selections.ownerFieldValues = {
      activityStartAt: "2026年9月30日",
      businessMode: "无法判断",
      activityName: "业务员活动名称",
    };
    current.validationIssues = [
      "输入校验[activityStartAt]：日期格式错误",
      "输入校验[businessMode]：业务模式无法确认",
    ];
    const correctedRun = run();
    correctedRun.result = {
      fields: { activityStartAt: "2026-09-30" },
      warnings: [],
    };
    const projector = createCouponAiTextProjector({
      getDraft: vi.fn(async () => current),
      updateDraft: vi.fn(async (_draft, updates) => {
        current = { ...current, ...updates };
        return current;
      }) as never,
      deliverMappingCard: vi.fn(async ({ draft: delivered }) => delivered),
    });

    await projector.project({
      run: correctedRun,
      idempotencyKey: "effect-repair",
    });

    expect(current.selections.ownerFieldValues).toMatchObject({
      activityStartAt: "2026-09-30",
      businessMode: "无法判断",
      activityName: "业务员活动名称",
    });
    expect(current.validationIssues).toEqual([
      "输入校验[businessMode]：业务模式无法确认",
    ]);
  });
});
