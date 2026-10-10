import { describe, expect, it, vi } from "vitest";
import { createCouponThreeSourceTask } from "../../../coupon-oa/three-source/task";
import {
  type CouponThreeSourceDispatcherDependencies,
  createCouponThreeSourceDispatcher,
} from "./dispatcher";
import type { CouponThreeSourcePilotService } from "./service";
import type { CouponThreeSourcePilotDraft } from "./store";

function draft(): CouponThreeSourcePilotDraft {
  return {
    recordId: "rec-three-source",
    pilotId: "CTS-pilot",
    ownerOpenId: "ou_owner",
    task: createCouponThreeSourceTask({
      taskId: "CTS-task",
      ownerOpenId: "ou_owner",
    }),
    schemaVersion: "coupon-three-source-pilot-v1",
    recognitions: {},
    selections: {},
    artifacts: [],
    processedMessageIds: [],
    validationIssues: [],
  };
}

function dependencies(input: {
  enabled?: boolean;
  service?: Partial<CouponThreeSourcePilotService>;
  activeThreeSource?: CouponThreeSourcePilotDraft[];
  activeOa?: Array<{ recordId: string }>;
  activeExcel?: Array<{ recordId: string }>;
}) {
  const sendCard = vi.fn(
    async (_openId: string, _card: unknown, _idempotencyKey?: string) =>
      undefined,
  );
  const createService = vi.fn(
    () =>
      ({
        startOrResume: vi.fn(async () => draft()),
        ...input.service,
      }) as unknown as CouponThreeSourcePilotService,
  );
  const current = input.activeThreeSource ?? [];
  const values: CouponThreeSourceDispatcherDependencies = {
    isPilotEnabled: () => input.enabled ?? true,
    isCouponOaEnabled: () => true,
    isCouponOaDraftDemo: () => false,
    assertUserAllowed: () => undefined,
    createService,
    getDraft: async () => current[0] ?? draft(),
    listActiveThreeSource: async () => current,
    listActiveOa: async () => input.activeOa ?? [],
    listActiveExcel: async () => input.activeExcel ?? [],
    downloadFile: vi.fn(),
    sendCard,
    getOaDraft: vi.fn(),
  };
  return { values, sendCard };
}

describe("three-source Bot dispatcher", () => {
  it("fails closed without reading workflow state while the pilot flag is off", async () => {
    const { values, sendCard } = dependencies({ enabled: false });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchText({ openId: "ou_owner", text: "/OA优惠券提报" }),
    ).resolves.toMatchObject({
      handled: true,
      message: "Coupon three-source pilot is unavailable",
    });
    expect(values.createService).not.toHaveBeenCalled();
    expect(sendCard).toHaveBeenCalledWith(
      "ou_owner",
      expect.objectContaining({ schema: "2.0" }),
      undefined,
    );
  });

  it("opens one collecting task only when the pilot and existing OA route are enabled", async () => {
    const opened = draft();
    const startOrResume = vi.fn(async () => opened);
    const { values, sendCard } = dependencies({
      service: { startOrResume },
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchText({
        openId: "ou_owner",
        text: " / OA 优 惠 券 提 报 ",
        idempotencyKey: "event-start",
      }),
    ).resolves.toMatchObject({
      handled: true,
      message: "Coupon three-source pilot CTS-pilot opened",
    });

    expect(startOrResume).toHaveBeenCalledWith("ou_owner");
    expect(sendCard).toHaveBeenCalledWith(
      "ou_owner",
      expect.objectContaining({ schema: "2.0" }),
      "event-start",
    );
    expect(JSON.stringify(sendCard.mock.calls[0]?.[1])).toContain(
      "收集三源材料",
    );
  });

  it("does not consume ordinary file messages without an active three-source task", async () => {
    const { values } = dependencies({ activeThreeSource: [] });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchFile({
        openId: "ou_owner",
        messageId: "om-file",
        fileKey: "file-key",
        fileName: "白名单.xlsx",
      }),
    ).resolves.toEqual({ handled: false });
    expect(values.downloadFile).not.toHaveBeenCalled();
  });

  it("passes mapping choices to the revisioned service before generating artifacts", async () => {
    const current = draft();
    const source = {
      messageId: "om-source",
      fileKey: "file-source",
      fileName: "source.xlsx",
      bytes: 10,
      sha256: "a".repeat(64),
    };
    current.task = {
      ...current.task,
      revision: 5,
      status: "AwaitingSourceConfirmation",
      sources: {
        couponTable: { role: "couponTable", ...source },
        whitelist: { role: "whitelist", ...source },
      },
      blacklistStatus: "absent_confirmed",
    };
    const updateSelections: CouponThreeSourcePilotService["updateSelections"] =
      vi.fn(async (input) => ({
        ...current,
        task: { ...current.task, revision: 6 },
        selections: input.selections,
      }));
    const confirmSourcesAndGenerate: CouponThreeSourcePilotService["confirmSourcesAndGenerate"] =
      vi.fn(async (input) => ({
        ...input.draft,
        task: { ...input.draft.task, status: "AwaitingFinalConfirmation" },
      }));
    const { values, sendCard } = dependencies({
      activeThreeSource: [current],
      service: { updateSelections, confirmSourcesAndGenerate },
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchCallback({
        openId: "ou_owner",
        action: "coupon_three_source_mapping_confirm:rec-three-source:5",
        form: { activityPointPercent: "6" },
      }),
    ).resolves.toMatchObject({
      handled: true,
      message:
        "Coupon three-source action coupon_three_source_mapping_confirm completed",
    });

    expect(updateSelections).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 5,
        selections: expect.objectContaining({ activityPointPercent: 6 }),
      }),
    );
    expect(confirmSourcesAndGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 6 }),
    );
    expect(JSON.stringify(sendCard.mock.calls[0]?.[1])).toContain(
      "标准附件已生成",
    );
  });

  it("rejects a three-source start when another coupon workflow remains active", async () => {
    const { values, sendCard } = dependencies({
      activeOa: [{ recordId: "rec-oa" }],
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchText({ openId: "ou_owner", text: "OA优惠券提报" }),
    ).resolves.toMatchObject({
      handled: true,
      message: "当前存在未完成的优惠券 OA 草稿，不能同时启动三源提报",
    });
    expect(values.createService).not.toHaveBeenCalled();
    expect(JSON.stringify(sendCard.mock.calls[0]?.[1])).toContain(
      "未完成的优惠券 OA 草稿",
    );
  });
});
