import { afterEach, describe, expect, it } from "vitest";
import { createCouponThreeSourceTask } from "../../../coupon-oa/three-source/task";
import {
  buildCouponThreeSourceErrorCard,
  buildCouponThreeSourceIntakeCard,
  buildCouponThreeSourceMappingCard,
  buildCouponThreeSourceNoBlacklistCard,
  buildCouponThreeSourcePreviewCard,
  buildCouponThreeSourceRecognizingCard,
} from "./cards";
import type { CouponThreeSourcePilotDraft } from "./store";

function draft(): CouponThreeSourcePilotDraft {
  const task = createCouponThreeSourceTask({
    taskId: "CTS-card",
    ownerOpenId: "ou_owner",
  });
  task.revision = 4;
  task.status = "AwaitingSourceConfirmation";
  task.sources = {
    couponTable: {
      role: "couponTable",
      messageId: "om-coupon",
      fileKey: "file-coupon",
      fileName: "配券表.xlsx",
      bytes: 10,
      sha256: "a".repeat(64),
    },
    whitelist: {
      role: "whitelist",
      messageId: "om-whitelist",
      fileKey: "file-whitelist",
      fileName: "白名单.xlsx",
      bytes: 10,
      sha256: "b".repeat(64),
    },
  };
  task.blacklistStatus = "absent_confirmed";
  return {
    recordId: "rec-three-source",
    pilotId: "CTS-card",
    ownerOpenId: "ou_owner",
    task,
    schemaVersion: "coupon-three-source-pilot-v2",
    recognitions: {
      couponTable: {
        source: {
          messageId: "om-coupon",
          fileKey: "file-coupon",
          fileName: "配券表.xlsx",
          bytes: 10,
          sha256: "a".repeat(64),
        },
        sourceHash: "a".repeat(64),
        roleCandidates: [],
        couponFieldCandidates: {
          activityName: [
            {
              id: "activity-1",
              key: "activityName",
              score: 1,
              header: "活动名称",
              headerRow: 1,
              column: "A",
              sheetName: "Sheet1",
              sampleValues: [],
              reasons: [],
            },
            {
              id: "activity-2",
              key: "activityName",
              score: 1,
              header: "活动名称备用",
              headerRow: 1,
              column: "B",
              sheetName: "Sheet1",
              sampleValues: [],
              reasons: [],
            },
          ],
        },
        listCandidates: [],
        issues: [],
      },
      whitelist: {
        source: {
          messageId: "om-whitelist",
          fileKey: "file-whitelist",
          fileName: "白名单.xlsx",
          bytes: 10,
          sha256: "b".repeat(64),
        },
        sourceHash: "b".repeat(64),
        roleCandidates: [],
        couponFieldCandidates: {},
        listCandidates: [
          {
            id: "sku",
            kind: "identifier",
            dimension: "SKU",
            score: 1,
            header: "SKU",
            headerRow: 1,
            column: "A",
            sheetName: "Sheet1",
            sampleValues: [],
            reasons: [],
          },
        ],
        issues: [],
      },
    },
    selections: {},
    artifacts: [],
    processedMessageIds: [],
    validationIssues: [],
  };
}

const originalPreviewBaseUrl = process.env.FEISHU_WEB_BASE_URL;

describe("three-source Bot cards", () => {
  afterEach(() => {
    if (originalPreviewBaseUrl === undefined) {
      delete process.env.FEISHU_WEB_BASE_URL;
    } else {
      process.env.FEISHU_WEB_BASE_URL = originalPreviewBaseUrl;
    }
  });

  it("starts one recognition batch only after the owner finishes uploading", () => {
    const current = draft();
    const rendered = JSON.stringify(buildCouponThreeSourceIntakeCard(current));

    expect(rendered).toContain("材料已上传完毕，开始统一识别");
    expect(rendered).toContain("coupon_three_source_recognition_start");
    expect(rendered).not.toContain("源文件只用于生成");
    expect(rendered).not.toContain("未上传黑名单时");
  });

  it("asks business questions without exposing technical field mappings", () => {
    const current = draft();
    current.task.blacklistStatus = "absent_pending_confirmation";
    const card = buildCouponThreeSourceMappingCard(current);
    const rendered = JSON.stringify(card);

    expect(rendered).toContain("owner_activityName");
    expect(rendered).not.toContain("coupon_activityName");
    expect(rendered).not.toContain("确认来源映射");
    expect(rendered).toContain("couponType");
    expect(rendered).not.toContain("whitelist_defaultTier");
    expect(rendered).not.toContain("满999减60");
    expect(rendered).toContain(
      "coupon_three_source_mapping_confirm:rec-three-source:4",
    );
    expect(rendered).toContain("blacklistDecision");
    expect(rendered).toContain("确认本次无商品黑名单");
    expect(rendered).toContain("语音或文字补充说明");
    expect(rendered).toContain("严选");
    expect(rendered).toContain("寄卖");
    expect(rendered).toContain("POP");
    expect(rendered).not.toContain("补充字段 activityBackground");

    const forms = card.body.elements.filter(
      (element) => element.tag === "form",
    );
    const supplementForm = forms.find(
      (element) => element.name === "coupon_three_source_supplement_submit",
    );
    expect(supplementForm).toBeDefined();
    expect(JSON.stringify(supplementForm)).toContain("supplementText");
    expect(JSON.stringify(supplementForm)).not.toContain(
      "owner_activityBackground",
    );
    expect(JSON.stringify(supplementForm)).not.toContain(
      "activityPointPercent",
    );
  });

  it("shows persisted AI date-time candidates as business dates", () => {
    const current = draft();
    const coupon = current.recognitions.couponTable;
    if (!coupon) throw new Error("coupon recognition fixture is missing");
    coupon.ai = {
      runId: "run-date",
      revision: current.task.revision,
      sourceSha256: coupon.sourceHash,
      status: "succeeded",
      primary: true,
      result: {
        sourceHash: coupon.sourceHash,
        roleCandidates: [],
        couponCandidates: [],
        fieldCandidates: [
          {
            key: "activityStartAt",
            sheetName: "Sheet1",
            headerCell: "A1",
            valueCell: "A2",
            confidence: 0.9,
            reason: "日期候选",
            origin: "ai_inferred",
            value: "2026-09-30 00:00",
          },
          {
            key: "activityEndAt",
            sheetName: "Sheet1",
            headerCell: "A1",
            valueCell: "A2",
            confidence: 0.9,
            reason: "日期候选",
            origin: "ai_inferred",
            value: "2026-10-10 23:59",
          },
        ],
        listCandidates: [],
        issues: [],
      },
    };

    const rendered = JSON.stringify(buildCouponThreeSourceMappingCard(current));
    expect(rendered).toContain('"default_value":"2026-09-30"');
    expect(rendered).toContain('"default_value":"2026-10-10"');
    expect(rendered).not.toContain("2026-09-30 00:00");
    expect(rendered).not.toContain("2026-10-10 23:59");
  });

  it("renders over-deduction as an in-form select with an always-visible optional reason", () => {
    const current = draft();

    const undecided = JSON.stringify(
      buildCouponThreeSourceMappingCard(current),
    );
    expect(undecided).not.toContain(
      "coupon_three_source_over_deduction_select",
    );
    expect(undecided).toContain('"name":"owner_overDeduction"');
    expect(undecided).toContain('"name":"owner_overDeductionReason"');
    expect(undecided).toContain("请选择是否超扣");
    expect(undecided).toContain(
      '"label":{"tag":"plain_text","content":"是否超扣"}',
    );
    expect(undecided.indexOf('"name":"owner_overDeduction"')).toBeLessThan(
      undecided.indexOf('"name":"owner_overDeductionReason"'),
    );
    expect(
      undecided.indexOf('"name":"owner_overDeductionReason"'),
    ).toBeLessThan(undecided.indexOf('"name":"owner_businessMode"'));
    expect(undecided).toContain(
      '"label":{"tag":"plain_text","content":"业务模式"}',
    );

    current.selections.ownerFieldValues = { overDeduction: "否" };
    const noDeduction = JSON.stringify(
      buildCouponThreeSourceMappingCard(current),
    );
    expect(noDeduction).toContain('"default_value":"否"');
    expect(noDeduction).toContain('"name":"owner_overDeductionReason"');
    expect(noDeduction).not.toContain(
      '"content":"超扣原因（选“是”时必填）"},"input_type":"multiline_text","rows":3,"required":true',
    );

    current.selections.ownerFieldValues = { overDeduction: "是" };
    const withDeduction = JSON.stringify(
      buildCouponThreeSourceMappingCard(current),
    );
    expect(withDeduction).toContain('"default_value":"是"');
    expect(withDeduction).toContain("超扣原因（选“是”时必填）");
  });

  it("shows the failure banner and re-renders failed fields as editable inputs", () => {
    const current = draft();
    const couponFieldCandidates = current.recognitions.couponTable
      ?.couponFieldCandidates as NonNullable<
      typeof current.recognitions.couponTable
    >["couponFieldCandidates"];
    couponFieldCandidates.totalQuantity = [
      {
        id: "total-1",
        key: "totalQuantity",
        score: 1,
        header: "总申请数量",
        headerRow: 1,
        column: "J",
        sheetName: "Sheet1",
        sampleValues: ["1000"],
        reasons: [],
      },
    ];
    // With a healthy workbook column the field is not owner-editable.
    expect(
      JSON.stringify(buildCouponThreeSourceMappingCard(current)),
    ).not.toContain('"name":"owner_totalQuantity"');

    current.failureReason =
      "配券表字段不符合常规满减券规则：未识别到「申请总数量」的取值";
    current.validationIssues = [
      "输入校验[totalQuantity]：未识别到「申请总数量」的取值：请检查配券表对应列的表头和数据行是否已填写",
    ];
    const rendered = JSON.stringify(buildCouponThreeSourceMappingCard(current));
    expect(rendered).toContain("上次确认未完成");
    expect(rendered).toContain('"name":"owner_totalQuantity"');
    expect(rendered).toContain("请检查配券表对应列的表头和数据行是否已填写");
  });

  it("gives the recognizing card an owner escape hatch to manual fill", () => {
    const current = draft();
    const recognition = current.recognitions.couponTable as NonNullable<
      typeof current.recognitions.couponTable
    >;
    recognition.ai = {
      runId: "run-1",
      revision: 4,
      sourceSha256: "a".repeat(64),
      status: "pending",
    };
    const rendered = JSON.stringify(
      buildCouponThreeSourceRecognizingCard(current),
    );
    expect(rendered).toContain("coupon_three_source_skip_ai_recognition");
    expect(rendered).toContain("跳过 AI 识别，改为人工填写");
    expect(rendered).toContain("长时间无响应时也可以直接跳过");
  });

  it("gives the failure card a rollback entry only when the draft is known", () => {
    const plain = JSON.stringify(
      buildCouponThreeSourceErrorCard({ message: "上传失败" }),
    );
    expect(plain).toContain("上传失败");
    expect(plain).not.toContain("coupon_three_source_reopen");

    const withReopen = JSON.stringify(
      buildCouponThreeSourceErrorCard({
        message: "当前三源提报版本已变化，请使用最新卡片",
        reopen: { recordId: "rec-three-source", revision: 4 },
      }),
    );
    expect(withReopen).toContain("coupon_three_source_reopen");
    expect(withReopen).toContain('"pilotRecordId":"rec-three-source"');
    expect(withReopen).toContain("回到当前提报卡片重新填写");
  });

  it("always renders required date inputs with stored defaults", () => {
    const current = draft();
    current.selections.ownerFieldValues = {
      activityStartAt: "2026-09-30",
      activityEndAt: "2026-10-10",
    };

    const rendered = JSON.stringify(buildCouponThreeSourceMappingCard(current));
    expect(rendered).toContain('"name":"owner_activityStartAt"');
    expect(rendered).toContain('"name":"owner_activityEndAt"');
    expect(rendered).toContain("活动开始日期（YYYY-MM-DD）");
  });

  it("shows ordered image counts and append/replace controls", () => {
    const current = draft();
    const baseImage = {
      artifactId: "image-1",
      messageId: "om-1",
      resourceKey: "img-1",
      resourceType: "image" as const,
      sourceType: "feishu_image" as const,
      fileName: "第一张.png",
      contentType: "image/png" as const,
      bytes: 100,
      width: 20,
      height: 10,
      sha256: "a".repeat(64),
      receivedOrder: 0,
      receivedAt: "2030-01-01T00:00:00.000Z",
      revision: current.task.revision,
      actorOpenId: "ou_owner",
    };
    current.task.confirmedCalcImages = [baseImage];
    current.task.pendingCalcImages = [
      {
        ...baseImage,
        artifactId: "image-2",
        messageId: "om-2",
        fileName: "第二张.png",
        sha256: "b".repeat(64),
      },
    ];
    const rendered = JSON.stringify(buildCouponThreeSourceMappingCard(current));
    expect(rendered).toContain("已确认测算图片：1 张");
    expect(rendered).toContain("待确认测算图片：1 张");
    expect(rendered).toContain("coupon_three_source_calc_images_append");
    expect(rendered).toContain("coupon_three_source_calc_images_replace_all");
    expect(rendered).toContain("严选");
  });

  it("keeps no-blacklist and final draft creation as explicit revision-bound actions", () => {
    const current = draft();
    const noBlacklist = JSON.stringify(
      buildCouponThreeSourceNoBlacklistCard(current),
    );
    expect(noBlacklist).toContain("coupon_three_source_no_blacklist_confirm");
    expect(noBlacklist).toContain('"revision":4');

    current.task.status = "AwaitingFinalConfirmation";
    current.oaPrefill = {
      ownerId: "ou_owner",
      revision: 4,
      snapshotHash: "c".repeat(64),
      values: {
        applicant: {
          source: "feishuIdentity",
          status: "resolved_on_final_confirmation",
        },
        department: {
          source: "feishuIdentity",
          status: "resolved_on_final_confirmation",
        },
        applicationType: "优惠券申请",
        businessMode: "严选",
        activityName: "严选活动",
        activityBackground: "测试",
        activityPointPercent: 6,
        platformBearingPercent: 50,
        overDeduction: "否",
        estimatedGmvYuan: 100,
        estimatedCostYuan: 10,
        estimatedRoi: 10,
        channels: ["JD"],
        activityStartAt: "2030-01-01",
        activityEndAt: "2030-01-01",
        durationDays: 1,
      },
      attachments: [],
      blacklistStatus: "absent_confirmed",
      overlap: { ids: [], sha256: "d".repeat(64) },
    };
    const preview = JSON.stringify(buildCouponThreeSourcePreviewCard(current));
    expect(preview).toContain("coupon_three_source_final_confirm");
    expect(preview).toContain("不会自动提交正式 OA");
    expect(preview).not.toContain("calcImage");
  });

  it("adds a preview eye button only for artifacts granted to the owner", () => {
    process.env.FEISHU_WEB_BASE_URL = "https://example.feishu.cn";
    const current = draft();
    current.task.status = "AwaitingFinalConfirmation";
    current.artifacts = [
      {
        artifactId: "couponTable-a",
        order: 0,
        role: "couponTable",
        fileName: "标准配券表.xlsx",
        fileToken: "tok-coupon",
        bytes: 10,
        sha256: "a".repeat(64),
        templateId: "tpl-coupon",
        templateVersion: "1",
        previewGrantedFor: "ou_owner",
      },
      {
        artifactId: "productWhitelist-b",
        order: 1,
        role: "productWhitelist",
        fileName: "标准白名单.xlsx",
        fileToken: "tok-white",
        bytes: 10,
        sha256: "b".repeat(64),
        templateId: "tpl-white",
        templateVersion: "1",
        previewGrantedFor: "ou_owner",
      },
      {
        artifactId: "productBlacklist-c",
        order: 2,
        role: "productBlacklist",
        fileName: "标准黑名单.xlsx",
        fileToken: "tok-black",
        bytes: 10,
        sha256: "c".repeat(64),
        templateId: "tpl-black",
        templateVersion: "1",
      },
    ];
    const preview = JSON.stringify(buildCouponThreeSourcePreviewCard(current));
    expect(preview).toContain('"open_url"');
    expect(preview).toContain("https://example.feishu.cn/file/tok-coupon");
    expect(preview).toContain("https://example.feishu.cn/file/tok-white");
    expect(preview).toContain("👁 配券表");
    expect(preview).toContain("👁 白名单");
    expect(preview).not.toContain("file/tok-black");
    expect(preview).not.toContain("👁 黑名单");
  });

  it("keeps the plain file list when preview is unavailable", () => {
    delete process.env.FEISHU_WEB_BASE_URL;
    const current = draft();
    current.task.status = "AwaitingFinalConfirmation";
    current.artifacts = [
      {
        artifactId: "couponTable-a",
        order: 0,
        role: "couponTable",
        fileName: "标准配券表.xlsx",
        fileToken: "tok-coupon",
        bytes: 10,
        sha256: "a".repeat(64),
        templateId: "tpl-coupon",
        templateVersion: "1",
        previewGrantedFor: "ou_owner",
      },
      {
        artifactId: "productWhitelist-b",
        order: 1,
        role: "productWhitelist",
        fileName: "标准白名单.xlsx",
        fileToken: "tok-white",
        bytes: 10,
        sha256: "b".repeat(64),
        templateId: "tpl-white",
        templateVersion: "1",
        previewGrantedFor: "ou_someone_else",
      },
    ];

    // No tenant web origin configured: even granted artifacts stay plain.
    const withoutOrigin = JSON.stringify(
      buildCouponThreeSourcePreviewCard(current),
    );
    expect(withoutOrigin).not.toContain("open_url");
    expect(withoutOrigin).toContain("标准配券表.xlsx");

    // Origin configured but only the artifact granted to another user must
    // not expose a link.
    process.env.FEISHU_WEB_BASE_URL = "https://example.feishu.cn";
    current.artifacts = current.artifacts.slice(1);
    const notGrantedToOwner = JSON.stringify(
      buildCouponThreeSourcePreviewCard(current),
    );
    expect(notGrantedToOwner).not.toContain("open_url");
  });

  it("suppresses generation while AI is pending", () => {
    const current = draft();
    const recognition = current.recognitions.couponTable;
    if (!recognition) throw new Error("missing fixture recognition");
    recognition.ai = {
      runId: "run-1",
      revision: 4,
      sourceSha256: recognition.sourceHash,
      status: "pending",
    };
    const rendered = JSON.stringify(
      buildCouponThreeSourceRecognizingCard(current),
    );
    expect(rendered).toContain("AI 识别中");
    expect(rendered).not.toContain("确认来源并生成标准附件");
  });

  it("treats multiple amount rows as one coupon template", () => {
    const current = draft();
    const recognition = current.recognitions.couponTable;
    if (!recognition) throw new Error("missing fixture recognition");
    recognition.couponCandidates = [
      {
        id: "coupon-1",
        couponType: "regular_full_reduction",
        displayName: "满100减20",
        sourceHash: recognition.sourceHash,
        sheetName: "Sheet1",
        row: 2,
        evidenceCells: ["A2"],
        fieldCandidateIds: {},
        source: "deterministic",
      },
      {
        id: "coupon-2",
        couponType: "unknown",
        displayName: "待确认券",
        sourceHash: recognition.sourceHash,
        sheetName: "Sheet1",
        row: 3,
        evidenceCells: ["A3"],
        fieldCandidateIds: {},
        source: "ai",
      },
    ];
    const rendered = JSON.stringify(buildCouponThreeSourceMappingCard(current));
    expect(rendered).not.toContain("couponCandidateId");
    expect(rendered).toContain("couponType");
    expect(rendered).toContain("语音或文字补充说明");
    expect(rendered).not.toContain('"selected":true');
  });

  it("projects validated activity copy only when its gate is enabled", () => {
    const current = draft();
    const recognition = current.recognitions.couponTable;
    if (!recognition) throw new Error("missing fixture recognition");
    recognition.ai = {
      runId: "run-copy",
      revision: 4,
      sourceSha256: recognition.sourceHash,
      status: "succeeded",
      primary: true,
      activityCopyEnabled: false,
      result: {
        sourceHash: recognition.sourceHash,
        roleCandidates: [],
        couponCandidates: [],
        fieldCandidates: [
          {
            key: "activityStartAt",
            sheetName: "Sheet1",
            headerCell: "C1",
            valueCell: "C2",
            confidence: 0.8,
            reason: "源表日期缺少年份",
            value: "2030-09-30",
            origin: "ai_inferred",
          },
        ],
        listCandidates: [],
        activityCopyCandidates: [
          {
            key: "activityName",
            value: "双十一满减优惠券申请",
            evidenceCells: ["A1"],
          },
          {
            key: "activityBackground",
            value: "围绕满100减20券档开展双十一促销。",
            evidenceCells: ["A2"],
          },
        ],
        issues: [],
      },
    };

    expect(
      JSON.stringify(buildCouponThreeSourceMappingCard(current)),
    ).not.toContain("双十一满减优惠券申请");
    recognition.ai.activityCopyEnabled = true;
    const enabled = JSON.stringify(buildCouponThreeSourceMappingCard(current));
    expect(enabled).toContain("双十一满减优惠券申请");
    expect(enabled).toContain("围绕满100减20券档开展双十一促销");
    expect(enabled).toContain("以下内容为系统推测或识别不确定，请务必检查");
    expect(enabled).toContain('"name":"owner_activityStartAt"');
    expect(enabled).toContain('"default_value":"2030-09-30"');
  });

  it("shows a Chinese DeepSeek outcome in the second-round card", () => {
    const current = draft();
    const recognition = current.recognitions.couponTable;
    if (!recognition) throw new Error("missing fixture recognition");
    recognition.ai = {
      runId: "run-ai",
      revision: current.task.revision,
      sourceSha256: recognition.sourceHash,
      status: "succeeded",
      primary: true,
      result: {
        sourceHash: recognition.sourceHash,
        roleCandidates: [],
        couponCandidates: [],
        fieldCandidates: [],
        listCandidates: [],
        issues: [],
      },
      audit: {
        provider: "deepseek",
        model: "deepseek-chat",
        promptVersion: "coupon-three-source-p0-ai-primary-v2",
        status: "succeeded",
        startedAt: "2026-10-12T00:00:00.000Z",
        completedAt: "2026-10-12T00:00:01.000Z",
        durationMs: 1000,
      },
    };
    current.supplementRecognition = {
      text: "活动点位 5%",
      textSha256: "a".repeat(64),
      runId: "run-text",
      revision: current.task.revision,
      status: "failed",
      fallbackCode: "timeout",
    };

    const rendered = JSON.stringify(buildCouponThreeSourceMappingCard(current));
    expect(rendered).toContain("DeepSeek 表格识别已完成");
    expect(rendered).toContain("补充说明识别失败，请直接检查并填写字段");
    expect(rendered).not.toContain("coupon-three-source-p0-ai-primary-v2");
  });
});
