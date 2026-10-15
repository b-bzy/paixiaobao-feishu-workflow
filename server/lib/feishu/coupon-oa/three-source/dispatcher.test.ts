import { describe, expect, it, vi } from "vitest";
import { RegularFullReductionFieldError } from "../../../coupon-oa/three-source/recognition";
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
    schemaVersion: "coupon-three-source-pilot-v2",
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
  getOaDraft?: CouponThreeSourceDispatcherDependencies["getOaDraft"];
}) {
  const sendCard = vi.fn(
    async (_openId: string, _card: unknown, _idempotencyKey?: string) =>
      undefined,
  );
  const deliverMappingCard = vi.fn(async ({ draft }) => draft);
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
    deliverMappingCard,
    getOaDraft: input.getOaDraft ?? vi.fn(),
  };
  return { values, sendCard, deliverMappingCard };
}

describe("three-source Bot dispatcher", () => {
  it("goes straight from final confirmation to the merged send card", async () => {
    const confirmed = {
      ...draft(),
      task: {
        ...draft().task,
        revision: 5,
        status: "DraftOnlyConfirmed" as const,
      },
      oaDraftRecordId: "rec-oa-new",
    };
    const next = { ...confirmed, oaDraftRecordId: "rec-oa-new" };
    const confirmFinalPreview: CouponThreeSourcePilotService["confirmFinalPreview"] =
      vi.fn(async () => next);
    const getOaDraft = vi.fn(async () => ({
      recordId: "rec-oa-new",
      draftId: "COA-new",
      values: {
        applicationType: "优惠券申请",
        businessMode: "寄卖",
        activityName: "测试活动",
        activityBackground: "测试背景",
        overDeduction: "否",
        estimatedGmvYuan: 10_000,
        estimatedCostYuan: 100,
        channels: ["京东渠道"],
        activityStartAt: "2030-01-01",
        activityEndAt: "2030-01-01",
        calcImageFileCodes: ["img"],
        couponTableFileCodes: ["coupon"],
        productWhitelistFileCodes: ["white"],
      },
      attachments: [],
    })) as unknown as CouponThreeSourceDispatcherDependencies["getOaDraft"];
    const { values, sendCard } = dependencies({
      activeThreeSource: [
        {
          ...confirmed,
          task: {
            ...confirmed.task,
            status: "AwaitingFinalConfirmation" as const,
          },
        },
      ],
      service: { confirmFinalPreview },
      getOaDraft,
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchCallback({
        openId: "ou_owner",
        action: "coupon_three_source_final_confirm",
        value: { pilotRecordId: confirmed.recordId, revision: 5 },
      }),
    ).resolves.toMatchObject({
      handled: true,
      message: "Coupon three-source pilot created OA draft",
    });

    const card = JSON.stringify(sendCard.mock.calls[0]?.[1]);
    expect(card).toContain("确认提交正式优惠券 OA");
    expect(card).toContain("第 4 步");
    expect(card).toContain("放弃本次提交");
    expect(card).not.toContain("优惠券 OA 预填确认");
  });

  it("re-delivers the submit card when a completed pilot card is clicked again", async () => {
    const completed = {
      ...draft(),
      task: {
        ...draft().task,
        revision: 6,
        status: "DraftOnlyConfirmed" as const,
      },
      oaDraftRecordId: "rec-oa-settled",
    };
    const getOaDraft = vi.fn(async () => ({
      recordId: "rec-oa-settled",
      draftId: "COA-settled",
      values: {
        applicationType: "优惠券申请",
        businessMode: "寄卖",
        activityName: "测试活动",
        activityBackground: "测试背景",
        overDeduction: "否",
        estimatedGmvYuan: 10_000,
        estimatedCostYuan: 100,
        channels: ["京东渠道"],
        activityStartAt: "2030-01-01",
        activityEndAt: "2030-01-01",
        calcImageFileCodes: ["img"],
        couponTableFileCodes: ["coupon"],
        productWhitelistFileCodes: ["white"],
      },
      attachments: [],
    })) as unknown as CouponThreeSourceDispatcherDependencies["getOaDraft"];
    const { values, sendCard } = dependencies({
      activeThreeSource: [completed],
      getOaDraft,
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchCallback({
        openId: "ou_owner",
        action: "coupon_three_source_final_confirm",
        value: { pilotRecordId: completed.recordId, revision: 6 },
      }),
    ).resolves.toMatchObject({
      handled: true,
      message: expect.stringContaining("already completed"),
    });

    const card = JSON.stringify(sendCard.mock.calls[0]?.[1]);
    expect(card).toContain("第 4 步");
    expect(card).not.toContain("cannot be changed");
  });

  it("rejects card actions while standard artifacts are generating", async () => {
    const generating = {
      ...draft(),
      task: {
        ...draft().task,
        revision: 4,
        status: "GeneratingArtifacts" as const,
      },
    };
    const updateSelections = vi.fn();
    const { values, sendCard } = dependencies({
      activeThreeSource: [generating],
      service: { updateSelections },
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchCallback({
        openId: "ou_owner",
        action: "coupon_three_source_mapping_confirm:rec-three-source:4",
        form: {},
        idempotencyKey: "evt-double-click",
      }),
    ).resolves.toMatchObject({
      handled: true,
      message: "三源标准产物正在生成，请等待最新卡片完成后再操作",
    });
    expect(updateSelections).not.toHaveBeenCalled();
    expect(sendCard).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sendCard.mock.calls[0][1])).toContain(
      "三源标准产物正在生成",
    );
  });

  it("rejects file intake while standard artifacts are generating", async () => {
    const generating = {
      ...draft(),
      task: {
        ...draft().task,
        revision: 4,
        status: "GeneratingArtifacts" as const,
      },
    };
    const { values, sendCard } = dependencies({
      activeThreeSource: [generating],
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchFile({
        openId: "ou_owner",
        messageId: "om-late-upload",
        fileKey: "file-late",
        fileName: "配券型号表-late.xlsx",
        idempotencyKey: "evt-late-upload",
      }),
    ).resolves.toMatchObject({
      handled: true,
      message: "三源标准产物正在生成，请等待最新卡片完成后再上传材料",
    });
    expect(sendCard).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sendCard.mock.calls[0][1])).toContain(
      "三源标准产物正在生成",
    );
  });

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

  it("cascades /clear to pilot OA drafts but leaves other routes alone", async () => {
    const cancel: CouponThreeSourcePilotService["cancel"] = vi.fn(
      async (input) => ({
        ...input.draft,
        task: { ...input.draft.task, status: "Canceled" },
      }),
    );
    const cancelOaDraft = vi.fn(
      async (oaDraft: { recordId: string }) => oaDraft,
    ) as unknown as NonNullable<
      CouponThreeSourceDispatcherDependencies["cancelOaDraft"]
    >;
    const oaDrafts = new Map([
      [
        "rec-oa-pilot",
        {
          recordId: "rec-oa-pilot",
          ownerOpenId: "ou_owner",
          schemaVersion: "coupon-three-source-pilot-v1",
          status: "Confirmed",
        },
      ],
      [
        "rec-oa-legacy",
        {
          recordId: "rec-oa-legacy",
          ownerOpenId: "ou_owner",
          schemaVersion: "coupon-oa-submit-schema-v1",
          status: "Draft",
        },
      ],
      [
        "rec-oa-submitting",
        {
          recordId: "rec-oa-submitting",
          ownerOpenId: "ou_owner",
          schemaVersion: "coupon-three-source-pilot-v1",
          status: "Submitting",
        },
      ],
    ]);
    const getOaDraft = vi.fn(async (recordId: string) =>
      oaDrafts.get(recordId),
    ) as unknown as CouponThreeSourceDispatcherDependencies["getOaDraft"];
    const { values, sendCard } = dependencies({
      activeThreeSource: [],
      activeOa: [...oaDrafts.keys()].map((recordId) => ({ recordId })),
      service: { cancel },
      getOaDraft,
    });
    const dispatcher = createCouponThreeSourceDispatcher({
      ...values,
      cancelOaDraft,
    });

    await expect(
      dispatcher.dispatchText({ openId: "ou_owner", text: "/clear" }),
    ).resolves.toMatchObject({
      handled: true,
      message: "No active coupon three-source pilot to clear",
    });

    expect(cancelOaDraft).toHaveBeenCalledTimes(1);
    expect(cancelOaDraft).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: "rec-oa-pilot" }),
    );
    expect(JSON.stringify(sendCard.mock.calls[0]?.[1])).toContain(
      "同时关闭了 1 张本次试点交接的 OA 草稿",
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

  it("accepts a direct Feishu image resource for an active task", async () => {
    const current = draft();
    const receiveCalcImage: CouponThreeSourcePilotService["receiveCalcImage"] =
      vi.fn(async () => current);
    const { values } = dependencies({
      activeThreeSource: [current],
      service: { receiveCalcImage },
    });
    values.downloadResource = vi.fn(
      async () => new Uint8Array([137, 80, 78, 71]),
    );
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchResource({
        openId: "ou_owner",
        messageId: "om-image",
        resourceType: "image",
        fileKey: "img-key",
      }),
    ).resolves.toMatchObject({ handled: true });
    expect(values.downloadResource).toHaveBeenCalledWith({
      messageId: "om-image",
      resourceKey: "img-key",
      type: "image",
    });
    expect(receiveCalcImage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "om-image",
        resourceKey: "img-key",
        resourceType: "image",
      }),
    );
  });

  it("rejects unsupported spreadsheets before download or image parsing", async () => {
    const current = draft();
    const receiveSource = vi.fn();
    const receiveCalcImage = vi.fn();
    const { values, sendCard } = dependencies({
      activeThreeSource: [current],
      service: { receiveSource, receiveCalcImage },
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchFile({
        openId: "ou_owner",
        messageId: "om-xls",
        fileKey: "file-xls",
        fileName: "配券表.xls",
      }),
    ).resolves.toEqual({
      handled: true,
      message: "当前只支持 .xlsx 文件，请转换格式后重新上传。",
    });

    expect(values.downloadFile).not.toHaveBeenCalled();
    expect(receiveSource).not.toHaveBeenCalled();
    expect(receiveCalcImage).not.toHaveBeenCalled();
    expect(JSON.stringify(sendCard.mock.calls[0]?.[1])).toContain(
      "当前只支持 .xlsx 文件",
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
        owner_businessMode: "寄卖",
        owner_activityName: "测试活动",
        owner_activityBackground: "测试背景",
        owner_activityStartAt: "2026-09-30",
        owner_activityEndAt: "2026-10-10",
        owner_overDeduction: "否",
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

  it("reverts a failed generation and re-delivers the form instead of bricking the draft", async () => {
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
    current.task.blacklistStatus = "absent_confirmed";
    const updated = {
      ...current,
      task: { ...current.task, revision: 6 },
    };
    const updateSelections: CouponThreeSourcePilotService["updateSelections"] =
      vi.fn(async () => updated);
    const confirmSourcesAndGenerate: CouponThreeSourcePilotService["confirmSourcesAndGenerate"] =
      vi.fn(async () => {
        throw new Error(
          "Feishu Drive file upload failed: parent node not exist",
        );
      });
    const recovered = {
      ...updated,
      task: {
        ...updated.task,
        status: "AwaitingSourceConfirmation" as const,
        revision: 7,
      },
    };
    const recoverFailedGeneration: CouponThreeSourcePilotService["recoverFailedGeneration"] =
      vi.fn(async () => recovered);
    const recordGenerationFailure: CouponThreeSourcePilotService["recordGenerationFailure"] =
      vi.fn(async (input) => ({
        ...input.draft,
        failureReason: input.failure.message,
      }));
    const { values, sendCard, deliverMappingCard } = dependencies({
      activeThreeSource: [current],
      service: {
        updateSelections,
        confirmSourcesAndGenerate,
        recoverFailedGeneration,
        recordGenerationFailure,
      },
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchCallback({
        openId: "ou_owner",
        action: `coupon_three_source_mapping_confirm:${current.recordId}:5`,
        form: {
          activityPointPercent: "6",
          owner_businessMode: "寄卖",
          owner_activityName: "测试活动",
          owner_activityBackground: "测试背景",
          owner_activityStartAt: "2026-09-30",
          owner_activityEndAt: "2026-10-10",
          owner_overDeduction: "否",
        },
      }),
    ).resolves.toMatchObject({
      handled: true,
      message: "系统未完成本次处理，已保留当前材料，请稍后重试或联系处理。",
    });

    expect(recoverFailedGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 6 }),
    );
    expect(recordGenerationFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: recovered,
        failure: expect.objectContaining({
          message: "系统未完成本次处理，已保留当前材料，请稍后重试或联系处理。",
        }),
      }),
    );
    expect(deliverMappingCard).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({
          task: expect.objectContaining({
            status: "AwaitingSourceConfirmation",
            revision: 7,
          }),
          failureReason:
            "系统未完成本次处理，已保留当前材料，请稍后重试或联系处理。",
        }),
      }),
    );
    // The restored form card carries the failure banner, so no dead-end
    // error card may bury it.
    expect(sendCard).not.toHaveBeenCalled();
  });

  it("restores the form with per-field issues when validation fails before the generating marker", async () => {
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
    current.task.blacklistStatus = "absent_confirmed";
    const updated = { ...current, task: { ...current.task, revision: 6 } };
    const updateSelections: CouponThreeSourcePilotService["updateSelections"] =
      vi.fn(async () => updated);
    const confirmSourcesAndGenerate: CouponThreeSourcePilotService["confirmSourcesAndGenerate"] =
      vi.fn(async () => {
        throw new RegularFullReductionFieldError([
          {
            key: "totalQuantity",
            message:
              "未识别到「申请总数量」的取值：请检查配券表对应列的表头和数据行是否已填写",
          },
        ]);
      });
    // The status never flipped to GeneratingArtifacts, so recovery is a
    // no-op — the restore must still record and re-deliver the live form.
    const recoverFailedGeneration: CouponThreeSourcePilotService["recoverFailedGeneration"] =
      vi.fn(async () => undefined);
    const recordGenerationFailure: CouponThreeSourcePilotService["recordGenerationFailure"] =
      vi.fn(
        async (
          input: Parameters<
            CouponThreeSourcePilotService["recordGenerationFailure"]
          >[0],
        ) => ({
          ...input.draft,
          failureReason: input.failure.message,
          validationIssues: (input.failure.fieldIssues ?? []).map(
            (issue) => `输入校验[${issue.key}]：${issue.message}`,
          ),
        }),
      );
    const { values, sendCard, deliverMappingCard } = dependencies({
      activeThreeSource: [current],
      service: {
        updateSelections,
        confirmSourcesAndGenerate,
        recoverFailedGeneration,
        recordGenerationFailure,
      },
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchCallback({
        openId: "ou_owner",
        action: `coupon_three_source_mapping_confirm:${current.recordId}:5`,
        form: {
          activityPointPercent: "6",
          owner_businessMode: "寄卖",
          owner_activityName: "测试活动",
          owner_activityBackground: "测试背景",
          owner_activityStartAt: "2026-09-30",
          owner_activityEndAt: "2026-10-10",
          owner_overDeduction: "否",
        },
      }),
    ).resolves.toMatchObject({ handled: true });

    expect(recoverFailedGeneration).toHaveBeenCalled();
    expect(deliverMappingCard).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({
          failureReason: expect.stringContaining("申请总数量"),
          validationIssues: expect.arrayContaining([
            expect.stringContaining("输入校验[totalQuantity]"),
          ]),
        }),
      }),
    );
    expect(sendCard).not.toHaveBeenCalled();
  });

  it("re-renders the persisted state card for the read-only reopen action", async () => {
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
    current.task.blacklistStatus = "absent_confirmed";
    const { values, sendCard, deliverMappingCard } = dependencies({
      activeThreeSource: [current],
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchCallback({
        openId: "ou_owner",
        action: "coupon_three_source_reopen",
        value: { pilotRecordId: current.recordId, revision: 2 },
      }),
    ).resolves.toMatchObject({ handled: true });

    expect(deliverMappingCard).toHaveBeenCalledWith(
      expect.objectContaining({ draft: current }),
    );
    expect(sendCard).not.toHaveBeenCalled();
  });

  it("adds a rollback entry to error cards raised from a known draft callback", async () => {
    const current = draft();
    current.task.revision = 5;
    const { values, sendCard } = dependencies({
      activeThreeSource: [current],
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchCallback({
        openId: "ou_owner",
        action: `coupon_three_source_no_blacklist_confirm:${current.recordId}:4`,
        value: { pilotRecordId: current.recordId, revision: 4 },
      }),
    ).resolves.toMatchObject({
      handled: true,
      message: "当前三源提报版本已变化，请使用最新卡片",
    });

    const errorCard = JSON.stringify(sendCard.mock.calls[0]?.[1]);
    expect(errorCard).toContain("当前三源提报版本已变化");
    expect(errorCard).toContain("coupon_three_source_reopen");
    expect(errorCard).toContain('"pilotRecordId":"rec-three-source"');
  });

  it("freezes the mapping card on submit and restores it when validation fails", async () => {
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
    current.task.blacklistStatus = "absent_confirmed";
    current.mappingCardDelivery = {
      messageId: "om-mapping-card",
      revision: 5,
    };
    const updateCard = vi.fn(
      async (_messageId: string, _card: unknown) => undefined,
    );
    const recoverFailedGeneration: CouponThreeSourcePilotService["recoverFailedGeneration"] =
      vi.fn(async () => undefined);
    const recordGenerationFailure: CouponThreeSourcePilotService["recordGenerationFailure"] =
      vi.fn(
        async (
          input: Parameters<
            CouponThreeSourcePilotService["recordGenerationFailure"]
          >[0],
        ) => ({
          ...input.draft,
          failureReason: input.failure.message,
        }),
      );
    const { values, sendCard, deliverMappingCard } = dependencies({
      activeThreeSource: [current],
      service: { recoverFailedGeneration, recordGenerationFailure },
    });
    values.updateCard = updateCard;
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchCallback({
        openId: "ou_owner",
        action: `coupon_three_source_mapping_confirm:${current.recordId}:5`,
        form: { activityPointPercent: "6" },
      }),
    ).resolves.toMatchObject({
      handled: true,
      message: expect.stringContaining("请先完整填写"),
    });

    // The card must be frozen BEFORE validation so repeat clicks see no
    // button at all…
    expect(updateCard).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(updateCard.mock.calls[0]?.[1])).toContain(
      "标准附件生成中",
    );
    // …and the invalid submit restores the live form with the reason banner
    // instead of leaving only a dead error card.
    expect(recordGenerationFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        failure: expect.objectContaining({
          message: expect.stringContaining("请先完整填写"),
        }),
      }),
    );
    expect(deliverMappingCard).toHaveBeenCalled();
    expect(sendCard).not.toHaveBeenCalled();
  });

  it("sends frozen review artifacts once with the first step-4 send card", async () => {
    const confirmed: CouponThreeSourcePilotDraft = {
      ...draft(),
      task: {
        ...draft().task,
        revision: 5,
        status: "AwaitingFinalConfirmation",
      },
    };
    const next = { ...confirmed, oaDraftRecordId: "rec-oa-new" };
    const confirmFinalPreview: CouponThreeSourcePilotService["confirmFinalPreview"] =
      vi.fn(async () => next);
    const attachments = [
      {
        role: "couponTable" as const,
        fileName: "配券表.xlsx",
        fileCode: "code-coupon",
        fileToken: "tok-coupon",
        sha256: "a".repeat(64),
        order: 0,
      },
      {
        role: "calcImage" as const,
        fileName: "测算图1.png",
        fileCode: "code-image",
        fileToken: "tok-image",
        sha256: "b".repeat(64),
        order: 1,
      },
    ];
    const getOaDraft = vi.fn(async () => ({
      recordId: "rec-oa-new",
      draftId: "COA-new",
      status: "Confirmed",
      values: {
        applicationType: "优惠券申请",
        businessMode: "寄卖",
        activityName: "测试活动",
        activityBackground: "测试背景",
        overDeduction: "否",
        estimatedGmvYuan: 10_000,
        estimatedCostYuan: 100,
        channels: ["京东渠道"],
        activityStartAt: "2030-01-01",
        activityEndAt: "2030-01-01",
        calcImageFileCodes: ["code-image"],
        couponTableFileCodes: ["code-coupon"],
        productWhitelistFileCodes: ["code-white"],
      },
      attachments,
    })) as unknown as CouponThreeSourceDispatcherDependencies["getOaDraft"];
    const sendArtifactMessages = vi.fn(async () => ({
      delivered: ["配券表.xlsx", "测算图1.png"],
      failed: [],
    }));
    const { values, sendCard } = dependencies({
      activeThreeSource: [confirmed],
      service: { confirmFinalPreview },
      getOaDraft,
    });
    values.sendArtifactMessages = sendArtifactMessages;
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchCallback({
        openId: "ou_owner",
        action: "coupon_three_source_final_confirm",
        value: { pilotRecordId: confirmed.recordId, revision: 5 },
      }),
    ).resolves.toMatchObject({
      handled: true,
      message: "Coupon three-source pilot created OA draft",
    });
    expect(sendArtifactMessages).toHaveBeenCalledTimes(1);
    expect(sendArtifactMessages).toHaveBeenCalledWith(
      expect.objectContaining({ openId: "ou_owner", attachments }),
    );

    // A retried delivery of the same confirm re-sends only the card, never
    // the artifact messages again.
    confirmed.task = {
      ...confirmed.task,
      status: "DraftOnlyConfirmed",
    };
    confirmed.oaDraftRecordId = "rec-oa-new";
    await expect(
      dispatcher.dispatchCallback({
        openId: "ou_owner",
        action: "coupon_three_source_final_confirm",
        value: { pilotRecordId: confirmed.recordId, revision: 5 },
      }),
    ).resolves.toMatchObject({ handled: true });
    expect(sendCard).toHaveBeenCalledTimes(2);
    expect(sendArtifactMessages).toHaveBeenCalledTimes(1);
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
    const generated = {
      ...current,
      task: {
        ...current.task,
        revision: 7,
        status: "AwaitingFinalConfirmation" as const,
      },
    };
    const confirmSourcesAndGenerate: CouponThreeSourcePilotService["confirmSourcesAndGenerate"] =
      vi.fn(async () => generated);
    const confirmFinalPreview: CouponThreeSourcePilotService["confirmFinalPreview"] =
      vi.fn(async () => ({
        ...generated,
        task: { ...generated.task, status: "DraftOnlyConfirmed" as const },
        oaDraftRecordId: "rec-oa-merged",
      }));
    const getOaDraft = vi.fn(async () => ({
      recordId: "rec-oa-merged",
      draftId: "COA-merged",
      values: {
        applicationType: "优惠券申请",
        businessMode: "寄卖",
        activityName: "测试活动",
        activityBackground: "测试背景",
        overDeduction: "否",
        estimatedGmvYuan: 10_000,
        estimatedCostYuan: 100,
        channels: ["京东渠道"],
        activityStartAt: "2026-09-30",
        activityEndAt: "2026-10-10",
        calcImageFileCodes: ["img"],
        couponTableFileCodes: ["coupon"],
        productWhitelistFileCodes: ["white"],
      },
      attachments: [],
    })) as unknown as CouponThreeSourceDispatcherDependencies["getOaDraft"];
    const { values, sendCard } = dependencies({
      activeThreeSource: [current],
      service: {
        updateSelections,
        confirmSourcesAndGenerate,
        confirmFinalPreview,
      },
      getOaDraft,
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchCallback({
        openId: "ou_owner",
        action: "coupon_three_source_mapping_confirm:rec-three-source:5",
        form: {
          activityPointPercent: "6",
          owner_businessMode: "寄卖",
          owner_activityName: "测试活动",
          owner_activityBackground: "测试背景",
          owner_activityStartAt: "2026-09-30",
          owner_activityEndAt: "2026-10-10",
          owner_overDeduction: "否",
        },
      }),
    ).resolves.toMatchObject({
      handled: true,
      message: "Coupon three-source pilot created OA draft",
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
    expect(confirmFinalPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 7,
        operationId: expect.stringContaining(":handoff"),
      }),
    );
    // Exactly one card: the merged draft card with the send button.
    expect(sendCard).toHaveBeenCalledTimes(1);
    const card = JSON.stringify(sendCard.mock.calls[0]?.[1]);
    expect(card).toContain("确认提交正式优惠券 OA");
    expect(card).toContain("第 4 步");
    expect(card).not.toContain("标准附件已生成");
  });

  it("queues AI repair instead of generating when owner input remains invalid", async () => {
    const current = draft();
    current.task.revision = 5;
    current.task.status = "AwaitingSourceConfirmation";
    current.task.blacklistStatus = "absent_confirmed";
    const updated = {
      ...current,
      task: { ...current.task, revision: 6 },
      selections: {
        ownerFieldValues: { activityStartAt: "9月30日" },
        activityPointPercent: 6,
      },
    };
    const repairing = {
      ...updated,
      supplementRecognition: {
        kind: "form_repair" as const,
        text: "日期纠错",
        textSha256: "a".repeat(64),
        runId: "run-repair",
        revision: 6,
        status: "pending" as const,
        replaceOwnerFieldKeys: ["activityStartAt" as const],
      },
    };
    const updateSelections: CouponThreeSourcePilotService["updateSelections"] =
      vi.fn(async () => updated);
    const startSupplementRecognition: CouponThreeSourcePilotService["startSupplementRecognition"] =
      vi.fn(async () => repairing);
    const confirmSourcesAndGenerate: CouponThreeSourcePilotService["confirmSourcesAndGenerate"] =
      vi.fn();
    const { values } = dependencies({
      activeThreeSource: [current],
      service: {
        updateSelections,
        startSupplementRecognition,
        confirmSourcesAndGenerate,
      },
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchCallback({
        openId: "ou_owner",
        action: "coupon_three_source_mapping_confirm:rec-three-source:5",
        form: {
          activityPointPercent: "6%",
          owner_businessMode: "寄卖",
          owner_activityName: "测试活动",
          owner_activityBackground: "测试背景",
          owner_activityStartAt: "9月30日",
          owner_activityEndAt: "2026-10-10",
          owner_overDeduction: "否",
        },
      }),
    ).resolves.toMatchObject({ handled: true });

    expect(startSupplementRecognition).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: updated,
        kind: "form_repair",
        replaceOwnerFieldKeys: ["activityStartAt"],
        validationIssues: [
          expect.stringContaining("请输入完整日期，例如 2026-09-30"),
        ],
      }),
    );
    expect(confirmSourcesAndGenerate).not.toHaveBeenCalled();
  });

  it("answers an incomplete mapping form with a friendly card and no revision bump", async () => {
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
      vi.fn();
    const confirmSourcesAndGenerate: CouponThreeSourcePilotService["confirmSourcesAndGenerate"] =
      vi.fn();
    const recordGenerationFailure: CouponThreeSourcePilotService["recordGenerationFailure"] =
      vi.fn(
        async (
          input: Parameters<
            CouponThreeSourcePilotService["recordGenerationFailure"]
          >[0],
        ) => ({
          ...input.draft,
          failureReason: input.failure.message,
        }),
      );
    const { values, sendCard, deliverMappingCard } = dependencies({
      activeThreeSource: [current],
      service: {
        updateSelections,
        confirmSourcesAndGenerate,
        recordGenerationFailure,
      },
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchCallback({
        openId: "ou_owner",
        action: `coupon_three_source_mapping_confirm:${current.recordId}:5`,
        form: {
          activityPointPercent: "6",
          owner_activityName: "测试活动",
          owner_overDeduction: "否",
        },
      }),
    ).resolves.toMatchObject({
      handled: true,
      message: expect.stringContaining("请先完整填写"),
    });

    expect(updateSelections).not.toHaveBeenCalled();
    expect(confirmSourcesAndGenerate).not.toHaveBeenCalled();
    // The reason is surfaced on the restored live form card (banner), not on
    // a dead-end error card.
    expect(sendCard).not.toHaveBeenCalled();
    expect(deliverMappingCard).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({
          failureReason: expect.stringContaining("请先完整填写"),
        }),
      }),
    );
  });

  it("requires the over-deduction reason when the owner chooses yes", async () => {
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
      vi.fn();
    const { values } = dependencies({
      activeThreeSource: [current],
      service: { updateSelections },
    });
    const dispatcher = createCouponThreeSourceDispatcher(values);

    await expect(
      dispatcher.dispatchCallback({
        openId: "ou_owner",
        action: `coupon_three_source_mapping_confirm:${current.recordId}:5`,
        form: {
          activityPointPercent: "6",
          owner_businessMode: "寄卖",
          owner_activityName: "测试活动",
          owner_activityBackground: "测试背景",
          owner_activityStartAt: "2026-09-30",
          owner_activityEndAt: "2026-10-10",
          owner_overDeduction: "是",
        },
      }),
    ).resolves.toMatchObject({
      handled: true,
      message: expect.stringContaining("超扣原因为必填"),
    });

    expect(updateSelections).not.toHaveBeenCalled();
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
