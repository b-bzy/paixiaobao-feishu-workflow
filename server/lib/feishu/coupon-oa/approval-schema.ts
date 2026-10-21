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
  /** Feishu display metadata; attachment widgets carry file names here. */
  ext?: unknown;
}

export const couponApplicationValuesSchema = z
  .object({
    applicationType: z.literal("优惠券申请"),
    businessMode: z.enum(["严选", "寄卖", "pop"]),
    activityName: z.string().trim().min(1).max(200),
    activityBackground: z.string().trim().min(1).max(4000),
    activityPointPercent: z.number().positive().finite().optional(),
    platformBearingPercent: z.number().min(0).max(100).finite().optional(),
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

export interface CouponOaIdentitySnapshot {
  /** The owner that completed the final confirmation. */
  openId: string;
  /** Feishu's immutable user ID; absent without contact read scopes. */
  userId?: string;
  /** Absent without contact read scopes; the preview card falls back. */
  displayName?: string;
  /** Absent when the confirmer's department could not be resolved. */
  departmentOpenId?: string;
  departmentName?: string;
  resolvedAt: string;
}

/** A mutable system-side draft may be incomplete until its owner confirms it. */
export interface CouponOaDraftValues {
  applicationType: "优惠券申请" | "优惠券修改";
  businessMode?: "严选" | "寄卖" | "pop";
  activityName?: string;
  activityBackground?: string;
  activityPointPercent?: number;
  platformBearingPercent?: number;
  overDeduction?: "是" | "否";
  overDeductionReason?: string;
  estimatedGmvYuan?: number;
  estimatedCostYuan?: number;
  channels?: string[];
  activityStartAt?: string;
  activityEndAt?: string;
  /** Resolved by the server at final confirmation; never accepted from a card. */
  identitySnapshot?: CouponOaIdentitySnapshot;
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
      if (values.activityPointPercent !== undefined) {
        add("活动点位(%)", values.activityPointPercent);
      }
      if (values.platformBearingPercent !== undefined) {
        add("平台承担比例(%)", values.platformBearingPercent);
      }
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
        ext: z.unknown().optional(),
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

export interface ApprovalFormVerification {
  /** Definite semantic mismatches. */
  issues: string[];
  /** Values Feishu transformed without a stable identity we can verify. */
  needsReview: string[];
}

function optionsFor(control: ApprovalFormControl): Array<{
  value: string;
  text: string;
}> {
  const options = z
    .array(z.object({ text: z.string(), value: z.string() }))
    .safeParse(control.option);
  return options.success ? options.data : [];
}

function optionIdentity(
  control: ApprovalFormControl,
  value: unknown,
): string | undefined {
  const candidate =
    typeof value === "string"
      ? value
      : value && typeof value === "object"
        ? typeof (value as Record<string, unknown>).value === "string"
          ? String((value as Record<string, unknown>).value)
          : typeof (value as Record<string, unknown>).text === "string"
            ? String((value as Record<string, unknown>).text)
            : undefined
        : undefined;
  if (!candidate) return undefined;
  const option = optionsFor(control).find(
    (item) => item.value === candidate || item.text === candidate,
  );
  return option?.value;
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  const text = (value as Record<string, unknown>).text;
  return typeof text === "string" ? text : undefined;
}

function decimal(value: unknown): string | undefined {
  const text =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value
        : undefined;
  if (!text || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return undefined;
  const negative = text.startsWith("-");
  const [integer, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const normalizedInteger = integer.replace(/^0+(?=\d)/, "") || "0";
  const normalizedFraction = fraction.replace(/0+$/, "");
  const normalized = normalizedFraction
    ? `${normalizedInteger}.${normalizedFraction}`
    : normalizedInteger;
  return negative && normalized !== "0" ? `-${normalized}` : normalized;
}

/**
 * Feishu amount controls store cent precision, so the readback comparison
 * normalizes both sides to cents: float-multiplication tails such as
 * 22500.0000000000004 must not be reported as a field difference.
 */
function centsOf(normalized: string | undefined): number | undefined {
  if (!normalized) return undefined;
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : undefined;
}

function controlLabel(
  definitionControl: ApprovalFormControl | undefined,
  submitted: ApprovalFormValue,
): string {
  return definitionControl?.name?.trim() || submitted.id;
}

function formatYuanText(normalized: string | undefined): string {
  if (!normalized) return "无法解析";
  const negative = normalized.startsWith("-");
  const [integer, fraction = ""] = (
    negative ? normalized.slice(1) : normalized
  ).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/u, ",");
  const text = fraction ? `${grouped}.${fraction}` : grouped;
  return negative ? `-${text}` : text;
}

function amountValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const object = value as Record<string, unknown>;
  return object.amount ?? object.value ?? value;
}

function currencyValue(control: ApprovalFormValue): string | undefined {
  if (control.currency) return control.currency;
  if (!control.value || typeof control.value !== "object") return undefined;
  const object = control.value as Record<string, unknown>;
  if (typeof object.currency === "string") return object.currency;
  const ext = object.ext;
  if (!ext || typeof ext !== "object") return undefined;
  const currency = (ext as Record<string, unknown>).currency;
  return typeof currency === "string" ? currency : undefined;
}

function shanghaiDate(value: unknown): string | undefined {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date =
    typeof value === "number"
      ? new Date(value)
      : typeof value === "string"
        ? new Date(value)
        : undefined;
  if (!date || Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return year && month && day ? `${year}-${month}-${day}` : undefined;
}

function dateInterval(
  value: unknown,
): { start: string; end: string; interval: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const object = value as Record<string, unknown>;
  const start = shanghaiDate(object.start);
  const end = shanghaiDate(object.end);
  const interval = decimal(object.interval);
  return start && end && interval ? { start, end, interval } : undefined;
}

function attachmentIdentity(
  value: unknown,
):
  | { kind: "codes"; values: string[] }
  | { kind: "urls"; values: string[] }
  | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const codes: string[] = [];
  const urls: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      if (item.startsWith("https://")) urls.push(item);
      else codes.push(item);
      continue;
    }
    if (!item || typeof item !== "object") return undefined;
    const object = item as Record<string, unknown>;
    const code = object.file_code ?? object.fileCode ?? object.code;
    if (typeof code === "string" && code) {
      codes.push(code);
      continue;
    }
    const url = object.url ?? object.file_url;
    if (typeof url === "string" && url.startsWith("https://")) {
      urls.push(url);
      continue;
    }
    return undefined;
  }
  if (codes.length && urls.length) return undefined;
  return codes.length
    ? { kind: "codes", values: codes }
    : { kind: "urls", values: urls };
}

function sameSet(expected: string[], actual: string[]): boolean {
  return (
    expected.length === actual.length &&
    new Set(expected).size === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((value) => actual.includes(value))
  );
}

/**
 * Feishu readback for attachment widgets returns signed, expiring CDN URLs
 * instead of the submitted file codes (verified on the 2026-10-14 canary:
 * the URLs embed no stable identity, but `ext` carries the original file
 * names). Multi-file widgets have not been observed yet; a comma-joined
 * `ext` is assumed and anything unparseable still fails into needsReview.
 */
function attachmentDisplayNames(
  control: ApprovalFormValue,
  count: number,
): string[] | undefined {
  if (typeof control.ext !== "string" || !control.ext.trim()) return undefined;
  const names = control.ext
    .split(/[,，]/)
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length === count ? names : undefined;
}

function verifiedByAttachmentNames(
  submittedIdentity: { values: string[] },
  received: ApprovalFormValue,
  receivedIdentity: { values: string[] },
  fileNames: ReadonlyMap<string, string> | undefined,
): boolean {
  if (!fileNames) return false;
  const receivedNames = attachmentDisplayNames(
    received,
    receivedIdentity.values.length,
  );
  if (!receivedNames) return false;
  const submittedNames = submittedIdentity.values.map((code) =>
    fileNames.get(code),
  );
  if (submittedNames.some((name) => !name)) return false;
  return sameSet(submittedNames as string[], receivedNames);
}

/**
 * Compares only controls we submitted. Formula/default controls are excluded,
 * while Feishu's documented display-level normalization is handled per type.
 * `attachmentFileNames` maps submitted file codes to their frozen artifact
 * file names, which is the only stable identity attachment readback allows.
 */
export function diffSubmittedApprovalForm(
  schema: BoundCouponApprovalSchema,
  expected: ApprovalFormValue[],
  actual: ApprovalFormValue[],
  options?: {
    attachmentFileNames?: ReadonlyMap<string, string>;
  },
): ApprovalFormVerification {
  const actualById = new Map<string, ApprovalFormValue[]>();
  for (const control of actual) {
    actualById.set(control.id, [
      ...(actualById.get(control.id) ?? []),
      control,
    ]);
  }
  const issues: string[] = [];
  const needsReview: string[] = [];
  const controlById = new Map(
    Object.values(schema.controls).map((control) => [control.id, control]),
  );

  for (const submitted of expected) {
    const receivedControls = actualById.get(submitted.id) ?? [];
    const label = controlLabel(controlById.get(submitted.id), submitted);
    if (receivedControls.length !== 1) {
      issues.push(
        `${label}：OA 表单中该控件${receivedControls.length ? "重复出现" : "缺失"}`,
      );
      continue;
    }
    const received = receivedControls[0];
    if (received.type !== submitted.type) {
      issues.push(
        `${label}：提交控件类型 ${submitted.type}，OA 实际 ${received.type}`,
      );
      continue;
    }
    const definitionControl = controlById.get(submitted.id);
    if (!definitionControl) {
      issues.push(`${label}：不在当前审批定义中`);
      continue;
    }

    if (submitted.type === "radioV2") {
      const submittedOption = optionIdentity(
        definitionControl,
        submitted.value,
      );
      const receivedOption = optionIdentity(definitionControl, received.value);
      if (
        !submittedOption ||
        !receivedOption ||
        submittedOption !== receivedOption
      ) {
        issues.push(`${label}：提交选项与 OA 实际选项不一致`);
      }
      continue;
    }
    if (submitted.type === "checkboxV2") {
      const submittedOptions = Array.isArray(submitted.value)
        ? submitted.value.map((value) =>
            optionIdentity(definitionControl, value),
          )
        : [];
      const receivedOptions = Array.isArray(received.value)
        ? received.value.map((value) =>
            optionIdentity(definitionControl, value),
          )
        : [];
      if (
        submittedOptions.some((value) => !value) ||
        receivedOptions.some((value) => !value) ||
        !sameSet(submittedOptions as string[], receivedOptions as string[])
      ) {
        issues.push(`${label}：提交选项与 OA 实际选项不一致`);
      }
      continue;
    }
    if (submitted.type === "amount") {
      const submittedAmount = decimal(amountValue(submitted.value));
      const receivedAmount = decimal(amountValue(received.value));
      const submittedCents = centsOf(submittedAmount);
      const receivedCents = centsOf(receivedAmount);
      const currencyMismatch =
        currencyValue(submitted) !== currencyValue(received);
      if (
        submittedCents === undefined ||
        receivedCents === undefined ||
        submittedCents !== receivedCents ||
        currencyMismatch
      ) {
        issues.push(
          `${label}：提交 ${formatYuanText(submittedAmount)} / OA 实际 ${formatYuanText(receivedAmount)}${currencyMismatch ? "（币种不一致）" : ""}，请核对`,
        );
      }
      continue;
    }
    if (submitted.type === "dateInterval") {
      const submittedInterval = dateInterval(submitted.value);
      const receivedInterval = dateInterval(received.value);
      if (
        !submittedInterval ||
        !receivedInterval ||
        stableJson(submittedInterval) !== stableJson(receivedInterval)
      ) {
        issues.push(`${label}：提交日期区间与 OA 实际不一致`);
      }
      continue;
    }
    if (["attachmentV2", "image", "connect"].includes(submitted.type)) {
      const submittedIdentity = attachmentIdentity(submitted.value);
      const receivedIdentity = attachmentIdentity(received.value);
      if (!submittedIdentity || !receivedIdentity) {
        issues.push(`${label}：OA 实际附件值无法解析`);
      } else if (
        submittedIdentity.kind === "codes" &&
        receivedIdentity.kind === "codes"
      ) {
        if (!sameSet(submittedIdentity.values, receivedIdentity.values)) {
          issues.push(`${label}：提交附件与 OA 实际附件不一致`);
        }
      } else if (
        submittedIdentity.values.length !== receivedIdentity.values.length
      ) {
        issues.push(`${label}：提交附件数量与 OA 实际不一致`);
      } else if (
        !verifiedByAttachmentNames(
          submittedIdentity,
          received,
          receivedIdentity,
          options?.attachmentFileNames,
        )
      ) {
        needsReview.push(
          `${label}：飞书返回了展示链接而非稳定文件标识，需人工核对`,
        );
      }
      continue;
    }
    if (["input", "textarea"].includes(submitted.type)) {
      if (normalizeText(submitted.value) !== normalizeText(received.value)) {
        issues.push(`${label}：提交文本与 OA 实际文本不一致`);
      }
      continue;
    }
    if (stableJson(received.value) !== stableJson(submitted.value)) {
      issues.push(`${label}：提交值与 OA 实际值不一致`);
    }
    if (
      stableJson(received.open_ids ?? []) !==
      stableJson(submitted.open_ids ?? [])
    ) {
      issues.push(`${label}：提交联系人与 OA 实际不一致`);
    }
  }
  return { issues, needsReview };
}
