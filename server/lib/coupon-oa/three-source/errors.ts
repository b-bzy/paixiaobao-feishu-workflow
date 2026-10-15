export type CouponThreeSourceErrorCode =
  | "FILE_TYPE_UNSUPPORTED"
  | "FILE_TOO_LARGE"
  | "WORKBOOK_UNREADABLE"
  | "WORKBOOK_ENCRYPTED_OR_UNSUPPORTED"
  | "WORKBOOK_EMPTY"
  | "STALE_REVISION"
  | "OWNER_FORBIDDEN"
  | "SOURCE_ROLE_CONFIRMATION_REQUIRED"
  | "VALIDATION_REQUIRED"
  | "LEGACY_DRAFT_UNSUPPORTED"
  | "UNEXPECTED_FAILURE";

export class CouponThreeSourceError extends Error {
  readonly code: CouponThreeSourceErrorCode;
  readonly userMessage: string;

  constructor(input: {
    code: CouponThreeSourceErrorCode;
    message: string;
    userMessage: string;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "CouponThreeSourceError";
    this.code = input.code;
    this.userMessage = input.userMessage;
  }
}

const knownErrors: Array<{
  pattern: RegExp;
  code: CouponThreeSourceErrorCode;
  userMessage?: string;
}> = [
  {
    pattern: /不超过 10 MB|超过.*10 MB/iu,
    code: "FILE_TOO_LARGE",
    userMessage: "文件超过 10 MB，当前自动流程无法处理，请转人工提报。",
  },
  {
    pattern: /只接受 \.xlsx|\.xls|\.csv|不支持.*文件格式/iu,
    code: "FILE_TYPE_UNSUPPORTED",
    userMessage: "当前只支持 .xlsx 文件，请转换格式后重新上传。",
  },
  {
    pattern: /没有可读取的 Sheet/iu,
    code: "WORKBOOK_EMPTY",
    userMessage: "工作簿没有可读取的数据，请检查后重新上传。",
  },
  {
    pattern: /版本已变化|确认版本已过期|使用最新卡片/iu,
    code: "STALE_REVISION",
  },
  {
    pattern: /只有当前三源提报创建人|不能确认其他业务员/iu,
    code: "OWNER_FORBIDDEN",
    userMessage: "只有当前提报创建人可以继续操作。",
  },
  {
    pattern: /无法根据工作簿内容识别材料角色|材料角色存在多个|材料角色不匹配/iu,
    code: "SOURCE_ROLE_CONFIRMATION_REQUIRED",
    userMessage: "暂时无法唯一判断材料用途，请在最新卡片中确认。",
  },
  {
    pattern:
      /请先完整填写|请选择有效|请明确确认|必须明确确认|白黑名单存在重叠|优惠面额必须|活动结束日期不能|一个单元格只能|SKU 必须|超扣原因为必填|三源标准产物正在生成|配券表字段不符合常规满减券规则|未识别到「.*」的取值/iu,
    code: "VALIDATION_REQUIRED",
  },
];

export function toCouponThreeSourceError(
  error: unknown,
): CouponThreeSourceError {
  if (error instanceof CouponThreeSourceError) return error;
  const message = error instanceof Error ? error.message : "Unknown failure";
  const known = knownErrors.find((item) => item.pattern.test(message));
  if (known) {
    return new CouponThreeSourceError({
      code: known.code,
      message,
      userMessage: known.userMessage ?? message,
      cause: error,
    });
  }
  return new CouponThreeSourceError({
    code: "UNEXPECTED_FAILURE",
    message: "Coupon three-source operation failed",
    userMessage: "系统未完成本次处理，已保留当前材料，请稍后重试或联系处理。",
    cause: error,
  });
}

export function toCouponThreeSourceUserFailure(error: unknown): {
  code: CouponThreeSourceErrorCode;
  message: string;
} {
  const normalized = toCouponThreeSourceError(error);
  return { code: normalized.code, message: normalized.userMessage };
}
