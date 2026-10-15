#!/usr/bin/env node

/**
 * 真实配券表识别审计:把业务员实际使用的 .xlsx 直接灌入识别管线,
 * 在交给用户测试之前把"格式类"问题一次性扫出来。
 *
 * 背景(2026-10-15 两次线上事故):公式且无缓存结果的单元格曾被读成
 * "[object Object]",表头别名/数字格式不匹配曾被透传成英文 zod 报错。
 * 本脚本按同一管线(inspect → discover → confirm)逐层报告:
 *   1. 材料角色能否唯一判定
 *   2. 常规满减券档是否被发现(sheet/行/档位名)
 *   3. 每个字段的表头别名命中情况 + 样例值 + 格式转换探针
 *   4. 公式单元格清单(无缓存结果 = 线上必然读空,需靠 AI 推导回退)
 *   5. 最终 confirm 演练:逐一给出用户将看到的中文校验问题
 *
 * 用法:
 *   pnpm audit:workbook -- path/to/配券表.xlsx [--json 输出.json]
 * 环境变量:无(纯本地管线,不访问飞书/AI)。
 * 注意:输出包含表格内容,仅限本地诊断,不要把真实表格或完整输出提交进仓库。
 */

import { readFileSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { canonicalCouponBusinessDate } from "../server/lib/coupon-oa/three-source/business-date.ts";
import { parseFlexibleNumber } from "../server/lib/coupon-oa/number-text.ts";
import { normalizeRegularRatio } from "../server/lib/coupon-oa/calculation.ts";
import {
  RegularFullReductionFieldError,
  confirmRegularFullReductionCoupon,
  discoverRegularFullReductionCoupons,
  inspectThreeSourceWorkbook,
} from "../server/lib/coupon-oa/three-source/recognition.ts";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

// pnpm audit:workbook -- file.xlsx 会把 "--" 也传进 argv:
// 取第一个既不是开关、也不是 --json 取值、也不是 "--" 的参数作为文件名。
const jsonOut = argument("--json");
const fileArg = process.argv.slice(2).find((arg, index, args) => {
  if (arg === "--" || arg.startsWith("--")) return false;
  if (jsonOut !== undefined && args[index - 1] === "--json") return false;
  return true;
});
if (!fileArg) {
  console.error("用法: pnpm audit:workbook -- <配券表.xlsx> [--json out.json]");
  process.exit(2);
}
const bytes = new Uint8Array(readFileSync(fileArg));

const FIELD_LABELS = {
  activityName: "活动名称",
  activityBackground: "活动背景",
  businessMode: "业务模式",
  applicantName: "申请人",
  activityStartAt: "活动开始日期",
  activityEndAt: "活动结束日期",
  channels: "用券渠道",
  thresholdYuan: "满减门槛",
  discountAmountYuan: "优惠面额",
  activityPointPercent: "活动点位",
  totalQuantity: "总申请数量",
  grantQuantityPerClaim: "单次发放数量",
  dailyClaimLimit: "每日领取上限",
  claimWindow: "领取时间",
  useWindow: "使用时间",
  expectedClaimRate: "预计领取率",
  expectedUseRate: "预计使用率",
  platformBearingRatio: "平台承担比例",
  estimatedGmvYuan: "预计成交额",
  claimRule: "领取规则",
  allowGift: "是否允许转赠",
  promotionMode: "推广方式",
  publicPromotionChannels: "公开推广渠道",
  overDeduction: "是否超扣",
  overDeductionReason: "超扣原因",
};

const NUMBER_KEYS = new Set([
  "thresholdYuan",
  "discountAmountYuan",
  "totalQuantity",
  "grantQuantityPerClaim",
  "dailyClaimLimit",
  "estimatedGmvYuan",
  "activityPointPercent",
]);
const RATIO_KEYS = new Set([
  "expectedClaimRate",
  "expectedUseRate",
  "platformBearingRatio",
]);
const DATE_KEYS = new Set(["activityStartAt", "activityEndAt"]);

const recognition = await inspectThreeSourceWorkbook({
  fileName: fileArg.split("/").pop() ?? "配券表.xlsx",
  bytes,
});

console.log(`\n===== 1. 材料角色判定 =====`);
if (recognition.roleCandidates.length === 0) {
  console.log("  ✗ 无任何角色候选:既不像配券表(≥5 个配券字段),也不像名单文件");
} else {
  for (const candidate of recognition.roleCandidates) {
    console.log(
      `  • ${candidate.role}(得分 ${candidate.score}):${candidate.reasons.join(";")}`,
    );
  }
  const sorted = [...recognition.roleCandidates].sort(
    (a, b) => b.score - a.score,
  );
  const ambiguous = sorted.length > 1 && sorted[0].score === sorted[1].score;
  console.log(
    ambiguous
      ? "  ⚠ 存在同分候选:线上会要求业务员人工确认角色"
      : `  ✓ 线上将自动判定为:${sorted[0].role}`,
  );
}

console.log(`\n===== 2. 常规满减券档发现 =====`);
const coupons = await discoverRegularFullReductionCoupons({ recognition });
if (!coupons.length) {
  console.log("  ✗ 未发现任何满减券数据行(表头命中列在数据行至少要有 2 列有值)");
} else {
  for (const coupon of coupons) {
    console.log(
      `  • Sheet「${coupon.sheetName}」第 ${coupon.row} 行:${coupon.displayName}`,
    );
  }
}

console.log(`\n===== 3. 公式单元格扫描(无缓存结果 = 线上读不到值) =====`);
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(bytes);
let uncachedFormulas = 0;
for (const sheet of workbook.worksheets) {
  for (let row = 1; row <= Math.min(sheet.rowCount, 100); row += 1) {
    const cells = sheet.getRow(row);
    for (let column = 1; column <= Math.max(cells.cellCount, 1); column += 1) {
      const value = cells.getCell(column).value;
      if (
        value &&
        typeof value === "object" &&
        ("formula" in value || "sharedFormula" in value) &&
        ((value.result === undefined || value.result === null) ||
          (typeof value.result === "object" && "error" in value.result))
      ) {
        uncachedFormulas += 1;
        console.log(
          `  ⚠ ${sheet.name}!${sheet.getRow(row).getCell(column).address}:公式无缓存结果(线上依赖 AI 推导回退)`,
        );
      }
    }
  }
}
if (!uncachedFormulas) {
  console.log("  ✓ 未发现无缓存结果的公式单元格");
}

console.log(`\n===== 4. 字段命中与格式转换探针 =====`);
const fieldReport = {};
for (const [key, candidates] of Object.entries(
  recognition.couponFieldCandidates,
)) {
  const candidate = candidates[0];
  const sample = candidate?.sampleValues.find((value) => value.trim()) ?? "";
  let converted = "(原样)";
  if (NUMBER_KEYS.has(key)) {
    const parsed = parseFlexibleNumber(sample);
    converted = parsed === undefined ? "✗ 无法转为数字" : `✓ ${parsed}`;
  } else if (RATIO_KEYS.has(key)) {
    const parsed = normalizeRegularRatio(sample);
    converted = parsed === undefined ? "✗ 无法转为比例" : `✓ ${parsed}`;
  } else if (DATE_KEYS.has(key)) {
    const parsed = canonicalCouponBusinessDate(sample);
    converted = parsed ?? "⚠ 无法规范化为 YYYY-MM-DD(AI 修复流兜底)";
  } else if (sample) {
    converted = "✓ 文本";
  }
  fieldReport[key] = {
    header: candidate?.header,
    sheetName: candidate?.sheetName,
    column: candidate?.column,
    sample,
    converted,
  };
  console.log(
    `  • ${FIELD_LABELS[key] ?? key}:表头「${candidate?.header ?? "—"}」样例「${sample || "—"}」→ ${converted}`,
  );
}
const recognizedKeys = new Set(Object.keys(recognition.couponFieldCandidates));
const missingKeys = Object.keys(FIELD_LABELS).filter(
  (key) => !recognizedKeys.has(key),
);
if (missingKeys.length) {
  console.log(
    `  ⚠ 未命中表头的字段:${missingKeys
      .map((key) => `${FIELD_LABELS[key]}(${key})`)
      .join("、")}\n    → 线上会在第 3 步表单把这些字段作为人工补充输入展示`,
  );
}

console.log(`\n===== 5. 名单(ID/券档)列识别 =====`);
if (!recognition.listCandidates.length) {
  console.log("  ⚠ 未识别到 SKU/SPU/商家 ID 或券档列(若本文件是名单表,线上无法解析)");
} else {
  for (const candidate of recognition.listCandidates) {
    console.log(
      `  • ${candidate.kind}(${candidate.dimension ?? "—"}):表头「${candidate.header}」@${candidate.sheetName}!${candidate.column}`,
    );
  }
}

console.log(`\n===== 6. 确认演练(无 AI、无人工补充,即最坏情况) =====`);
try {
  const confirmed = await confirmRegularFullReductionCoupon({
    recognition,
    ownerId: "audit-local",
    revision: 1,
    ownerConfirmedCouponType: "regular_full_reduction",
    ownerFieldValues: { activityPointPercent: 6 },
  });
  console.log("  ✓ 确认通过:纯规则路径即可生成标准附件");
  console.log(
    `    档位名:${confirmed.input.thresholdYuan}减${confirmed.input.discountAmountYuan},总数量:${confirmed.input.totalQuantity}`,
  );
} catch (error) {
  if (error instanceof RegularFullReductionFieldError) {
    console.log("  ⚠ 确认未通过(与线上第 3 步横幅一致,均含可修改字段):");
    for (const issue of error.fieldIssues) {
      console.log(`    - [${issue.key}] ${issue.message}`);
    }
    console.log(
      "    说明:线上会把这些字段渲染成可编辑输入,AI 识别成功的推导值会自动回退填充公式等读不到的字段。",
    );
  } else {
    console.log(`  ✗ 非字段类错误:${error.message}`);
  }
}

if (jsonOut) {
  writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        file: fileArg,
        roleCandidates: recognition.roleCandidates,
        coupons: coupons.map((coupon) => ({
          sheetName: coupon.sheetName,
          row: coupon.row,
          displayName: coupon.displayName,
        })),
        uncachedFormulas,
        fields: fieldReport,
        missingKeys,
        listCandidates: recognition.listCandidates.map((candidate) => ({
          kind: candidate.kind,
          dimension: candidate.dimension,
          header: candidate.header,
          sheetName: candidate.sheetName,
          column: candidate.column,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nJSON 报告已写入:${jsonOut}`);
}
