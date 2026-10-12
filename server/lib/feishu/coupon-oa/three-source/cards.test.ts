import { describe, expect, it } from "vitest";
import { createCouponThreeSourceTask } from "../../../coupon-oa/three-source/task";
import {
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
    schemaVersion: "coupon-three-source-pilot-v1",
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

describe("three-source Bot cards", () => {
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

  it("shows the over-deduction reason only after the owner chooses yes", () => {
    const current = draft();

    const undecided = JSON.stringify(
      buildCouponThreeSourceMappingCard(current),
    );
    expect(undecided).toContain("coupon_three_source_over_deduction_select");
    expect(undecided).not.toContain('"name":"owner_overDeduction"');
    expect(undecided).not.toContain('"name":"owner_overDeductionReason"');

    current.selections.ownerFieldValues = { overDeduction: "否" };
    const noDeduction = JSON.stringify(
      buildCouponThreeSourceMappingCard(current),
    );
    expect(noDeduction).not.toContain('"name":"owner_overDeductionReason"');

    current.selections.ownerFieldValues = { overDeduction: "是" };
    const withDeduction = JSON.stringify(
      buildCouponThreeSourceMappingCard(current),
    );
    expect(withDeduction).toContain('"name":"owner_overDeductionReason"');
    expect(withDeduction).toContain(
      '"name":"owner_overDeductionReason","label":{"tag":"plain_text","content":"超扣原因"},"input_type":"multiline_text","rows":3,"required":true',
    );
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
});
