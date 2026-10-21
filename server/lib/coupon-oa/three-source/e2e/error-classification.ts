import { RegularFullReductionFieldError } from "../recognition";
import type { CouponFieldKey } from "../types";

export interface E2eFailureResult {
  stage: "intake" | "workbook" | "recognition" | "authorization" | "unknown";
  code: string;
  userMessage: string;
  retryable: boolean;
}

/** Structured field failures map by key before any message matching. */
const fieldIssueCodes: Partial<Record<CouponFieldKey, string>> = {
  activityName: "ACTIVITY_NAME_CONFIRMATION_REQUIRED",
  activityBackground: "ACTIVITY_BACKGROUND_CONFIRMATION_REQUIRED",
  activityStartAt: "START_DATE_REQUIRED",
  activityEndAt: "END_DATE_REQUIRED",
};

const classifications: Array<{
  pattern: RegExp;
  result: E2eFailureResult;
}> = [
  {
    pattern: /只接受 \.xlsx/iu,
    result: {
      stage: "intake",
      code: "FILE_FORMAT_UNSUPPORTED",
      userMessage: "请将文件转换为 .xlsx 后重新上传。",
      retryable: false,
    },
  },
  {
    pattern: /没有可读取的 Sheet/iu,
    result: {
      stage: "workbook",
      code: "WORKBOOK_EMPTY",
      userMessage: "工作簿没有可读取的数据，请检查后重新上传。",
      retryable: false,
    },
  },
  {
    pattern: /版本已变化|最新卡片/iu,
    result: {
      stage: "authorization",
      code: "STALE_REVISION",
      userMessage: "材料已更新，请使用最新确认卡片。",
      retryable: false,
    },
  },
  {
    pattern: /只有当前三源提报创建人/iu,
    result: {
      stage: "authorization",
      code: "OWNER_FORBIDDEN",
      userMessage: "只有当前提报创建人可以继续操作。",
      retryable: false,
    },
  },
  {
    pattern:
      /数值格式.*前导零|超过 Excel 15 位|安全整数|不是可无损转换的非负整数/iu,
    result: {
      stage: "workbook",
      code: "SKU_PRECISION_LOST",
      userMessage: "SKU 数字精度无法确认，请改为文本格式后重新上传。",
      retryable: false,
    },
  },
  {
    pattern: /activityName Too small|配券表缺少字段：activityName/iu,
    result: {
      stage: "recognition",
      code: "ACTIVITY_NAME_CONFIRMATION_REQUIRED",
      userMessage: "请确认或补充活动名称。",
      retryable: false,
    },
  },
  {
    pattern:
      /activityBackground Too small|配券表缺少字段：activityBackground/iu,
    result: {
      stage: "recognition",
      code: "ACTIVITY_BACKGROUND_CONFIRMATION_REQUIRED",
      userMessage: "请确认或补充活动背景。",
      retryable: false,
    },
  },
  {
    pattern: /activityStartAt Invalid string/iu,
    result: {
      stage: "recognition",
      code: "START_DATE_REQUIRED",
      userMessage: "请按 YYYY-MM-DD 补充活动开始日期。",
      retryable: false,
    },
  },
  {
    pattern: /activityEndAt Invalid string/iu,
    result: {
      stage: "recognition",
      code: "END_DATE_REQUIRED",
      userMessage: "请按 YYYY-MM-DD 补充活动结束日期。",
      retryable: false,
    },
  },
  {
    pattern: /字段 .* 存在多个候选/iu,
    result: {
      stage: "recognition",
      code: "FIELD_CONFLICT_CONFIRMATION_REQUIRED",
      userMessage: "检测到冲突字段，请确认正确内容。",
      retryable: false,
    },
  },
  {
    pattern: /白黑名单存在重叠 SKU/iu,
    result: {
      stage: "recognition",
      code: "OVERLAP_DECISION_REQUIRED",
      userMessage: "白名单和黑名单存在重叠 SKU，请选择处理方式。",
      retryable: false,
    },
  },
  {
    pattern: /确认版本已过期|版本已变化|最新卡片/iu,
    result: {
      stage: "authorization",
      code: "STALE_REVISION",
      userMessage: "材料已更新，请使用最新确认卡片。",
      retryable: false,
    },
  },
  {
    pattern:
      /优惠面额必须小于满减门槛|单次到账张数不能大于总申请数量|超扣点时必须填写原因/iu,
    result: {
      stage: "workbook",
      code: "COUPON_RULE_INVALID",
      userMessage: "优惠券业务规则不合法，请修正后重试。",
      retryable: false,
    },
  },
  {
    pattern:
      /totalQuantity .*?(?:Too small|expected number|finite|safe integer)/iu,
    result: {
      stage: "workbook",
      code: "NUMBER_OUT_OF_RANGE",
      userMessage: "必填数量超出允许范围，请修正后重试。",
      retryable: false,
    },
  },
  {
    pattern: /活动结束日期不能早于开始日期|activityStartAt Invalid string/iu,
    result: {
      stage: "workbook",
      code: "DATE_RANGE_INVALID",
      userMessage: "活动日期非法或结束日期早于开始日期。",
      retryable: false,
    },
  },
  {
    pattern: /材料角色不匹配|无法根据工作簿内容识别材料角色/iu,
    result: {
      stage: "recognition",
      code: "SOURCE_ROLE_CONFIRMATION_REQUIRED",
      userMessage: "请确认上传文件对应的材料角色。",
      retryable: false,
    },
  },
  {
    pattern: /包含多个 SKU|多个 SKU 或分隔符|包含多个名单 ID 或分隔符/iu,
    result: {
      stage: "workbook",
      code: "SKU_CELL_MULTIPLE_VALUES",
      userMessage: "一个单元格只能填写一个 SKU，请拆分后重新上传。",
      retryable: false,
    },
  },
  {
    pattern:
      /不能使用公式作为 SKU|不能使用公式作为名单 ID|不能以公式前缀开头/iu,
    result: {
      stage: "workbook",
      code: "SKU_FORMULA_UNSAFE",
      userMessage: "SKU 必须是纯文本，不能使用公式或公式前缀。",
      retryable: false,
    },
  },
];

export function classifyE2eFailure(error: unknown): E2eFailureResult {
  if (error instanceof RegularFullReductionFieldError) {
    for (const issue of error.fieldIssues) {
      const code = fieldIssueCodes[issue.key];
      if (code) {
        return {
          stage: "recognition",
          code,
          userMessage: issue.message,
          retryable: false,
        };
      }
    }
  }
  const message = error instanceof Error ? error.message : "";
  return (
    classifications.find((item) => item.pattern.test(message))?.result ?? {
      stage: "unknown",
      code: "UNCLASSIFIED_FAILURE",
      userMessage: "本地测试遇到未分类错误，请根据运行标识查看脱敏日志。",
      retryable: false,
    }
  );
}
