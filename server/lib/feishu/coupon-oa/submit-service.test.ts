import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./approval-client", () => ({
  createCouponApprovalInstance: vi.fn(),
  getCouponApprovalDefinition: vi.fn(),
  getCouponApprovalInstance: vi.fn(),
  getCouponOaApplicantProfile: vi.fn(),
}));
vi.mock("./config", () => ({
  assertCouponOaNativeSubmitAllowed: vi.fn(),
  getCouponOaApprovalCode: vi.fn(() => "approval-code"),
}));
vi.mock("./draft-store", () => ({ updateCouponOaDraft: vi.fn() }));

import {
  createCouponApprovalInstance,
  getCouponApprovalDefinition,
  getCouponApprovalInstance,
  getCouponOaApplicantProfile,
} from "./approval-client";
import {
  bindCouponApprovalSchema,
  type CouponApprovalDefinition,
} from "./approval-schema";
import {
  assertCouponOaNativeSubmitAllowed,
  getCouponOaApprovalCode,
} from "./config";
import { updateCouponOaDraft } from "./draft-store";
import {
  confirmCouponOaDraft,
  submitConfirmedCouponOaDraft,
} from "./submit-service";

const options = (items: string[]) =>
  items.map((text) => ({ value: `option:${text}`, text }));

const definition: CouponApprovalDefinition = {
  approvalCode: "approval-code",
  form: JSON.stringify([
    { id: "department", name: "部门", type: "department" },
    { id: "applicant", name: "申请人", type: "contact" },
    {
      id: "applicationType",
      name: "申请类型",
      type: "radioV2",
      option: options(["优惠券申请", "优惠券修改"]),
    },
    {
      id: "businessMode",
      name: "业务模式",
      type: "radioV2",
      option: options(["严选", "寄卖", "pop"]),
    },
    { id: "activityName", name: "活动名称", type: "input" },
    { id: "activityBackground", name: "活动背景", type: "textarea" },
    {
      id: "modificationType",
      name: "修改类型",
      type: "radioV2",
      option: options(["关闭优惠券批次", "增加商家id或sku", "剔除商家id或sku"]),
    },
    { id: "modificationReason", name: "修改背景&原因描述", type: "textarea" },
    { id: "point", name: "活动点位(%)", type: "number" },
    { id: "share", name: "平台承担比例(%)", type: "number" },
    {
      id: "overDeduction",
      name: "是否超扣点",
      type: "radioV2",
      option: options(["是", "否"]),
    },
    { id: "overDeductionReason", name: "超扣点原因", type: "textarea" },
    { id: "gmv", name: "预估GMV", type: "amount" },
    { id: "cost", name: "预估费用", type: "amount" },
    { id: "roi", name: "ROI", type: "formula" },
    {
      id: "channels",
      name: "配置渠道",
      type: "checkboxV2",
      option: options(["京东渠道", "严选APP及小程序"]),
    },
    { id: "period", name: "DateInterval", type: "dateInterval" },
    { id: "image", name: "请上传具体满减测算图片", type: "image" },
    {
      id: "couponTable",
      name: "请上传配券信息表（按模版填写）",
      type: "attachmentV2",
    },
    { id: "whitelist", name: "请上传商品明细白名单", type: "attachmentV2" },
    { id: "blacklist", name: "请上传商品明细黑名单", type: "attachmentV2" },
    { id: "related", name: "关联优惠券申请审批", type: "connect" },
    { id: "batchIds", name: "涉及修改批次ID", type: "textarea" },
    { id: "addItems", name: "请上传增加商家id或sku明细", type: "attachmentV2" },
    {
      id: "removeItems",
      name: "请上传剔除商家id或sku明细",
      type: "attachmentV2",
    },
  ]),
};

const values = {
  applicationType: "优惠券申请" as const,
  businessMode: "寄卖" as const,
  activityName: "测试活动",
  activityBackground: "测试背景",
  overDeduction: "否" as const,
  estimatedGmvYuan: 10_000,
  estimatedCostYuan: 100,
  channels: ["京东渠道"] as ("京东渠道" | "严选APP及小程序")[],
  activityStartAt: "2030-01-01",
  activityEndAt: "2030-01-01",
  calcImageFileCodes: ["image"],
  couponTableFileCodes: ["coupon"],
  productWhitelistFileCodes: ["white"],
};

function draft(status: "Draft" | "Confirmed" = "Draft") {
  return {
    recordId: "rec-draft",
    draftId: "COA-draft",
    ownerOpenId: "ou_submitter",
    status,
    schemaVersion: "v1",
    definitionHash:
      status === "Confirmed"
        ? bindCouponApprovalSchema(definition).definitionHash
        : undefined,
    values:
      status === "Confirmed"
        ? {
            ...values,
            identitySnapshot: {
              openId: "ou_submitter",
              userId: "user_submitter",
              displayName: "测试提报人",
              departmentOpenId: "od_primary",
              resolvedAt: "2030-01-01T00:00:00.000Z",
            },
          }
        : values,
    attachments: [],
    validationIssues: [],
  };
}

describe("coupon OA submit service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertCouponOaNativeSubmitAllowed).mockImplementation(
      () => undefined,
    );
    vi.mocked(getCouponOaApprovalCode).mockReturnValue("approval-code");
    vi.mocked(getCouponApprovalDefinition).mockResolvedValue(definition);
    vi.mocked(getCouponOaApplicantProfile).mockResolvedValue({
      openId: "ou_submitter",
      userId: "user_submitter",
      displayName: "测试提报人",
      departmentOpenIds: ["od_primary"],
      primaryDepartmentOpenId: "od_primary",
    });
    vi.mocked(updateCouponOaDraft).mockImplementation(
      async (value, updates) => ({
        ...value,
        ...updates,
      }),
    );
  });

  it("freezes the current definition hash before confirmation", async () => {
    await expect(confirmCouponOaDraft(draft())).resolves.toMatchObject({
      status: "Confirmed",
      definitionHash: bindCouponApprovalSchema(definition).definitionHash,
      values: {
        identitySnapshot: {
          openId: "ou_submitter",
          userId: "user_submitter",
          departmentOpenId: "od_primary",
        },
      },
    });
  });

  it("blocks confirmation when the confirmer has no unambiguous department", async () => {
    vi.mocked(getCouponOaApplicantProfile).mockResolvedValue({
      openId: "ou_submitter",
      userId: "user_submitter",
      displayName: "测试提报人",
      departmentOpenIds: ["od_one", "od_two"],
    });

    await expect(confirmCouponOaDraft(draft())).rejects.toThrow(
      "无法唯一确定申请部门",
    );
    expect(updateCouponOaDraft).not.toHaveBeenCalled();
  });

  it("fails closed when the native definition changed after confirmation", async () => {
    vi.mocked(getCouponApprovalDefinition).mockResolvedValue({
      ...definition,
      form: definition.form.replace('"pop"', '"pop-updated"'),
    });
    await expect(
      submitConfirmedCouponOaDraft(draft("Confirmed")),
    ).rejects.toThrow("definition changed");
    expect(createCouponApprovalInstance).not.toHaveBeenCalled();
  });

  it("checks the native submit gate before reading or creating an approval", async () => {
    vi.mocked(assertCouponOaNativeSubmitAllowed).mockImplementation(() => {
      throw new Error("Coupon OA native submit kill switch is closed");
    });

    await expect(
      submitConfirmedCouponOaDraft(draft("Confirmed")),
    ).rejects.toThrow("kill switch is closed");
    expect(getCouponApprovalDefinition).not.toHaveBeenCalled();
    expect(createCouponApprovalInstance).not.toHaveBeenCalled();
  });

  it("creates without route overrides and marks matching result submitted", async () => {
    vi.mocked(createCouponApprovalInstance).mockResolvedValue({
      instanceCode: "instance-code",
      instanceLink: "https://example.test/instance",
    });
    const encoded = [
      {
        id: "department",
        type: "department",
        value: [{ open_id: "od_primary" }],
      },
      {
        id: "applicant",
        type: "contact",
        value: ["user_submitter"],
        open_ids: ["ou_submitter"],
      },
      { id: "applicationType", type: "radioV2", value: "option:优惠券申请" },
      { id: "businessMode", type: "radioV2", value: "option:寄卖" },
      { id: "activityName", type: "input", value: "测试活动" },
      { id: "activityBackground", type: "textarea", value: "测试背景" },
      { id: "overDeduction", type: "radioV2", value: "option:否" },
      { id: "gmv", type: "amount", value: 10000, currency: "CNY" },
      { id: "cost", type: "amount", value: 100, currency: "CNY" },
      { id: "channels", type: "checkboxV2", value: ["option:京东渠道"] },
      {
        id: "period",
        type: "dateInterval",
        value: {
          start: "2030-01-01T00:00:00+08:00",
          end: "2030-01-01T23:59:59+08:00",
          interval: 1,
        },
      },
      { id: "image", type: "image", value: ["image"] },
      { id: "couponTable", type: "attachmentV2", value: ["coupon"] },
      { id: "whitelist", type: "attachmentV2", value: ["white"] },
    ];
    vi.mocked(getCouponApprovalInstance).mockResolvedValue({
      form: JSON.stringify(encoded),
    });

    await expect(
      submitConfirmedCouponOaDraft(draft("Confirmed")),
    ).resolves.toMatchObject({
      draft: { status: "Submitted", approvalInstanceCode: "instance-code" },
      verificationIssues: [],
    });
    expect(createCouponApprovalInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalCode: "approval-code",
        submitterOpenId: "ou_submitter",
      }),
    );
  });

  it("preserves the created native instance when readback fails", async () => {
    vi.mocked(createCouponApprovalInstance).mockResolvedValue({
      instanceCode: "instance-code",
      instanceLink: "https://example.test/instance",
    });
    vi.mocked(getCouponApprovalInstance).mockRejectedValue(
      new Error("approval readback unavailable"),
    );

    await expect(
      submitConfirmedCouponOaDraft(draft("Confirmed")),
    ).resolves.toMatchObject({
      draft: {
        status: "CreatedNeedsReview",
        approvalInstanceCode: "instance-code",
        approvalInstanceLink: "https://example.test/instance",
      },
      verificationIssues: ["approval readback unavailable"],
    });
    expect(updateCouponOaDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "Submitting",
        approvalInstanceCode: "instance-code",
      }),
    );
  });

  it("marks an indeterminate create failure as submission unknown", async () => {
    vi.mocked(createCouponApprovalInstance).mockRejectedValue(
      new Error("approval create timed out"),
    );

    await expect(
      submitConfirmedCouponOaDraft(draft("Confirmed")),
    ).rejects.toMatchObject({
      message: "approval create timed out",
      draft: {
        status: "SubmissionUnknown",
        failureReason:
          "Coupon OA create outcome requires reconciliation: approval create timed out",
      },
    });
    expect(getCouponApprovalInstance).not.toHaveBeenCalled();
    expect(updateCouponOaDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "SubmissionUnknown" }),
    );
  });
});
