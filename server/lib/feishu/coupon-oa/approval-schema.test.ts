import { describe, expect, it } from "vitest";
import {
  bindCouponApprovalSchema,
  type CouponApprovalDefinition,
  couponApplicationValuesSchema,
  diffSubmittedApprovalForm,
  encodeCouponOaForm,
  getCouponApprovalDefinitionHash,
} from "./approval-schema";

const options = (items: string[]) =>
  items.map((text) => ({ value: `option:${text}`, text }));

const definition: CouponApprovalDefinition = {
  approvalCode: "approval-coupon",
  nodeList: [
    { node_id: "submit", node_type: "AND", name: "提交" },
    { node_id: "approval", node_type: "SEQUENTIAL", name: "部门审批" },
  ],
  form: JSON.stringify([
    { id: "department", name: "部门", type: "department", required: true },
    { id: "applicant", name: "申请人", type: "contact", required: true },
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

describe("coupon OA approval schema", () => {
  it("fails closed when the definition omits a required control", () => {
    const broken = {
      ...definition,
      form: JSON.stringify(JSON.parse(definition.form).slice(1)),
    };
    expect(() => bindCouponApprovalSchema(broken)).toThrow("missing 部门");
  });

  it("changes its fingerprint when a routing-relevant option changes", () => {
    const altered = JSON.parse(definition.form);
    altered[3].option = options(["严选", "寄卖"]);
    expect(getCouponApprovalDefinitionHash(definition)).not.toBe(
      getCouponApprovalDefinitionHash({
        ...definition,
        form: JSON.stringify(altered),
      }),
    );
  });

  it("validates the fields required for a consign application", () => {
    const result = couponApplicationValuesSchema.safeParse({
      applicationType: "优惠券申请",
      businessMode: "寄卖",
      activityName: "测试活动",
      activityBackground: "测试背景",
      overDeduction: "否",
      estimatedGmvYuan: 10_000,
      estimatedCostYuan: 100,
      channels: ["京东渠道", "严选APP及小程序"],
      activityStartAt: "2030-01-01",
      activityEndAt: "2030-01-02",
      calcImageFileCodes: ["image-code"],
      couponTableFileCodes: ["coupon-code"],
      productWhitelistFileCodes: ["white-code"],
    });
    expect(result.success).toBe(true);
  });

  it("encodes documented native approval control values and omits formula", () => {
    const schema = bindCouponApprovalSchema(definition);
    const form = encodeCouponOaForm(
      schema,
      couponApplicationValuesSchema.parse({
        applicationType: "优惠券申请",
        businessMode: "寄卖",
        activityName: "测试活动",
        activityBackground: "测试背景",
        activityPointPercent: 10,
        platformBearingPercent: 50,
        overDeduction: "否",
        estimatedGmvYuan: 10_000,
        estimatedCostYuan: 100,
        channels: ["京东渠道", "严选APP及小程序"],
        activityStartAt: "2030-01-01",
        activityEndAt: "2030-01-02",
        calcImageFileCodes: ["image-code"],
        couponTableFileCodes: ["coupon-code"],
        productWhitelistFileCodes: ["white-code"],
      }),
      {
        openId: "ou_submitter",
        userId: "user_submitter",
        departmentOpenId: "od_department",
      },
    );

    expect(form).toContainEqual({
      id: "period",
      type: "dateInterval",
      value: {
        start: "2030-01-01T00:00:00+08:00",
        end: "2030-01-02T23:59:59+08:00",
        interval: 2,
      },
    });
    expect(form).toContainEqual({
      id: "gmv",
      type: "amount",
      value: 10_000,
      currency: "CNY",
    });
    expect(form).toContainEqual({
      id: "channels",
      type: "checkboxV2",
      value: ["option:京东渠道", "option:严选APP及小程序"],
    });
    expect(form.some((control) => control.id === "roi")).toBe(false);
    expect(form).toContainEqual({ id: "point", type: "number", value: 10 });
    expect(form).toContainEqual({ id: "share", type: "number", value: 50 });
  });

  it("accepts Feishu option, amount, and Shanghai date normalization", () => {
    const schema = bindCouponApprovalSchema(definition);
    const expected = [
      { id: "applicationType", type: "radioV2", value: "option:优惠券申请" },
      {
        id: "channels",
        type: "checkboxV2",
        value: ["option:京东渠道", "option:严选APP及小程序"],
      },
      { id: "gmv", type: "amount", value: 10000, currency: "CNY" },
      {
        id: "period",
        type: "dateInterval",
        value: {
          start: "2030-01-01T00:00:00+08:00",
          end: "2030-01-02T23:59:59+08:00",
          interval: 2,
        },
      },
    ];
    const actual = [
      { id: "applicationType", type: "radioV2", value: "优惠券申请" },
      {
        id: "channels",
        type: "checkboxV2",
        value: ["严选APP及小程序", "京东渠道"],
      },
      {
        id: "gmv",
        type: "amount",
        value: {
          amount: "10000.00",
          ext: { currency: "CNY", display: "¥10,000" },
        },
      },
      {
        id: "period",
        type: "dateInterval",
        value: {
          start: "2029-12-31T16:00:00.000Z",
          end: "2030-01-02T15:59:59.000Z",
          interval: "2",
          timezoneOffset: 480,
        },
      },
    ];

    expect(diffSubmittedApprovalForm(schema, expected, actual)).toEqual({
      issues: [],
      needsReview: [],
    });
  });

  it("requires review rather than falsely matching attachment URLs", () => {
    const schema = bindCouponApprovalSchema(definition);
    const result = diffSubmittedApprovalForm(
      schema,
      [
        {
          id: "couponTable",
          type: "attachmentV2",
          value: ["approval-file-code"],
        },
      ],
      [
        {
          id: "couponTable",
          type: "attachmentV2",
          value: ["https://example.test/signed-file"],
        },
      ],
    );

    expect(result.issues).toEqual([]);
    expect(result.needsReview).toHaveLength(1);
  });

  it("verifies display-URL attachment readback by file name", () => {
    const schema = bindCouponApprovalSchema(definition);
    const attachmentFileNames = new Map([
      ["code-a", "配券信息表_v5.xlsx"],
      ["code-b", "商品明细白名单_v5.xlsx"],
    ]);
    const result = diffSubmittedApprovalForm(
      schema,
      [
        {
          id: "couponTable",
          type: "attachmentV2",
          value: ["code-a", "code-b"],
        },
      ],
      [
        {
          id: "couponTable",
          type: "attachmentV2",
          value: [
            "https://lf6-approval-sign.feishucdn.com/1.xlsx?x-expires=1",
            "https://lf6-approval-sign.feishucdn.com/2.xlsx?x-expires=1",
          ],
          ext: "商品明细白名单_v5.xlsx,配券信息表_v5.xlsx",
        },
      ],
      { attachmentFileNames },
    );

    expect(result).toEqual({ issues: [], needsReview: [] });
  });

  it("requires review when display-URL file names cannot be matched", () => {
    const schema = bindCouponApprovalSchema(definition);
    const result = diffSubmittedApprovalForm(
      schema,
      [
        {
          id: "couponTable",
          type: "attachmentV2",
          value: ["code-a"],
        },
      ],
      [
        {
          id: "couponTable",
          type: "attachmentV2",
          value: ["https://example.test/signed-file"],
          ext: "另一个文件.xlsx",
        },
      ],
      {
        attachmentFileNames: new Map([["code-a", "配券信息表_v5.xlsx"]]),
      },
    );

    expect(result.issues).toEqual([]);
    expect(result.needsReview).toHaveLength(1);
  });

  it("flags a definitive issue when display-URL counts differ", () => {
    const schema = bindCouponApprovalSchema(definition);
    const result = diffSubmittedApprovalForm(
      schema,
      [
        {
          id: "couponTable",
          type: "attachmentV2",
          value: ["code-a"],
        },
      ],
      [
        {
          id: "couponTable",
          type: "attachmentV2",
          value: ["https://example.test/1", "https://example.test/2"],
          ext: "a.xlsx,b.xlsx",
        },
      ],
      {
        attachmentFileNames: new Map([["code-a", "配券信息表_v5.xlsx"]]),
      },
    );

    expect(result.issues).toHaveLength(1);
    expect(result.needsReview).toEqual([]);
  });

  it("rejects genuinely changed native values and duplicate controls", () => {
    const schema = bindCouponApprovalSchema(definition);
    const result = diffSubmittedApprovalForm(
      schema,
      [{ id: "activityName", type: "input", value: "正确活动" }],
      [
        { id: "activityName", type: "input", value: "被改写的活动" },
        { id: "activityName", type: "input", value: "重复值" },
      ],
    );

    expect(result.issues).toEqual(["活动名称：OA 表单中该控件重复出现"]);
  });

  it("treats float-tail and cent-rounding amount differences as equal", () => {
    const schema = bindCouponApprovalSchema(definition);
    const result = diffSubmittedApprovalForm(
      schema,
      [
        { id: "cost", type: "amount", value: 450000.00000000006 },
        { id: "gmv", type: "amount", value: "1904761.8999999999" },
      ],
      [
        { id: "cost", type: "amount", value: 450000 },
        { id: "gmv", type: "amount", value: 1904761.9 },
      ],
    );

    expect(result.issues).toEqual([]);
  });

  it("reports genuine amount differences with control names and both values", () => {
    const schema = bindCouponApprovalSchema(definition);
    const result = diffSubmittedApprovalForm(
      schema,
      [{ id: "cost", type: "amount", value: 26137.9 }],
      [{ id: "cost", type: "amount", value: 26100 }],
    );

    expect(result.issues).toEqual([
      "预估费用：提交 26,137.9 / OA 实际 26,100，请核对",
    ]);
  });

  it("accepts nested value.currency readback form", () => {
    const schema = bindCouponApprovalSchema(definition);
    const result = diffSubmittedApprovalForm(
      schema,
      [
        {
          id: "cost",
          type: "amount",
          value: { amount: 100, currency: "CNY" },
        },
      ],
      [
        {
          id: "cost",
          type: "amount",
          value: { amount: 100, currency: "CNY" },
        },
      ],
    );

    expect(result.issues).toEqual([]);
  });
});
