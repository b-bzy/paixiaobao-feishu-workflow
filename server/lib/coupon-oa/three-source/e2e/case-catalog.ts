import {
  type CouponThreeSourceE2eCase,
  validateCouponThreeSourceE2eCatalog,
} from "./case-contract";

type Classification = CouponThreeSourceE2eCase["expected"]["classification"];

interface CatalogSeed {
  id: string;
  title: string;
  recipe: string;
  classification?: Classification;
  code?: string;
  variants?: number;
  blacklist?: boolean;
  aiReplay?: string;
}

const fileCases: CatalogSeed[] = [
  { id: "F01", title: "标准 XLSX 基准包", recipe: "standard" },
  {
    id: "F02",
    title: "零字节文件",
    recipe: "zero-byte",
    classification: "expected_block",
    code: "FILE_EMPTY",
  },
  {
    id: "F03",
    title: "缺少 workbook part 的 OOXML",
    recipe: "missing-workbook-part",
    classification: "expected_block",
    code: "WORKBOOK_CORRUPT",
  },
  {
    id: "F04",
    title: "密码保护工作簿",
    recipe: "encrypted",
    classification: "expected_block",
    code: "WORKBOOK_ENCRYPTED",
  },
  {
    id: "F05",
    title: "旧 XLS 格式",
    recipe: "legacy-xls",
    classification: "expected_block",
    code: "FILE_FORMAT_UNSUPPORTED",
  },
  {
    id: "F06",
    title: "CSV 或 HTML 伪装 XLSX",
    recipe: "fake-xlsx-signature",
    classification: "expected_block",
    code: "FILE_SIGNATURE_INVALID",
    variants: 2,
  },
  {
    id: "F07",
    title: "超出文件或行数上限",
    recipe: "oversized",
    classification: "expected_block",
    code: "FILE_LIMIT_EXCEEDED",
    variants: 2,
  },
  {
    id: "F08",
    title: "同名文件重复上传",
    recipe: "duplicate-upload",
    variants: 2,
  },
];

const layoutCases: CatalogSeed[] = [
  { id: "L01", title: "第一行表头", recipe: "header-row-1" },
  { id: "L02", title: "第二行表头", recipe: "header-row-2" },
  { id: "L03", title: "第十行表头", recipe: "header-row-10" },
  {
    id: "L04",
    title: "两层合并表头",
    recipe: "merged-two-level-header",
    classification: "needs_clarification",
    code: "FIELD_MAPPING_CONFIRMATION_REQUIRED",
    aiReplay: "low-confidence-layout",
  },
  {
    id: "L05",
    title: "数据区域纵向合并单元格",
    recipe: "vertical-merge",
    classification: "needs_clarification",
    code: "MERGED_DATA_CONFIRMATION_REQUIRED",
  },
  {
    id: "L06",
    title: "纵向键值对布局",
    recipe: "vertical-key-value",
    aiReplay: "complete",
  },
  {
    id: "L07",
    title: "券档按列展开",
    recipe: "coupon-matrix",
    aiReplay: "complete",
  },
  {
    id: "L08",
    title: "同 Sheet 两个独立数据表",
    recipe: "two-tables",
    classification: "needs_clarification",
    code: "PRIMARY_TABLE_CONFIRMATION_REQUIRED",
  },
  { id: "L09", title: "数据区重复表头", recipe: "repeated-header" },
  { id: "L10", title: "大量空白及格式尾部", recipe: "formatted-tail" },
  {
    id: "L11",
    title: "隐藏行列包含业务数据",
    recipe: "hidden-business-data",
    classification: "needs_clarification",
    code: "HIDDEN_DATA_CONFIRMATION_REQUIRED",
  },
  { id: "L12", title: "隐藏说明与封面 Sheet", recipe: "hidden-cover-sheets" },
  {
    id: "L13",
    title: "SKU 位于 A C Z 列",
    recipe: "sku-column-position",
    variants: 3,
  },
  { id: "L14", title: "随机业务 Sheet 名", recipe: "arbitrary-sheet-names" },
];

const fieldCases: CatalogSeed[] = [
  { id: "C01", title: "标准中文字段", recipe: "standard-fields" },
  {
    id: "C02",
    title: "别名与中英混合字段",
    recipe: "mixed-alias-fields",
    aiReplay: "complete",
  },
  {
    id: "C03",
    title: "活动名称缺失",
    recipe: "missing-activity-name",
    classification: "needs_clarification",
    code: "ACTIVITY_NAME_CONFIRMATION_REQUIRED",
    aiReplay: "activity-copy",
  },
  {
    id: "C04",
    title: "活动背景缺失",
    recipe: "missing-activity-background",
    classification: "needs_clarification",
    code: "ACTIVITY_BACKGROUND_CONFIRMATION_REQUIRED",
    aiReplay: "activity-copy",
  },
  {
    id: "C05",
    title: "开始日期缺失",
    recipe: "missing-start-date",
    classification: "needs_clarification",
    code: "START_DATE_REQUIRED",
  },
  {
    id: "C06",
    title: "结束日期缺失",
    recipe: "missing-end-date",
    classification: "needs_clarification",
    code: "END_DATE_REQUIRED",
  },
  {
    id: "C07",
    title: "日期缺少年份",
    recipe: "date-without-year",
    classification: "needs_clarification",
    code: "DATE_YEAR_CONFIRMATION_REQUIRED",
  },
  {
    id: "C08",
    title: "跨年日期",
    recipe: "cross-year-date",
    classification: "needs_clarification",
    code: "DATE_YEAR_CONFIRMATION_REQUIRED",
  },
  {
    id: "C09",
    title: "多种日期值格式",
    recipe: "mixed-date-formats",
    variants: 3,
  },
  {
    id: "C10",
    title: "非法或倒序日期",
    recipe: "invalid-date-order",
    classification: "expected_block",
    code: "DATE_RANGE_INVALID",
    variants: 2,
  },
  {
    id: "C11",
    title: "多种百分比格式",
    recipe: "percentage-formats",
    variants: 3,
  },
  {
    id: "C12",
    title: "金额符号与中文单位",
    recipe: "amount-formats",
    variants: 3,
  },
  {
    id: "C13",
    title: "中文数字与全角字符",
    recipe: "localized-numbers",
    classification: "needs_clarification",
    code: "NUMBER_CONFIRMATION_REQUIRED",
    variants: 3,
  },
  {
    id: "C14",
    title: "必填数值边界",
    recipe: "numeric-boundaries",
    classification: "expected_block",
    code: "NUMBER_OUT_OF_RANGE",
    variants: 4,
  },
  {
    id: "C15",
    title: "公式缓存值状态",
    recipe: "formula-cache",
    classification: "expected_block",
    code: "FORMULA_VALUE_UNVERIFIED",
    variants: 3,
  },
  {
    id: "C16",
    title: "重复字段值冲突",
    recipe: "conflicting-columns",
    classification: "needs_clarification",
    code: "FIELD_CONFLICT_CONFIRMATION_REQUIRED",
  },
];

const skuCases: CatalogSeed[] = [
  { id: "S01", title: "文本 SKU", recipe: "text-sku" },
  { id: "S02", title: "安全数字 SKU", recipe: "safe-numeric-sku" },
  { id: "S03", title: "前导零文本 SKU", recipe: "leading-zero-sku" },
  {
    id: "S04",
    title: "科学计数法 SKU",
    recipe: "scientific-sku",
    classification: "needs_clarification",
    code: "SKU_PRECISION_CONFIRMATION_REQUIRED",
    variants: 2,
  },
  {
    id: "S05",
    title: "超过可靠精度数字 SKU",
    recipe: "unsafe-numeric-sku",
    classification: "expected_block",
    code: "SKU_PRECISION_LOST",
  },
  { id: "S06", title: "同 Sheet 重复 SKU", recipe: "same-sheet-duplicates" },
  { id: "S07", title: "跨 Sheet 相同 SKU", recipe: "cross-sheet-duplicates" },
  {
    id: "S08",
    title: "单元格包含多个 SKU",
    recipe: "multi-value-cell",
    classification: "expected_block",
    code: "SKU_CELL_MULTIPLE_VALUES",
    variants: 3,
  },
  { id: "S09", title: "SKU 空值及 N/A", recipe: "blank-sku-values" },
  {
    id: "S10",
    title: "SKU 公式与链接",
    recipe: "formula-and-link-sku",
    classification: "expected_block",
    code: "SKU_FORMULA_UNSAFE",
    variants: 3,
  },
  { id: "S11", title: "纵向合并 SKU", recipe: "merged-sku-cells" },
  {
    id: "S12",
    title: "SKU SPU 商品编码候选冲突",
    recipe: "identifier-column-conflict",
    classification: "needs_clarification",
    code: "IDENTIFIER_COLUMN_CONFIRMATION_REQUIRED",
    aiReplay: "low-confidence-identifier",
  },
  { id: "S13", title: "名单含大量额外列", recipe: "wide-list" },
  {
    id: "S14",
    title: "白黑名单重叠决策",
    recipe: "list-overlap",
    classification: "needs_clarification",
    code: "OVERLAP_DECISION_REQUIRED",
    variants: 3,
    blacklist: true,
  },
  {
    id: "S15",
    title: "三种黑名单状态",
    recipe: "blacklist-states",
    classification: "needs_clarification",
    code: "BLACKLIST_CONFIRMATION_REQUIRED",
    variants: 3,
    blacklist: true,
  },
  {
    id: "S16",
    title: "自由命名多 Sheet 名单",
    recipe: "dynamic-list-sheets",
    variants: 4,
  },
];

const businessCases: CatalogSeed[] = [
  { id: "B01", title: "单券档", recipe: "one-tier" },
  { id: "B02", title: "十券档乱序", recipe: "ten-tiers-shuffled" },
  {
    id: "B03",
    title: "名单缺少券档 Sheet",
    recipe: "missing-list-tier",
    classification: "needs_clarification",
    code: "LIST_TIER_MISSING",
  },
  {
    id: "B04",
    title: "名单存在额外券档",
    recipe: "extra-list-tier",
    classification: "needs_clarification",
    code: "LIST_TIER_EXTRA",
  },
  { id: "B05", title: "相似券档名称", recipe: "similar-tier-names" },
  {
    id: "B06",
    title: "券档业务规则非法",
    recipe: "invalid-coupon-rules",
    classification: "expected_block",
    code: "COUPON_RULE_INVALID",
    variants: 3,
  },
  {
    id: "B07",
    title: "来源角色上传颠倒",
    recipe: "swapped-source-roles",
    classification: "needs_clarification",
    code: "SOURCE_ROLE_CONFIRMATION_REQUIRED",
  },
  {
    id: "B08",
    title: "多次替换后点击旧卡片",
    recipe: "stale-card-after-replacement",
    classification: "expected_block",
    code: "STALE_REVISION",
    variants: 2,
  },
  {
    id: "B09",
    title: "清除后重新上传",
    recipe: "clear-and-restart",
    variants: 2,
  },
  {
    id: "B10",
    title: "重复识别确认生成",
    recipe: "duplicate-actions",
    variants: 2,
  },
];

function toCase(seed: CatalogSeed): unknown {
  const classification = seed.classification ?? "passed";
  const workbooks = [
    {
      role: "couponTable",
      recipe: `${seed.recipe}:coupon`,
      variants: seed.variants ?? 1,
    },
    {
      role: "whitelist",
      recipe: `${seed.recipe}:whitelist`,
      variants: seed.variants ?? 1,
    },
  ];
  if (seed.blacklist) {
    workbooks.push({
      role: "blacklist",
      recipe: `${seed.recipe}:blacklist`,
      variants: seed.variants ?? 1,
    });
  }
  return {
    id: seed.id,
    title: seed.title,
    tags: [seed.id.slice(0, 1), classification],
    inputs: {
      workbooks,
      aiReplay: seed.aiReplay ?? "complete",
      ownerReplies: [],
    },
    expected: {
      classification,
      terminalState:
        classification === "passed"
          ? "AwaitingFinalConfirmation"
          : classification === "needs_clarification"
            ? "NeedsClarification"
            : "Blocked",
      revision: classification === "passed" ? 3 : 2,
      secondRoundCardCount: classification === "expected_block" ? 0 : 1,
      ...(seed.code ? { userFacingCode: seed.code } : {}),
      artifactRoles:
        classification === "passed" ? ["couponTable", "whitelist"] : [],
      nativeOaCreated: false,
    },
  };
}

export const couponThreeSourceE2eCases = validateCouponThreeSourceE2eCatalog(
  [fileCases, layoutCases, fieldCases, skuCases, businessCases]
    .flat()
    .map(toCase),
);
