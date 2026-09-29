import { createHash } from "node:crypto";
import { z } from "zod";

export const couponApprovalSchemaVersion = "coupon-oa-submit-schema-v1";

export interface ApprovalFormControl {
  id: string;
  name: string;
  type: string;
  required?: boolean;
  option?: unknown;
  display_condition?: unknown;
}

export interface CouponApprovalDefinition {
  approvalCode: string;
  form: string;
  nodeList?: Array<{
    node_id?: string;
    node_type?: string;
    name?: string;
  }>;
}

export interface ApprovalFormValue {
  id: string;
  type: string;
  value: unknown;
  currency?: string;
  open_ids?: string[];
}

export const couponApplicationValuesSchema = z
  .object({
    applicationType: z.literal("优惠券申请"),
    businessMode: z.enum(["严选", "寄卖", "pop"]),
    activityName: z.string().trim().min(1).max(200),
    activityBackground: z.string().trim().min(1).max(4000),
    overDeduction: z.enum(["是", "否"]).optional(),
    overDeductionReason: z.string().trim().max(4000).optional(),
    estimatedGmvYuan: z.number().positive().finite().optional(),
    estimatedCostYuan: z.number().positive().finite().optional(),
    channels: z.array(z.enum(["京东渠道", "严选APP及小程序"])).min(1),
    activityStartAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    activityEndAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    calcImageFileCodes: z.array(z.string().min(1)).min(1).optional(),
    couponTableFileCodes: z.array(z.string().min(1)).min(1),
    productWhitelistFileCodes: z.array(z.string().min(1)).min(1),
    productBlacklistFileCodes: z.array(z.string().min(1)).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.activityEndAt < value.activityStartAt) {
      ctx.addIssue({
        code: "custom",
        path: ["activityEndAt"],
        message: "活动结束日期不能早于开始日期",
      });
    }

    const requiresFinancialFields = value.businessMode !== "严选";
    if (requiresFinancialFields) {
      if (!value.overDeduction) {
        ctx.addIssue({
          code: "custom",
          path: ["overDeduction"],
          message: "寄卖和 pop 申请必须填写是否超扣点",
        });
      }
      if (value.overDeduction === "是" && !value.overDeductionReason) {
        ctx.addIssue({
          code: "custom",
          path: ["overDeductionReason"],
          message: "超扣点申请必须填写原因",
        });
      }
      if (!value.estimatedGmvYuan) {
        ctx.addIssue({
          code: "custom",
          path: ["estimatedGmvYuan"],
          message: "寄卖和 pop 申请必须填写预估 GMV",
        });
      }
      if (!value.estimatedCostYuan) {
        ctx.addIssue({
          code: "custom",
          path: ["estimatedCostYuan"],
          message: "寄卖和 pop 申请必须填写预估费用",
        });
      }
      if (!value.calcImageFileCodes?.length) {
        ctx.addIssue({
          code: "custom",
          path: ["calcImageFileCodes"],
          message: "寄卖和 pop 申请必须上传满减测算图片",
        });
      }
    }
  });

export type CouponApplicationValues = z.infer<
  typeof couponApplicationValuesSchema
>;

export const couponModificationValuesSchema = z
  .object({
    applicationType: z.literal("优惠券修改"),
    businessMode: z.enum(["严选", "寄卖", "pop"]),
    activityName: z.string().trim().min(1).max(200),
    modificationType: z.enum([
      "关闭优惠券批次",
      "增加商家id或sku",
      "剔除商家id或sku",
    ]),
    modificationReason: z.string().trim().min(1).max(4000),
    relatedApprovalInstanceCode: z.string().trim().min(1),
    batchIds: z.string().trim().min(1).max(4000),
    addItemsFileCodes: z.array(z.string().min(1)).min(1).optional(),
    removeItemsFileCodes: z.array(z.string().min(1)).min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.modificationType === "增加商家id或sku" &&
      !value.addItemsFileCodes?.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["addItemsFileCodes"],
        message: "增加商家 ID 或 SKU 时必须上传明细",
      });
    }
    if (
      value.modificationType === "剔除商家id或sku" &&
      !value.removeItemsFileCodes?.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["removeItemsFileCodes"],
        message: "剔除商家 ID 或 SKU 时必须上传明细",
      });
    }
  });

export type CouponModificationValues = z.infer<
  typeof couponModificationValuesSchema
>;
export type CouponOaValues = CouponApplicationValues | CouponModificationValues;

/** A mutable system-side draft may be incomplete until its owner confirms it. */
export interface CouponOaDraftValues {
  applicationType: "优惠券申请" | "优惠券修改";
  businessMode?: "严选" | "寄卖" | "pop";
  activityName?: string;
  activityBackground?: string;
  overDeduction?: "是" | "否";
  overDeductionReason?: string;
  estimatedGmvYuan?: number;
  estimatedCostYuan?: number;
  channels?: string[];
  activityStartAt?: string;
  activityEndAt?: string;
  calcImageFileCodes?: string[];
  couponTableFileCodes?: string[];
  productWhitelistFileCodes?: string[];
  productBlacklistFileCodes?: string[];
  modificationType?: "关闭优惠券批次" | "增加商家id或sku" | "剔除商家id或sku";
  modificationReason?: string;
  relatedApprovalInstanceCode?: string;
  batchIds?: string;
  addItemsFileCodes?: string[];
  removeItemsFileCodes?: string[];
}

const expectedControls = [
  ["部门", "department"],
  ["申请人", "contact"],
  ["申请类型", "radioV2"],
  ["业务模式", "radioV2"],
  ["活动名称", "input"],
  ["活动背景", "textarea"],
  ["修改类型", "radioV2"],
  ["修改背景&原因描述", "textarea"],
  ["活动点位(%)", "number"],
  ["平台承担比例(%)", "number"],
  ["是否超扣点", "radioV2"],
  ["超扣点原因", "textarea"],
  ["预估GMV", "amount"],
  ["预估费用", "amount"],
  ["ROI", "formula"],
  ["配置渠道", "checkboxV2"],
  ["DateInterval", "dateInterval"],
  ["请上传具体满减测算图片", "image"],
  ["请上传配券信息表（按模版填写）", "attachmentV2"],
  ["请上传商品明细白名单", "attachmentV2"],
  ["请上传商品明细黑名单", "attachmentV2"],
  ["关联优惠券申请审批", "connect"],
  ["涉及修改批次ID", "textarea"],
  ["请上传增加商家id或sku明细", "attachmentV2"],
  ["请上传剔除商家id或sku明细", "attachmentV2"],
] as const;

type ControlName = (typeof expectedControls)[number][0];

export interface BoundCouponApprovalSchema {
  approvalCode: string;
  definitionHash: string;
  controls: Record<ControlName, ApprovalFormControl>;
}

function parseControls(
  definition: CouponApprovalDefinition,
): ApprovalFormControl[] {
  let controls: unknown;
  try {
    controls = JSON.parse(definition.form);
  } catch {
    throw new Error("Coupon approval definition form is not valid JSON");
  }
  if (!Array.isArray(controls)) {
    throw new Error("Coupon approval definition form must be an array");
  }
  return controls.map((item) => {
    const parsed = z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        type: z.string().min(1),
        required: z.boolean().optional(),
        option: z.unknown().optional(),
        display_condition: z.unknown().optional(),
      })
      .safeParse(item);
    if (!parsed.success) {
      throw new Error("Coupon approval definition includes an invalid control");
    }
    return parsed.data;
  });
}

export function getCouponApprovalDefinitionHash(
  definition: CouponApprovalDefinition,
): string {
  const controls = parseControls(definition).map((control) => ({
    id: control.id,
    name: control.name,
    type: control.type,
    required: control.required ?? false,
    option: control.option ?? null,
    displayCondition: control.display_condition ?? null,
  }));
  const nodes = (definition.nodeList ?? []).map((node) => ({
    id: node.node_id ?? "",
    name: node.name ?? "",
    type: node.node_type ?? "",
  }));
  return createHash("sha256")
    .update(
      JSON.stringify({
        approvalCode: definition.approvalCode,
        controls,
        nodes,
      }),
    )
    .digest("hex");
}

export function bindCouponApprovalSchema(
  definition: CouponApprovalDefinition,
): BoundCouponApprovalSchema {
  const controls = parseControls(definition);
  const bound = {} as Record<ControlName, ApprovalFormControl>;

  for (const [name, type] of expectedControls) {
    const control = controls.find(
      (candidate) => candidate.name === name && candidate.type === type,
    );
    if (!control) {
      throw new Error(
        `Coupon approval definition is incompatible: missing ${name} (${type})`,
      );
    }
    bound[name] = control;
  }

  return {
    approvalCode: definition.approvalCode,
    definitionHash: getCouponApprovalDefinitionHash(definition),
    controls: bound,
  };
}

function findOptionValue(control: ApprovalFormControl, label: string): string {
  const options = z
    .array(z.object({ text: z.string(), value: z.string() }))
    .safeParse(control.option);
  if (!options.success) {
    throw new Error(
      `Coupon approval control ${control.name} has invalid options`,
    );
  }
  const option = options.data.find((item) => item.text === label);
  if (!option) {
    throw new Error(
      `Coupon approval control ${control.name} does not support ${label}`,
    );
  }
  return option.value;
}

function rfc3339AtShanghaiMidnight(date: string, endOfDay = false): string {
  return `${date}T${endOfDay ? "23:59:59" : "00:00:00"}+08:00`;
}

function daysInclusive(start: string, end: string): number {
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const endTime = Date.parse(`${end}T00:00:00Z`);
  return Math.floor((endTime - startTime) / 86_400_000) + 1;
}

function controlValue(
  control: ApprovalFormControl,
  value: unknown,
  extra: Omit<ApprovalFormValue, "id" | "type" | "value"> = {},
): ApprovalFormValue {
  return { id: control.id, type: control.type, value, ...extra };
}

export interface ApprovalSubmitter {
  openId: string;
  userId?: string;
  departmentOpenId?: string;
  departmentId?: string;
}

/**
 * Builds the documented `form` value for POST /approval/v4/instances.
 * It deliberately omits formula controls: Feishu owns formula calculation and
 * rejects client-provided values that do not exactly match its result.
 */
export function encodeCouponOaForm(
  schema: BoundCouponApprovalSchema,
  values: CouponOaValues,
  submitter: ApprovalSubmitter,
): ApprovalFormValue[] {
  const form: ApprovalFormValue[] = [];
  const add = (
    name: ControlName,
    value: unknown,
    extra?: Omit<ApprovalFormValue, "id" | "type" | "value">,
  ) => form.push(controlValue(schema.controls[name], value, extra));

  if (submitter.departmentOpenId) {
    add("部门", [{ open_id: submitter.departmentOpenId }]);
  }
  if (submitter.userId) {
    add("申请人", [submitter.userId], { open_ids: [submitter.openId] });
  }

  add(
    "申请类型",
    findOptionValue(schema.controls.申请类型, values.applicationType),
  );
  add(
    "业务模式",
    findOptionValue(schema.controls.业务模式, values.businessMode),
  );
  add("活动名称", values.activityName);

  if (values.applicationType === "优惠券申请") {
    add("活动背景", values.activityBackground);

    if (values.businessMode !== "严选") {
      add(
        "是否超扣点",
        findOptionValue(
          schema.controls.是否超扣点,
          values.overDeduction ?? "否",
        ),
      );
      if (values.overDeduction === "是") {
        add("超扣点原因", values.overDeductionReason ?? "");
      }
      add("预估GMV", values.estimatedGmvYuan ?? 0, { currency: "CNY" });
      add("预估费用", values.estimatedCostYuan ?? 0, { currency: "CNY" });
      add("请上传具体满减测算图片", values.calcImageFileCodes ?? []);
    }

    add(
      "配置渠道",
      values.channels.map((channel) =>
        findOptionValue(schema.controls.配置渠道, channel),
      ),
    );
    add("DateInterval", {
      start: rfc3339AtShanghaiMidnight(values.activityStartAt),
      end: rfc3339AtShanghaiMidnight(values.activityEndAt, true),
      interval: daysInclusive(values.activityStartAt, values.activityEndAt),
    });
    add("请上传配券信息表（按模版填写）", values.couponTableFileCodes);
    add("请上传商品明细白名单", values.productWhitelistFileCodes);
    if (values.productBlacklistFileCodes?.length) {
      add("请上传商品明细黑名单", values.productBlacklistFileCodes);
    }
  } else {
    add(
      "修改类型",
      findOptionValue(schema.controls.修改类型, values.modificationType),
    );
    add("修改背景&原因描述", values.modificationReason);
    add("关联优惠券申请审批", [values.relatedApprovalInstanceCode]);
    add("涉及修改批次ID", values.batchIds);
    if (values.addItemsFileCodes?.length) {
      add("请上传增加商家id或sku明细", values.addItemsFileCodes);
    }
    if (values.removeItemsFileCodes?.length) {
      add("请上传剔除商家id或sku明细", values.removeItemsFileCodes);
    }
  }

  return form;
}

export function parseApprovalFormValues(value: string): ApprovalFormValue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Feishu approval instance form is not valid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Feishu approval instance form must be an array");
  }
  return parsed.flatMap((item) => {
    const result = z
      .object({
        id: z.string().min(1),
        type: z.string().min(1),
        value: z.unknown(),
        currency: z.string().optional(),
        open_ids: z.array(z.string()).optional(),
      })
      .safeParse(item);
    return result.success ? [result.data] : [];
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Compares only values the system submitted. Formula and defaulted controls are
 * intentionally excluded from `expected` and therefore cannot create false
 * failures; callers inspect formula values separately when needed.
 */
export function diffSubmittedApprovalForm(
  expected: ApprovalFormValue[],
  actual: ApprovalFormValue[],
): string[] {
  const actualById = new Map(actual.map((control) => [control.id, control]));
  return expected.flatMap((control) => {
    const received = actualById.get(control.id);
    if (!received) return [`${control.id}: missing from created approval`];
    if (received.type !== control.type) {
      return [
        `${control.id}: expected ${control.type}, received ${received.type}`,
      ];
    }
    if (stableJson(received.value) !== stableJson(control.value)) {
      return [`${control.id}: submitted value differs from created approval`];
    }
    if ((received.currency ?? "") !== (control.currency ?? "")) {
      return [
        `${control.id}: submitted currency differs from created approval`,
      ];
    }
    if (
      stableJson(received.open_ids ?? []) !== stableJson(control.open_ids ?? [])
    ) {
      return [`${control.id}: submitted contacts differ from created approval`];
    }
    return [];
  });
}
