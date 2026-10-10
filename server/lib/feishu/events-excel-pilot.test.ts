import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({ sendFeishuCard: vi.fn() }));
vi.mock("./coupon-oa/approval-client", () => ({
  downloadFeishuMessageResource: vi.fn(),
  getFeishuMessageBody: vi.fn(),
  uploadCouponApprovalFile: vi.fn(),
}));
vi.mock("./message-client", () => ({
  downloadFeishuMessageResource: vi.fn(),
  getFeishuMessageBody: vi.fn(),
}));
vi.mock("./coupon-oa/excel-pilot-config", () => ({
  isCouponExcelPilotEnabled: vi.fn(() => true),
  isCouponExcelPilotInvocation: vi.fn(
    (text: string) => text === "优惠券Excel试点",
  ),
}));
vi.mock("./coupon-oa/excel-pilot-store", () => ({
  createCouponExcelPilotDraft: vi.fn(),
  getCouponExcelPilotDraft: vi.fn(),
  listActiveCouponExcelPilotDrafts: vi.fn(),
  updateCouponExcelPilotDraft: vi.fn(),
}));
vi.mock("./coupon-oa/excel-pilot-service", () => ({
  confirmCouponPilotInput: vi.fn(),
  confirmCouponPilotOutput: vi.fn(),
  extractAndSaveCouponPilotInput: vi.fn(),
  generateCouponPilotArtifacts: vi.fn(),
  saveCouponPilotWhitelistMapping: vi.fn(),
  saveCouponPilotWhitelistSource: vi.fn(),
}));
vi.mock("./coupon-oa/excel-pilot-oa-handoff", () => ({
  handoffCouponPilotToOaDraft: vi.fn(),
}));
vi.mock("./coupon-oa/draft-store", () => ({
  getCouponOaDraft: vi.fn(),
  listActiveCouponOaDrafts: vi.fn(),
  saveCouponOaDraft: vi.fn(),
  updateCouponOaDraft: vi.fn(),
}));
vi.mock("./coupon-oa/draft-service", () => ({
  attachCouponOaFile: vi.fn(),
  classifyCouponOaAttachment: vi.fn(),
  missingCouponOaAttachments: vi.fn(),
  parseCouponApplicationDraftForm: vi.fn(),
  validateCouponApplicationDraft: vi.fn(),
}));
vi.mock("./coupon-oa/submit-service", () => ({
  confirmCouponOaDraft: vi.fn(),
  submitConfirmedCouponOaDraft: vi.fn(),
}));
vi.mock("./base-store", () => ({
  createWorkflowInstance: vi.fn(),
  decideWorkflowInstance: vi.fn(),
  getPublishedExpenseTemplate: vi.fn(),
  getTemplateByRecordId: vi.fn(),
}));

import { sendFeishuCard } from "./client";
import { uploadCouponApprovalFile } from "./coupon-oa/approval-client";
import {
  listActiveCouponOaDrafts,
  saveCouponOaDraft,
} from "./coupon-oa/draft-store";
import { isCouponExcelPilotEnabled } from "./coupon-oa/excel-pilot-config";
import { handoffCouponPilotToOaDraft } from "./coupon-oa/excel-pilot-oa-handoff";
import {
  confirmCouponPilotInput,
  confirmCouponPilotOutput,
  generateCouponPilotArtifacts,
  saveCouponPilotWhitelistMapping,
  saveCouponPilotWhitelistSource,
} from "./coupon-oa/excel-pilot-service";
import {
  getCouponExcelPilotDraft,
  listActiveCouponExcelPilotDrafts,
  updateCouponExcelPilotDraft,
} from "./coupon-oa/excel-pilot-store";
import { submitConfirmedCouponOaDraft } from "./coupon-oa/submit-service";
import { handleFeishuPocEvent } from "./events";
import {
  downloadFeishuMessageResource,
  getFeishuMessageBody,
} from "./message-client";

const pilot = {
  recordId: "rec-pilot",
  pilotId: "CEP-test",
  ownerOpenId: "ou_test",
  status: "AwaitingWhitelistUpload" as const,
  revision: 2,
  schemaVersion: "coupon-excel-pilot-v1",
  artifacts: [],
  validationIssues: [],
  processedMessageIds: [],
};

describe("coupon Excel pilot event isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FEISHU_VERIFICATION_TOKEN = "verify-me";
    process.env.FEISHU_COUPON_OA_MODE = "native-submit";
    process.env.FEISHU_COUPON_OA_ALLOWED_OPEN_IDS = "ou_test";
    vi.mocked(isCouponExcelPilotEnabled).mockReturnValue(true);
    vi.mocked(listActiveCouponExcelPilotDrafts).mockResolvedValue([pilot]);
    vi.mocked(listActiveCouponOaDrafts).mockResolvedValue([]);
    vi.mocked(getFeishuMessageBody).mockResolvedValue({
      messageType: "file",
      content: JSON.stringify({
        file_key: "source-key",
        file_name: "业务白名单.xlsx",
      }),
    });
    vi.mocked(downloadFeishuMessageResource).mockResolvedValue(
      new Uint8Array([1, 2, 3]),
    );
    vi.mocked(saveCouponPilotWhitelistSource).mockResolvedValue({
      ...pilot,
      status: "AwaitingWhitelistMapping",
      sourceWhitelist: {
        messageId: "om-source",
        fileKey: "source-key",
        fileName: "业务白名单.xlsx",
        bytes: 3,
        sha256: "hash",
        candidates: [],
      },
    });
  });

  it("routes a pilot whitelist to the pilot handler without approval upload", async () => {
    await handleFeishuPocEvent({
      header: { event_type: "im.message.receive_v1", token: "verify-me" },
      event: {
        sender: { sender_id: { open_id: "ou_test" } },
        message: {
          message_id: "om-source",
          message_type: "file",
          content: JSON.stringify({ file_name: "业务白名单.xlsx" }),
        },
      },
    });

    expect(getFeishuMessageBody).toHaveBeenCalledWith({
      messageId: "om-source",
    });
    expect(downloadFeishuMessageResource).toHaveBeenCalledWith({
      messageId: "om-source",
      fileKey: "source-key",
      type: "file",
    });
    expect(saveCouponPilotWhitelistSource).toHaveBeenCalledOnce();
    expect(uploadCouponApprovalFile).not.toHaveBeenCalled();
  });

  it("does not handle a pilot file when an OA draft also exists", async () => {
    vi.mocked(listActiveCouponOaDrafts).mockResolvedValue([
      { recordId: "rec-oa" } as never,
    ]);

    await handleFeishuPocEvent({
      header: { event_type: "im.message.receive_v1", token: "verify-me" },
      event: {
        sender: { sender_id: { open_id: "ou_test" } },
        message: {
          message_id: "om-source",
          message_type: "file",
          content: "{}",
        },
      },
    });

    expect(downloadFeishuMessageResource).not.toHaveBeenCalled();
    expect(uploadCouponApprovalFile).not.toHaveBeenCalled();
  });

  it("blocks OA form entry while an Excel pilot is active", async () => {
    await handleFeishuPocEvent({
      header: { event_type: "im.message.receive_v1", token: "verify-me" },
      event: {
        sender: { sender_id: { open_id: "ou_test" } },
        message: {
          message_id: "om-oa-entry",
          message_type: "text",
          content: JSON.stringify({ text: "OA优惠券填报" }),
        },
      },
    });

    expect(
      JSON.stringify(vi.mocked(sendFeishuCard).mock.calls[0]?.[1]),
    ).toContain("已有未完成的优惠券 Excel 试点");
  });

  it("blocks a stale OA form save when an Excel pilot is active", async () => {
    await handleFeishuPocEvent({
      header: { token: "verify-me" },
      operator: { open_id: "ou_test" },
      action: {
        name: "coupon_oa_draft_save",
        form_value: { activityName: "测试活动" },
      },
    });

    expect(saveCouponOaDraft).not.toHaveBeenCalled();
    expect(
      JSON.stringify(vi.mocked(sendFeishuCard).mock.calls[0]?.[1]),
    ).toContain("已有未完成的优惠券 Excel 试点");
  });

  it("expires a stale pilot before processing a file", async () => {
    const stalePilot = {
      ...pilot,
      updatedAt: "2026-09-30T00:00:00.000Z",
    };
    vi.mocked(listActiveCouponExcelPilotDrafts).mockResolvedValue([stalePilot]);
    vi.mocked(updateCouponExcelPilotDraft).mockResolvedValue({
      ...stalePilot,
      status: "Canceled",
    });

    await handleFeishuPocEvent({
      header: { event_type: "im.message.receive_v1", token: "verify-me" },
      event: {
        sender: { sender_id: { open_id: "ou_test" } },
        message: {
          message_id: "om-stale-source",
          message_type: "file",
          content: "{}",
        },
      },
    });

    expect(updateCouponExcelPilotDraft).toHaveBeenCalledWith(stalePilot, {
      status: "Canceled",
    });
    expect(downloadFeishuMessageResource).not.toHaveBeenCalled();
    expect(uploadCouponApprovalFile).not.toHaveBeenCalled();
  });

  it("allows the pilot owner to end an active Excel pilot", async () => {
    vi.mocked(getCouponExcelPilotDraft).mockResolvedValue(pilot);
    vi.mocked(updateCouponExcelPilotDraft).mockResolvedValue({
      ...pilot,
      status: "Canceled",
    });

    await handleFeishuPocEvent({
      header: { token: "verify-me" },
      operator: { open_id: "ou_test" },
      action: {
        value: {
          action: "coupon_excel_pilot_cancel",
          pilotRecordId: "rec-pilot",
          revision: 2,
        },
      },
    });

    expect(updateCouponExcelPilotDraft).toHaveBeenCalledWith(pilot, {
      status: "Canceled",
    });
    expect(
      JSON.stringify(vi.mocked(sendFeishuCard).mock.calls[0]?.[1]),
    ).toContain("Excel 试点已结束");
  });

  it("rejects a whitelist file before the coupon fields are confirmed", async () => {
    vi.mocked(listActiveCouponExcelPilotDrafts).mockResolvedValue([
      { ...pilot, status: "AwaitingInputConfirmation" },
    ]);

    await handleFeishuPocEvent({
      header: { event_type: "im.message.receive_v1", token: "verify-me" },
      event: {
        sender: { sender_id: { open_id: "ou_test" } },
        message: {
          message_id: "om-before-confirm",
          message_type: "file",
          content: "{}",
        },
      },
    });

    expect(downloadFeishuMessageResource).not.toHaveBeenCalled();
    expect(saveCouponPilotWhitelistSource).not.toHaveBeenCalled();
    expect(uploadCouponApprovalFile).not.toHaveBeenCalled();
  });

  it("persists input confirmation before accepting a whitelist", async () => {
    const awaitingConfirmation = {
      ...pilot,
      status: "AwaitingInputConfirmation" as const,
      input: {} as never,
    };
    vi.mocked(getCouponExcelPilotDraft).mockResolvedValue(awaitingConfirmation);
    vi.mocked(confirmCouponPilotInput).mockResolvedValue({
      ...awaitingConfirmation,
      status: "AwaitingWhitelistUpload",
      revision: 3,
    });

    await handleFeishuPocEvent({
      header: { token: "verify-me" },
      operator: { open_id: "ou_test" },
      action: {
        value: {
          action: "coupon_excel_pilot_input_confirm",
          pilotRecordId: "rec-pilot",
          revision: 2,
        },
      },
    });

    expect(confirmCouponPilotInput).toHaveBeenCalledWith(awaitingConfirmation);
  });

  it("rejects an outdated whitelist mapping card before generation", async () => {
    vi.mocked(getCouponExcelPilotDraft).mockResolvedValue({
      ...pilot,
      status: "AwaitingWhitelistMapping",
      revision: 2,
    });

    await handleFeishuPocEvent({
      header: { token: "verify-me" },
      operator: { open_id: "ou_test" },
      action: {
        name: "coupon_excel_pilot_mapping_confirm:rec-pilot:1",
        form_value: {
          mapping: JSON.stringify({
            sheetName: "100减1",
            column: "A",
            header: "SKUID",
          }),
        },
      },
    });

    expect(saveCouponPilotWhitelistMapping).not.toHaveBeenCalled();
    expect(generateCouponPilotArtifacts).not.toHaveBeenCalled();
    expect(uploadCouponApprovalFile).not.toHaveBeenCalled();
  });

  it("fills only a system OA draft after Excel confirmation", async () => {
    const awaitingOutput = {
      ...pilot,
      status: "AwaitingOutputConfirmation" as const,
      input: {} as never,
      artifacts: [{ role: "couponTable" }, { role: "productWhitelist" }],
    };
    const handingOff = {
      ...awaitingOutput,
      status: "HandingOffToOa" as const,
      revision: 3,
    };
    const oaDraft = {
      recordId: "rec-oa",
      draftId: "COA-test",
      ownerOpenId: "ou_test",
      status: "Draft" as const,
      values: {
        applicationType: "优惠券申请" as const,
        businessMode: "寄卖" as const,
        couponTableFileCodes: ["coupon"],
        productWhitelistFileCodes: ["white"],
      },
      attachments: [],
      validationIssues: [],
    };
    vi.mocked(getCouponExcelPilotDraft).mockResolvedValue(
      awaitingOutput as never,
    );
    vi.mocked(confirmCouponPilotOutput).mockResolvedValue(handingOff as never);
    vi.mocked(handoffCouponPilotToOaDraft).mockResolvedValue({
      pilot: { ...handingOff, status: "GeneratedConfirmed" },
      oaDraft,
    } as never);
    const { missingCouponOaAttachments } = await import(
      "./coupon-oa/draft-service"
    );
    vi.mocked(missingCouponOaAttachments).mockReturnValue(["具体满减测算图片"]);

    await handleFeishuPocEvent({
      header: { token: "verify-me" },
      operator: { open_id: "ou_test" },
      action: {
        value: {
          action: "coupon_excel_pilot_output_confirm",
          pilotRecordId: "rec-pilot",
          revision: 2,
        },
      },
    });

    expect(confirmCouponPilotOutput).toHaveBeenCalledWith(awaitingOutput);
    expect(handoffCouponPilotToOaDraft).toHaveBeenCalledWith(handingOff);
    expect(uploadCouponApprovalFile).not.toHaveBeenCalled();
    expect(submitConfirmedCouponOaDraft).not.toHaveBeenCalled();
  });

  it("does not promote generated files while OA draft-demo mode is enabled", async () => {
    process.env.FEISHU_COUPON_OA_MODE = "draft-demo";
    vi.mocked(getCouponExcelPilotDraft).mockResolvedValue({
      ...pilot,
      status: "AwaitingOutputConfirmation",
      input: {} as never,
      artifacts: [{ role: "couponTable" }, { role: "productWhitelist" }],
    } as never);

    await handleFeishuPocEvent({
      header: { token: "verify-me" },
      operator: { open_id: "ou_test" },
      action: {
        value: {
          action: "coupon_excel_pilot_output_confirm",
          pilotRecordId: "rec-pilot",
          revision: 2,
        },
      },
    });

    expect(handoffCouponPilotToOaDraft).not.toHaveBeenCalled();
  });
});
