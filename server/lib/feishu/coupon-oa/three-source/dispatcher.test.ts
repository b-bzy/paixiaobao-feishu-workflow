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
  checkActiveOa?: boolean;
  checkActiveExcel?: boolean;
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
    shouldCheckActiveOa: () => input.checkActiveOa ?? true,
    shouldCheckActiveExcel: () => input.checkActiveExcel ?? true,
    assertUserAllowed: () => undefined,
    createService,
    getDraft: async () => current[0] ?? draft(),
    listActiveThreeSource: async () => current,
    listActiveOa: vi.fn(async () => input.activeOa ?? []),
    listActiveExcel: vi.fn(async () => input.activeExcel ?? []),
    getMessageBody: vi.fn(),
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

  it("does not query inactive legacy stores before starting three-source", async () => {
    const opened = draft();
    const startOrResume = vi.fn(async () => opened);
    const { values } = dependencies({
      checkActiveOa: false,
      checkActiveExcel: false,
      service: { startOrResume },
    });
    values.listActiveOa = vi.fn(async () => {
      throw new Error("Feishu Base POC is not configured");
    });
    values.listActiveExcel = vi.fn(async () => {
      throw new Error("Feishu Base POC is not configured");
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchText({
        openId: "ou_owner",
        text: "/OA优惠券提报",
      }),
    ).resolves.toMatchObject({
      handled: true,
      message: "Coupon three-source pilot CTS-pilot opened",
    });
    expect(values.listActiveOa).not.toHaveBeenCalled();
    expect(values.listActiveExcel).not.toHaveBeenCalled();
  });

  it("clears every active three-source draft without deleting its audit record", async () => {
    const first = draft();
    const second = {
      ...draft(),
      recordId: "rec-three-source-2",
      pilotId: "CTS-pilot-2",
    };
    const cancel: CouponThreeSourcePilotService["cancel"] = vi.fn(
      async (input) => ({
        ...input.draft,
        task: { ...input.draft.task, status: "Canceled" },
      }),
    );
    const { values, sendCard } = dependencies({
      activeThreeSource: [first, second],
      service: { cancel },
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchText({
        openId: "ou_owner",
        text: "/clear",
        idempotencyKey: "event-clear",
      }),
    ).resolves.toMatchObject({
      handled: true,
      message: "Cleared 2 active coupon three-source pilots",
    });
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        draft: first,
        ownerOpenId: "ou_owner",
        expectedRevision: first.task.revision,
      }),
    );
    expect(values.listActiveOa).not.toHaveBeenCalled();
    expect(values.listActiveExcel).not.toHaveBeenCalled();
    expect(JSON.stringify(sendCard.mock.calls[0]?.[1])).toContain(
      "当前三源提报已清空",
    );
  });

  it("treats repeated clear commands as an idempotent success", async () => {
    const cancel = vi.fn();
    const { values, sendCard } = dependencies({
      activeThreeSource: [],
      service: { cancel },
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchText({ openId: "ou_owner", text: " / c l e a r " }),
    ).resolves.toMatchObject({
      handled: true,
      message: "No active coupon three-source pilot to clear",
    });
    expect(cancel).not.toHaveBeenCalled();
    expect(JSON.stringify(sendCard.mock.calls[0]?.[1])).toContain(
      "当前已是清空状态",
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
    expect(values.getMessageBody).not.toHaveBeenCalled();
    expect(values.downloadFile).not.toHaveBeenCalled();
  });

  it("resolves a long-connection file through its original message body", async () => {
    const current = draft();
    const receiveSource: CouponThreeSourcePilotService["receiveSource"] = vi.fn(
      async (input) => ({
        ...current,
        task: {
          ...current.task,
          sources: {
            couponTable: {
              role: "couponTable" as const,
              bytes: input.bytes.byteLength,
              fileKey: input.fileKey,
              fileName: input.fileName,
              messageId: input.messageId,
              sha256: "a".repeat(64),
            },
          },
        },
      }),
    );
    const { values } = dependencies({
      activeThreeSource: [current],
      service: { receiveSource },
    });
    vi.mocked(values.getMessageBody).mockResolvedValue({
      messageType: "file",
      content: JSON.stringify({
        file_key: "file-from-message",
        file_name: "业务白名单.xlsx",
      }),
    });
    vi.mocked(values.downloadFile).mockResolvedValue(new Uint8Array([1, 2]));
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchFile({
        openId: "ou_owner",
        messageId: "om-from-cli",
      }),
    ).resolves.toMatchObject({ handled: true });

    expect(values.getMessageBody).toHaveBeenCalledWith({
      messageId: "om-from-cli",
    });
    expect(values.downloadFile).toHaveBeenCalledWith({
      messageId: "om-from-cli",
      fileKey: "file-from-message",
      type: "file",
    });
    expect(receiveSource).toHaveBeenCalledWith(
      expect.objectContaining({
        fileKey: "file-from-message",
        fileName: "业务白名单.xlsx",
      }),
    );
  });

  it("keeps a single progress card while consecutive sources are pending", async () => {
    const current = draft();
    current.recognitions.couponTable = {
      source: {
        messageId: "om-coupon",
        fileKey: "file-coupon",
        fileName: "coupon.xlsx",
        bytes: 10,
        sha256: "a".repeat(64),
      },
      sourceHash: "a".repeat(64),
      roleCandidates: [],
      couponFieldCandidates: {},
      listCandidates: [],
      issues: [],
      ai: {
        runId: "run-coupon",
        revision: current.task.revision,
        sourceSha256: "a".repeat(64),
        status: "pending",
      },
    };
    const receiveSource: CouponThreeSourcePilotService["receiveSource"] = vi.fn(
      async () => ({
        ...current,
        recognitions: {
          ...current.recognitions,
          whitelist: {
            source: {
              messageId: "om-whitelist",
              fileKey: "file-whitelist",
              fileName: "whitelist.xlsx",
              bytes: 10,
              sha256: "b".repeat(64),
            },
            sourceHash: "b".repeat(64),
            roleCandidates: [],
            couponFieldCandidates: {},
            listCandidates: [],
            issues: [],
            ai: {
              runId: "run-whitelist",
              revision: current.task.revision,
              sourceSha256: "b".repeat(64),
              status: "pending" as const,
            },
          },
        },
      }),
    );
    const { values, sendCard } = dependencies({
      activeThreeSource: [current],
      service: { receiveSource },
    });
    vi.mocked(values.downloadFile).mockResolvedValue(new Uint8Array([1, 2]));
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchFile({
        openId: "ou_owner",
        messageId: "om-whitelist",
        fileKey: "file-whitelist",
        fileName: "whitelist.xlsx",
      }),
    ).resolves.toMatchObject({ handled: true });

    expect(sendCard).not.toHaveBeenCalled();
  });

  it("starts one batch from the original intake card at the current revision", async () => {
    const current = draft();
    current.task.revision = 3;
    const couponSource = {
      role: "couponTable" as const,
      messageId: "om-coupon",
      fileKey: "file-coupon",
      fileName: "coupon.xlsx",
      bytes: 10,
      sha256: "a".repeat(64),
    };
    const whitelistSource = {
      role: "whitelist" as const,
      messageId: "om-whitelist",
      fileKey: "file-whitelist",
      fileName: "whitelist.xlsx",
      bytes: 10,
      sha256: "b".repeat(64),
    };
    current.task.sources = {
      couponTable: couponSource,
      whitelist: whitelistSource,
    };
    current.recognitions = {
      couponTable: {
        source: couponSource,
        sourceHash: "a".repeat(64),
        roleCandidates: [],
        couponFieldCandidates: {},
        listCandidates: [],
        issues: [],
        ai: {
          runId: "run-coupon",
          revision: current.task.revision,
          sourceSha256: "a".repeat(64),
          status: "pending",
        },
      },
      whitelist: {
        source: whitelistSource,
        sourceHash: "b".repeat(64),
        roleCandidates: [],
        couponFieldCandidates: {},
        listCandidates: [],
        issues: [],
        ai: {
          runId: "run-whitelist",
          revision: current.task.revision,
          sourceSha256: "b".repeat(64),
          status: "pending",
        },
      },
    };
    const startAiRecognition: CouponThreeSourcePilotService["startAiRecognition"] =
      vi.fn(async () => current);
    const { values, sendCard } = dependencies({
      activeThreeSource: [current],
      service: { startAiRecognition },
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchCallback({
        openId: "ou_owner",
        action: "coupon_three_source_recognition_start",
        value: {
          pilotRecordId: current.recordId,
          revision: 1,
        },
        idempotencyKey: "event-start-ai",
      }),
    ).resolves.toMatchObject({ handled: true });

    expect(startAiRecognition).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: current,
        expectedRevision: 3,
        operationId: "event-start-ai",
      }),
    );
    expect(JSON.stringify(sendCard.mock.calls[0]?.[1])).toContain("AI 识别中");
  });

  it("queues supplement recognition from the revisioned form button", async () => {
    const current = draft();
    current.task.revision = 4;
    const recognized = {
      ...current,
      supplementRecognition: {
        text: "活动点位 5%，业务模式 POP",
        textSha256: "a".repeat(64),
        runId: "run-supplement",
        revision: 4,
        status: "pending" as const,
      },
    };
    const startSupplementRecognition: CouponThreeSourcePilotService["startSupplementRecognition"] =
      vi.fn(async () => recognized);
    const { values } = dependencies({
      activeThreeSource: [current],
      service: { startSupplementRecognition },
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchCallback({
        openId: "ou_owner",
        action:
          "coupon_three_source_supplement_recognition_start:rec-three-source:4",
        form: {
          supplementText: "活动点位 5%，业务模式 POP",
        },
        idempotencyKey: "event-supplement",
      }),
    ).resolves.toMatchObject({
      handled: true,
      message: "Coupon supplement recognition queued run-supplement",
    });

    expect(startSupplementRecognition).toHaveBeenCalledWith({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: 4,
      operationId: "event-supplement",
      text: "活动点位 5%，业务模式 POP",
    });
  });

  it("confirms no blacklist inside the single mapping submission", async () => {
    const current = draft();
    current.task.revision = 5;
    current.task.sources = {
      couponTable: {
        role: "couponTable",
        messageId: "om-coupon",
        fileKey: "file-coupon",
        fileName: "coupon.xlsx",
        bytes: 10,
        sha256: "a".repeat(64),
      },
      whitelist: {
        role: "whitelist",
        messageId: "om-whitelist",
        fileKey: "file-whitelist",
        fileName: "whitelist.xlsx",
        bytes: 10,
        sha256: "b".repeat(64),
      },
    };
    const confirmed = {
      ...current,
      task: {
        ...current.task,
        revision: 6,
        blacklistStatus: "absent_confirmed" as const,
      },
    };
    const confirmNoBlacklist: CouponThreeSourcePilotService["confirmNoBlacklist"] =
      vi.fn(async () => confirmed);
    const updated = {
      ...confirmed,
      task: { ...confirmed.task, revision: 7 },
    };
    const updateSelections: CouponThreeSourcePilotService["updateSelections"] =
      vi.fn(async () => updated);
    const confirmSourcesAndGenerate: CouponThreeSourcePilotService["confirmSourcesAndGenerate"] =
      vi.fn(async () => ({
        ...updated,
        task: {
          ...updated.task,
          status: "AwaitingFinalConfirmation" as const,
        },
      }));
    const { values } = dependencies({
      activeThreeSource: [current],
      service: {
        confirmNoBlacklist,
        updateSelections,
        confirmSourcesAndGenerate,
      },
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await dispatcher.dispatchCallback({
      openId: "ou_owner",
      action: `coupon_three_source_mapping_confirm:${current.recordId}:5`,
      form: {
        activityPointPercent: "6",
        blacklistDecision: "absent_confirmed",
      },
    });

    expect(confirmNoBlacklist).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 5 }),
    );
    expect(updateSelections).toHaveBeenCalledWith(
      expect.objectContaining({ draft: confirmed, expectedRevision: 6 }),
    );
    expect(confirmSourcesAndGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ draft: updated, expectedRevision: 7 }),
    );
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

  it("persists the over-deduction choice and redraws the conditional reason field", async () => {
    const current = draft();
    current.task.revision = 5;
    current.task.status = "AwaitingSourceConfirmation";
    const source = {
      messageId: "om-source",
      fileKey: "file-source",
      fileName: "source.xlsx",
      bytes: 10,
      sha256: "a".repeat(64),
    };
    current.task.sources = {
      couponTable: { role: "couponTable", ...source },
      whitelist: { role: "whitelist", ...source },
    };
    const updateSelections: CouponThreeSourcePilotService["updateSelections"] =
      vi.fn(async (input) => ({
        ...current,
        selections: {
          ...current.selections,
          ...input.selections,
          ownerFieldValues: {
            ...current.selections.ownerFieldValues,
            ...input.selections.ownerFieldValues,
          },
        },
      }));
    const { values, sendCard } = dependencies({
      activeThreeSource: [current],
      service: { updateSelections },
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchCallback({
        openId: "ou_owner",
        action: "coupon_three_source_over_deduction_select",
        value: {
          pilotRecordId: current.recordId,
          revision: 5,
          decision: "是",
        },
      }),
    ).resolves.toMatchObject({
      handled: true,
      message:
        "Coupon three-source action coupon_three_source_over_deduction_select completed",
    });

    expect(updateSelections).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 5,
        selections: { ownerFieldValues: { overDeduction: "是" } },
      }),
    );
    expect(JSON.stringify(sendCard.mock.calls[0]?.[1])).toContain(
      '"name":"owner_overDeductionReason"',
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
