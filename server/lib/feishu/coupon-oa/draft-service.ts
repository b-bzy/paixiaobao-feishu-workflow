import { createHash } from "node:crypto";
import type { CouponOaDraftValues } from "./approval-schema";
import type { CouponOaAttachment, CouponOaDraft } from "./draft-store";

const allowedChannels = new Set(["京东渠道", "严选APP及小程序"]);

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function number(value: unknown): number | undefined {
  const parsed = Number(text(value).replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function percent(value: unknown): number | undefined {
  const normalized = text(value).replace(/,/g, "").replace(/%$/, "");
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
    ? parsed
    : undefined;
}

export function parseCouponApplicationDraftForm(
  form: Record<string, unknown>,
): CouponOaDraftValues {
  const channels = text(form.channels)
    .split(/[；;]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (
    !channels.length ||
    channels.some((channel) => !allowedChannels.has(channel))
  ) {
    throw new Error("配置渠道只能填写京东渠道或严选APP及小程序，并以；分隔");
  }
  const businessMode = text(form.businessMode);
  if (!["严选", "寄卖", "pop"].includes(businessMode)) {
    throw new Error("业务模式必须是严选、寄卖或 pop");
  }
  const overDeduction = text(form.overDeduction);
  if (!["是", "否"].includes(overDeduction)) {
    throw new Error("是否超扣点必须是是或否");
  }
  if (text(form.activityPointPercent) && !number(form.activityPointPercent)) {
    throw new Error("活动点位必须为大于 0 的数值");
  }
  if (
    text(form.platformBearingPercent) &&
    percent(form.platformBearingPercent) === undefined
  ) {
    throw new Error("平台承担比例必须为 0 到 100 之间的数值");
  }

  return {
    applicationType: "优惠券申请",
    businessMode: businessMode as CouponOaDraftValues["businessMode"],
    activityName: text(form.activityName),
    activityBackground: text(form.activityBackground),
    activityPointPercent: number(form.activityPointPercent),
    platformBearingPercent: percent(form.platformBearingPercent),
    overDeduction: overDeduction as "是" | "否",
    overDeductionReason: text(form.overDeductionReason),
    estimatedGmvYuan: number(form.estimatedGmvYuan),
    estimatedCostYuan: number(form.estimatedCostYuan),
    channels,
    activityStartAt: text(form.activityStartAt),
    activityEndAt: text(form.activityEndAt),
  };
}

export function validateCouponApplicationDraft(
  values: CouponOaDraftValues,
  options: { today?: string } = {},
): void {
  if (!values.activityName?.trim()) {
    throw new Error("活动名称不能为空");
  }
  if (!values.activityBackground?.trim()) {
    throw new Error("活动背景不能为空");
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const isCalendarDate = (value: string | undefined) => {
    if (!value || !datePattern.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  };
  const startAt = values.activityStartAt;
  const endAt = values.activityEndAt;
  if (!startAt || !isCalendarDate(startAt)) {
    throw new Error("活动开始日期必须为有效的 YYYY-MM-DD 日期");
  }
  if (!endAt || !isCalendarDate(endAt)) {
    throw new Error("活动结束日期必须为有效的 YYYY-MM-DD 日期");
  }
  if (endAt < startAt) {
    throw new Error("活动结束日期不能早于开始日期");
  }
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  if (startAt < today) {
    throw new Error(`活动开始日期不能早于今天（${today}）`);
  }

  if (values.businessMode !== "严选") {
    if (!values.estimatedGmvYuan) {
      throw new Error("寄卖和 pop 申请必须填写预估 GMV");
    }
    if (!values.estimatedCostYuan) {
      throw new Error("寄卖和 pop 申请必须填写预估费用");
    }
    if (values.overDeduction === "是" && !values.overDeductionReason?.trim()) {
      throw new Error("超扣点申请必须填写原因");
    }
  }
}

export function missingCouponOaAttachments(draft: CouponOaDraft): string[] {
  if (draft.values.applicationType !== "优惠券申请") return [];
  const values = draft.values;
  const missing: string[] = [];
  if (values.businessMode !== "严选" && !values.calcImageFileCodes?.length) {
    missing.push("具体满减测算图片");
  }
  if (!values.couponTableFileCodes?.length) missing.push("配券信息表（.xlsx）");
  if (!values.productWhitelistFileCodes?.length)
    missing.push("商品明细白名单（.xlsx）");
  return missing;
}

export function classifyCouponOaAttachment(input: {
  messageType: "image" | "file";
  name: string;
  fileCode: string;
  bytes: Uint8Array;
}): CouponOaAttachment {
  const name =
    input.name ||
    (input.messageType === "image" ? "满减测算图片" : "未命名附件");
  const lower = name.toLowerCase();
  let role: CouponOaAttachment["role"];
  if (input.messageType === "image" || /测算/.test(name)) {
    role = "calcImage";
  } else if (/配券/.test(name)) {
    role = "couponTable";
  } else if (/白名单/.test(name)) {
    role = "productWhitelist";
  } else if (/黑名单/.test(name)) {
    role = "productBlacklist";
  } else if (/增加/.test(name)) {
    role = "addItems";
  } else if (/剔除/.test(name)) {
    role = "removeItems";
  } else {
    throw new Error(
      `无法判断附件用途：${name}。文件名需包含测算、配券、白名单、黑名单、增加或剔除。`,
    );
  }
  if (role !== "calcImage" && !lower.endsWith(".xlsx")) {
    throw new Error(`${name} 必须是 .xlsx 文件`);
  }
  return {
    role,
    fileName: name,
    fileCode: input.fileCode,
    bytes: input.bytes.byteLength,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
  };
}

export function attachCouponOaFile(
  draft: CouponOaDraft,
  attachment: CouponOaAttachment,
): Pick<CouponOaDraft, "values" | "attachments"> {
  const attachments = [
    ...draft.attachments.filter((item) => item.role !== attachment.role),
    attachment,
  ];
  if (draft.values.applicationType !== "优惠券申请") {
    return { values: draft.values, attachments };
  }
  const values: CouponOaDraftValues = { ...draft.values };
  const codes = attachments
    .filter((item) => item.role === attachment.role)
    .map((item) => item.fileCode);
  if (attachment.role === "calcImage") values.calcImageFileCodes = codes;
  if (attachment.role === "couponTable") values.couponTableFileCodes = codes;
  if (attachment.role === "productWhitelist")
    values.productWhitelistFileCodes = codes;
  if (attachment.role === "productBlacklist")
    values.productBlacklistFileCodes = codes;
  return { values, attachments };
}
