import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { createCouponThreeSourceTask } from "../../../coupon-oa/three-source/task";
import {
  type CouponThreeSourcePilotDependencies,
  CouponThreeSourcePilotService,
} from "./service";
import type { CouponThreeSourcePilotDraft } from "./store";

async function workbookBytes(workbook: ExcelJS.Workbook): Promise<Uint8Array> {
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

async function strictCouponBytes(
  input: { businessMode?: string; overDeduction?: string } = {},
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("配券材料");
  sheet.getRow(1).values = [
    "活动名称",
    "活动背景",
    "业务模式",
    "申请人",
    "活动开始日期",
    "活动结束日期",
    "用券渠道",
    "满减门槛",
    "优惠面额",
    "总申请数量",
    "单次发放到账张数",
    "每日领取次数",
    "可领时间",
    "可用时间",
    "预计领用率",
    "预计使用率",
    "拍拍平台承担比例",
    "预计引入GMV",
    "用户领券规则",
    "优惠券赠送",
    "推广途径",
    "公开推广渠道",
    "是否超扣点",
    "超扣点原因",
  ];
  sheet.getRow(2).values = [
    "严选测试活动",
    "三源 Bot 服务测试",
    input.businessMode ?? "严选",
    "测试提报人",
    "2030-01-01",
    "2030-01-03",
    "京东商城、拍拍二手",
    "999",
    "60",
    "1000",
    "1",
    "1",
    "2030-01-01 00:00:00 至 2030-01-03 23:59:59",
    "2030-01-01 00:00:00 至 2030-01-10 23:59:59",
    "80%",
    "30%",
    "50%",
    "120000",
    "活动期间仅可领一次",
    "不允许",
    "公开自动推广",
    "领券中心",
    input.overDeduction ?? "否",
    "",
  ];
  return workbookBytes(workbook);
}

async function whitelistBytes(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("白名单");
  sheet.getRow(1).values = ["商品名称", "SKU", "券档"];
  sheet.getRow(2).values = ["商品 A", "00123", "满999减60"];
  sheet.getRow(2).getCell(2).numFmt = "@";
  return workbookBytes(workbook);
}

async function multipleCouponBytes(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await strictCouponBytes()) as never);
  const sheet = workbook.getWorksheet("配券材料");
  if (!sheet) throw new Error("missing coupon fixture sheet");
  const source = sheet.getRow(2);
  const duplicate = sheet.getRow(3);
  for (let column = 1; column <= 24; column += 1) {
    duplicate.getCell(column).value = source.getCell(column).value;
  }
  duplicate.getCell(1).value = "严选测试活动 B";
  duplicate.getCell(8).value = "1999";
  duplicate.getCell(9).value = "120";
  return workbookBytes(workbook);
}

async function loadTemplates() {
  const directory = join(
    process.cwd(),
    "docs/oa-ticket-reimbursement-materials/reference/templates",
  );
  const [
    regularFullReductionTemplateBytes,
    whitelistTemplateBytes,
    blacklistTemplateBytes,
  ] = await Promise.all([
    readFile(join(directory, "配券信息表-常规满减券.xlsx")),
    readFile(join(directory, "商品明细白名单-多券档SKU-v1.xlsx")),
    readFile(join(directory, "商品明细黑名单-多券档SKU-v1.xlsx")),
  ]);
  return {
    regularFullReductionTemplateBytes,
    whitelistTemplateBytes,
    blacklistTemplateBytes,
  };
}

describe("CouponThreeSourcePilotService", () => {
  it("reverts a GeneratingArtifacts draft after failed generation", async () => {
    let stored: CouponThreeSourcePilotDraft = {
      recordId: "rec-stuck",
      pilotId: "CTS-stuck",
      ownerOpenId: "ou_owner",
      task: {
        ...createCouponThreeSourceTask({
          taskId: "CTS-task",
          ownerOpenId: "ou_owner",
        }),
        revision: 6,
        status: "GeneratingArtifacts",
      },
      schemaVersion: "coupon-three-source-pilot-v2",
      recognitions: {},
      selections: {},
      artifacts: [],
      processedMessageIds: [],
      validationIssues: [],
      failureReason: "Feishu Drive file upload failed: parent node not exist",
    };
    const updateDraft = vi.fn(
      async (
        current: CouponThreeSourcePilotDraft,
        updates: Partial<CouponThreeSourcePilotDraft>,
        expectedRevision?: number,
      ) => {
        if (current.task.revision !== expectedRevision) {
          throw new Error("stale revision");
        }
        stored = {
          ...stored,
          ...updates,
          task: {
            ...stored.task,
            ...((updates.task as CouponThreeSourcePilotDraft["task"]) ?? {}),
            revision: (expectedRevision ?? stored.task.revision) + 1,
          },
        };
        return stored;
      },
    );
    const service = new CouponThreeSourcePilotService({
      updateDraft,
    } as unknown as CouponThreeSourcePilotDependencies);

    const recovered = await service.recoverFailedGeneration({
      draft: stored,
      ownerOpenId: "ou_owner",
      expectedRevision: 6,
    });

    expect(recovered?.task.status).toBe("AwaitingSourceConfirmation");
    expect(recovered?.task.revision).toBe(7);
    expect(recovered?.failureReason).toBeUndefined();

    // A draft that already moved on must stay untouched.
    const settled = {
      ...stored,
      task: { ...stored.task, status: "AwaitingFinalConfirmation" as const },
    };
    await expect(
      service.recoverFailedGeneration({
        draft: settled,
        ownerOpenId: "ou_owner",
        expectedRevision: settled.task.revision,
      }),
    ).resolves.toBeUndefined();
    expect(updateDraft).toHaveBeenCalledTimes(1);
  });

  it("records generation failures as a banner plus per-field editable inputs", async () => {
    let stored: CouponThreeSourcePilotDraft = {
      recordId: "rec-failed",
      pilotId: "CTS-failed",
      ownerOpenId: "ou_owner",
      task: {
        ...createCouponThreeSourceTask({
          taskId: "CTS-task",
          ownerOpenId: "ou_owner",
        }),
        revision: 6,
        status: "AwaitingSourceConfirmation",
      },
      schemaVersion: "coupon-three-source-pilot-v2",
      recognitions: {},
      selections: {},
      artifacts: [],
      processedMessageIds: [],
      validationIssues: [],
    };
    const updateDraft = vi.fn(
      async (
        current: CouponThreeSourcePilotDraft,
        updates: Partial<CouponThreeSourcePilotDraft>,
        expectedRevision?: number,
      ) => {
        if (current.task.revision !== expectedRevision) {
          throw new Error("stale revision");
        }
        stored = { ...stored, ...updates };
        return stored;
      },
    );
    const service = new CouponThreeSourcePilotService({
      updateDraft,
    } as unknown as CouponThreeSourcePilotDependencies);

    const recorded = await service.recordGenerationFailure({
      draft: stored,
      ownerOpenId: "ou_owner",
      expectedRevision: 6,
      failure: {
        message: "配券表字段不符合常规满减券规则：未识别到「申请总数量」的取值",
        fieldIssues: [
          {
            key: "totalQuantity",
            message: "未识别到「申请总数量」的取值",
          },
        ],
      },
    });

    expect(recorded.failureReason).toContain("申请总数量");
    expect(recorded.validationIssues).toEqual([
      "输入校验[totalQuantity]：未识别到「申请总数量」的取值",
    ]);
    expect(recorded.task.revision).toBe(6);

    await expect(
      service.recordGenerationFailure({
        draft: stored,
        ownerOpenId: "ou_other",
        expectedRevision: 6,
        failure: { message: "x" },
      }),
    ).rejects.toThrow("只有当前三源提报创建人可以继续操作");
  });

  it("generates strict-only artifacts and creates only an existing OA test draft", async () => {
    const coupon = await strictCouponBytes({ overDeduction: "" });
    const whitelist = await whitelistBytes();
    const userImage = new Uint8Array(
      await sharp({
        create: { width: 120, height: 80, channels: 3, background: "white" },
      })
        .png()
        .toBuffer(),
    );
    const renderScreenshots = vi.fn();
    const sources = new Map([
      ["om-coupon:file-coupon", coupon],
      ["om-whitelist:file-whitelist", whitelist],
    ]);
    let draft: CouponThreeSourcePilotDraft | undefined;
    const handoff = vi.fn(
      async () => ({ recordId: "rec-oa-test-draft" }) as never,
    );
    const uploadArtifact = vi.fn(async (input: { name: string }) => ({
      fileToken: `drive-${input.name}`,
    }));
    const grantArtifactPreview = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(
        new Error("Feishu Drive file permission grant failed: 403"),
      );
    const updateDraft = vi.fn(
      async (
        current: CouponThreeSourcePilotDraft,
        updates: Partial<CouponThreeSourcePilotDraft>,
        expectedRevision?: number,
      ) => {
        if (current.task.revision !== expectedRevision) {
          throw new Error("stale revision");
        }
        // Model the guarded Base store: every write must expect the revision
        // that is actually persisted, so stale snapshots are rejected here
        // exactly like updateCouponThreeSourcePilotDraft rejects them.
        if (draft && expectedRevision !== undefined) {
          if (draft.task.revision !== expectedRevision) {
            throw new Error(
              `Three-source pilot version changed; reopen the latest card (stored=${draft.task.revision}, expected=${expectedRevision})`,
            );
          }
          draft = { ...draft, ...updates };
          return draft;
        }
        draft = { ...current, ...updates };
        return draft;
      },
    );
    const dependencies: CouponThreeSourcePilotDependencies = {
      downloadSource: async (source) => {
        const bytes = sources.get(`${source.messageId}:${source.fileKey}`);
        if (!bytes) throw new Error("unexpected source download");
        return bytes;
      },
      downloadResource: async ({ resourceKey }) => {
        if (resourceKey !== "img-user") throw new Error("unexpected image");
        return userImage;
      },
      renderScreenshots,
      uploadArtifact,
      grantArtifactPreview,
      folderToken: () => "fld-three-source",
      loadTemplates,
      createDraft: async (input) => {
        draft = {
          recordId: "rec-three-source",
          pilotId: "CTS-pilot",
          ownerOpenId: input.ownerOpenId,
          task: input.task,
          schemaVersion: "coupon-three-source-pilot-v2",
          recognitions: {},
          selections: {},
          artifacts: [],
          processedMessageIds: [],
          validationIssues: [],
        };
        return draft;
      },
      getDraft: async () => {
        if (!draft) throw new Error("missing draft");
        return draft;
      },
      listActive: async () =>
        draft && !["DraftOnlyConfirmed", "Canceled"].includes(draft.task.status)
          ? [draft]
          : [],
      updateDraft,
      handoff,
    };
    const service = new CouponThreeSourcePilotService(dependencies);

    let current = await service.startOrResume("ou_owner");
    current = await service.receiveSource({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      messageId: "om-coupon",
      fileKey: "file-coupon",
      fileName: "严选配券表.xlsx",
      bytes: coupon,
    });
    current = await service.receiveSource({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      messageId: "om-whitelist",
      fileKey: "file-whitelist",
      fileName: "商品白名单.xlsx",
      bytes: whitelist,
    });
    current = await service.confirmNoBlacklist({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      operationId: "no-blacklist",
    });
    current = await service.updateSelections({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      selections: { ownerFieldValues: { overDeduction: "否" } },
      operationId: "set-over-deduction",
    });
    current = await service.updateSelections({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      selections: {
        activityPointPercent: 6,
        ownerFieldValues: { overDeductionReason: "" },
      },
      operationId: "set-point",
    });
    expect(current.selections.ownerFieldValues).toMatchObject({
      overDeduction: "否",
      overDeductionReason: "",
    });
    current = await service.confirmSourcesAndGenerate({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      operationId: "generate",
    });

    expect(current.task).toMatchObject({ status: "AwaitingFinalConfirmation" });
    expect(current.artifacts.map((artifact) => artifact.role)).toEqual([
      "couponTable",
      "productWhitelist",
    ]);
    expect(
      current.oaPrefill?.attachments.map((attachment) => attachment.role),
    ).toEqual(["couponTable", "productWhitelist"]);
    expect(uploadArtifact).toHaveBeenCalledTimes(2);
    expect(grantArtifactPreview).toHaveBeenCalledTimes(2);
    for (const call of grantArtifactPreview.mock.calls) {
      expect(call[0]).toMatchObject({ memberOpenId: "ou_owner" });
    }
    expect(
      current.artifacts.every(
        (artifact) => artifact.previewGrantedFor === "ou_owner",
      ),
    ).toBe(true);
    expect(
      current.artifacts.every((artifact) => !artifact.previewGrantError),
    ).toBe(true);

    current = await service.confirmFinalPreview({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      operationId: "oa-draft",
    });
    expect(current.task.status).toBe("DraftOnlyConfirmed");
    expect(current.oaDraftRecordId).toBe("rec-oa-test-draft");
    expect(handoff).toHaveBeenCalledOnce();

    const nonStrictCoupon = await strictCouponBytes({ businessMode: "pop" });
    sources.set("om-pop:file-pop", nonStrictCoupon);
    current = await service.startOrResume("ou_owner");
    current = await service.receiveSource({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      messageId: "om-pop",
      fileKey: "file-pop",
      fileName: "pop配券表.xlsx",
      bytes: nonStrictCoupon,
    });
    current = await service.receiveSource({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      messageId: "om-whitelist",
      fileKey: "file-whitelist",
      fileName: "商品白名单.xlsx",
      bytes: whitelist,
    });
    current = await service.confirmNoBlacklist({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      operationId: "no-blacklist-pop",
    });
    current = await service.updateSelections({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      selections: { activityPointPercent: 6 },
      operationId: "set-point-pop",
    });
    current = await service.receiveCalcImage({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      messageId: "om-user-image",
      resourceKey: "img-user",
      resourceType: "image",
      fileName: "业务员测算图.png",
      bytes: userImage,
    });
    const generated = await service.confirmSourcesAndGenerate({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      operationId: "generate-pop",
    });
    expect(generated.task.status).toBe("AwaitingFinalConfirmation");
    // The in-flight marker must be persisted before any heavy artifact work
    // so concurrent clicks/uploads hit the GeneratingArtifacts gate.
    const markerCall = updateDraft.mock.calls.find(
      ([, updates]) =>
        (updates as { task?: { status?: string } }).task?.status ===
        "GeneratingArtifacts",
    );
    expect(markerCall).toBeDefined();
    const markerArgs = markerCall as [
      CouponThreeSourcePilotDraft,
      Partial<CouponThreeSourcePilotDraft>,
      number | undefined,
    ];
    expect(markerArgs[0]).toMatchObject({
      recordId: current.recordId,
      ownerOpenId: "ou_owner",
    });
    expect(markerArgs[2]).toBe(markerArgs[0].task.revision);
    const markerOrder =
      updateDraft.mock.invocationCallOrder[
        updateDraft.mock.calls.findIndex((call) => call === markerCall)
      ];
    expect(markerOrder).toBeLessThan(
      uploadArtifact.mock.invocationCallOrder[0],
    );
    // The final persisted state must stay small enough for the Base cell
    // limit: heavy parsed datasets are cleared, only frozen artifacts and
    // the OA prefill snapshot survive.
    const finalCall = updateDraft.mock.calls[updateDraft.mock.calls.length - 1];
    const finalUpdates = finalCall?.[1] as Record<string, unknown>;
    expect(finalUpdates.whitelist).toBeUndefined();
    expect(finalUpdates.couponSet).toBeUndefined();
    expect(finalUpdates.package).toBeUndefined();
    expect(finalUpdates.oaPrefill).toBeDefined();
    expect(generated.artifacts.length).toBeGreaterThan(0);
    expect(
      generated.artifacts.filter((artifact) => artifact.role === "calcImage"),
    ).toHaveLength(1);
    expect(renderScreenshots).not.toHaveBeenCalled();
    expect(uploadArtifact.mock.calls.length).toBeGreaterThan(2);
    // The rejected preview grant only hides the in-card preview entry; the
    // freeze itself still succeeds for every artifact.
    expect(
      generated.artifacts.every((artifact) => !artifact.previewGrantedFor),
    ).toBe(true);
    expect(
      generated.artifacts.every(
        (artifact) =>
          typeof artifact.previewGrantError === "string" &&
          artifact.previewGrantError.includes("403"),
      ),
    ).toBe(true);
  });

  it("generates one artifact set for multiple amount tiers", async () => {
    const coupon = await multipleCouponBytes();
    const whitelist = await whitelistBytes();
    const sources = new Map([
      ["om-coupon:file-coupon", coupon],
      ["om-whitelist:file-whitelist", whitelist],
    ]);
    let draft: CouponThreeSourcePilotDraft | undefined;
    const uploadArtifact = vi.fn(async ({ name }: { name: string }) => ({
      fileToken: `token-${name}`,
    }));
    const dependencies: CouponThreeSourcePilotDependencies = {
      downloadSource: async (source) => {
        const bytes = sources.get(`${source.messageId}:${source.fileKey}`);
        if (!bytes) throw new Error("unexpected source download");
        return bytes;
      },
      uploadArtifact,
      folderToken: () => "unused",
      loadTemplates,
      createDraft: async (input) => {
        draft = {
          recordId: "rec-multiple-coupons",
          pilotId: "CTS-multiple-coupons",
          ownerOpenId: input.ownerOpenId,
          task: input.task,
          schemaVersion: "coupon-three-source-pilot-v2",
          recognitions: {},
          selections: {},
          artifacts: [],
          processedMessageIds: [],
          validationIssues: [],
        };
        return draft;
      },
      getDraft: async () => {
        if (!draft) throw new Error("missing draft");
        return draft;
      },
      listActive: async () => (draft ? [draft] : []),
      updateDraft: async (current, updates, expectedRevision) => {
        if (current.task.revision !== expectedRevision) {
          throw new Error("stale revision");
        }
        draft = { ...current, ...updates };
        return draft;
      },
      handoff: vi.fn(),
    };
    const service = new CouponThreeSourcePilotService(dependencies);

    let current = await service.startOrResume("ou_owner");
    current = await service.receiveSource({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      messageId: "om-coupon",
      fileKey: "file-coupon",
      fileName: "多券配券表.xlsx",
      bytes: coupon,
    });
    current = await service.receiveSource({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      messageId: "om-whitelist",
      fileKey: "file-whitelist",
      fileName: "商品白名单.xlsx",
      bytes: whitelist,
    });
    current = await service.confirmNoBlacklist({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      operationId: "no-blacklist",
    });
    current = await service.updateSelections({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      selections: { activityPointPercent: 6 },
      operationId: "set-point",
    });
    current = await service.confirmSourcesAndGenerate({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      operationId: "refresh-candidates",
    });

    expect(current.task.status).toBe("AwaitingFinalConfirmation");
    // The parsed coupon set is intentionally not persisted after generation
    // (Base cell budget); the tier count is baked into the frozen artifacts.
    expect(current.couponSet).toBeUndefined();
    expect(current.oaPrefill?.values.businessMode).toBeDefined();
    expect(current.artifacts.map((artifact) => artifact.role)).toEqual([
      "couponTable",
      "productWhitelist",
    ]);
    expect(uploadArtifact).toHaveBeenCalledTimes(2);
  });

  it("waits for explicit completion before activating one recognition batch", async () => {
    const coupon = await strictCouponBytes();
    const whitelist = await whitelistBytes();
    let draft: CouponThreeSourcePilotDraft | undefined;
    const prepareAiRecognition: NonNullable<
      CouponThreeSourcePilotDependencies["prepareAiRecognition"]
    > = vi.fn(async (input) => ({
      runId: `run-${input.role}`,
      revision: input.draft.task.revision,
      sourceSha256: input.source.sha256,
      status: "pending" as const,
    }));
    const activateAiRecognition = vi.fn(async () => undefined);
    const updateDraftImpl: CouponThreeSourcePilotDependencies["updateDraft"] =
      async (current, updates, expectedRevision) => {
        if (current.task.revision !== expectedRevision) {
          throw new Error("stale revision");
        }
        const next = { ...current, ...updates };
        draft = next;
        return next;
      };
    const updateDraft = vi.fn(updateDraftImpl);
    const dependencies: CouponThreeSourcePilotDependencies = {
      downloadSource: async () => coupon,
      uploadArtifact: vi.fn(),
      folderToken: () => "unused",
      loadTemplates,
      createDraft: async (input) => {
        draft = {
          recordId: "record-ai",
          pilotId: "pilot-ai",
          ownerOpenId: input.ownerOpenId,
          task: input.task,
          schemaVersion: "coupon-three-source-pilot-v2",
          recognitions: {},
          selections: {},
          artifacts: [],
          processedMessageIds: [],
          validationIssues: [],
        };
        return draft;
      },
      getDraft: async () => {
        if (!draft) throw new Error("missing draft");
        return draft;
      },
      listActive: async () => (draft ? [draft] : []),
      updateDraft,
      handoff: vi.fn(),
      prepareAiRecognition,
      activateAiRecognition,
    };
    const service = new CouponThreeSourcePilotService(dependencies);
    let current = await service.startOrResume("ou_owner");
    current = await service.receiveSource({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      messageId: "message-1",
      fileKey: "file-1",
      fileName: "coupon.xlsx",
      bytes: coupon,
    });
    current = await service.receiveSource({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      messageId: "message-2",
      fileKey: "file-2",
      fileName: "whitelist.xlsx",
      bytes: whitelist,
    });
    expect(prepareAiRecognition).not.toHaveBeenCalled();
    expect(activateAiRecognition).not.toHaveBeenCalled();
    expect(current.recognitions.couponTable?.ai).toBeUndefined();

    current = await service.startAiRecognition({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      operationId: "start-ai",
    });

    expect(prepareAiRecognition).toHaveBeenCalledTimes(2);
    expect(activateAiRecognition).toHaveBeenCalledTimes(2);
    expect(updateDraft.mock.invocationCallOrder.at(-1)).toBeLessThan(
      activateAiRecognition.mock.invocationCallOrder[0] ?? 0,
    );
    expect(current.recognitions.couponTable?.ai).toMatchObject({
      runId: "run-couponTable",
      status: "pending",
    });

    await service.startAiRecognition({
      draft: current,
      ownerOpenId: "ou_owner",
      expectedRevision: current.task.revision,
      operationId: "start-ai-retry",
    });
    expect(prepareAiRecognition).toHaveBeenCalledTimes(2);
    expect(activateAiRecognition).toHaveBeenCalledTimes(4);
  });
});
