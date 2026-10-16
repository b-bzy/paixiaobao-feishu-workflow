#!/usr/bin/env node

/**
 * 飞书卡片真发审计:把三源链路上全部卡片形态构建出来,逐张真实调用 im
 * 发送接口验证 schema,发完立即撤回。飞书对非法属性返回精确的
 * ErrCode 200621 + JSON path,是这类回归(2026-10-15 的 select_static
 * label / default_value 两连)唯一权威的判定方式——结构化单测只能防已知。
 *
 * 用法:
 *   pnpm audit:cards                          # 干跑:仅构建,不发送
 *   pnpm audit:cards -- --send                # 真发 + 撤回(需飞书环境)
 *   pnpm audit:cards -- --draft 导出.json     # 附加用真实 Base 草稿渲染
 *   pnpm audit:cards -- --send --only mapping # 只跑名字含 mapping 的卡片
 *
 * --draft 文件格式(lark-cli base +record-list 导出后拼接):
 *   { ...State JSON 原样, "ownerOpenId": "ou_xxx", "recordId": "recxxx" }
 *   Owner Open ID 在 Base 的独立列,不在 State JSON 里,必须手动带上。
 * 真发目标:草稿 ownerOpenId 或环境变量 FEISHU_AUDIT_TARGET_OPEN_ID。
 * 需要 FEISHU_APP_ID/FEISHU_APP_SECRET(与被测部署同应用,open_id 才有效)。
 */

import { readFileSync } from "node:fs";
import { sendFeishuCardWithReceipt, getTenantAccessToken } from "../server/lib/feishu/client.ts";
import {
  buildCouponOaAttachmentRequestCard,
  buildCouponOaSubmitCard,
} from "../server/lib/feishu/coupon-oa/cards.ts";
import {
  buildCouponThreeSourceClearedCard,
  buildCouponThreeSourceCompletedCard,
  buildCouponThreeSourceErrorCard,
  buildCouponThreeSourceGeneratingArtifactsCard,
  buildCouponThreeSourceIntakeCard,
  buildCouponThreeSourceMappingCard,
  buildCouponThreeSourceNoBlacklistCard,
  buildCouponThreeSourceOverlapCard,
  buildCouponThreeSourcePreviewCard,
  buildCouponThreeSourceRecognizingCard,
  buildCouponThreeSourceRoleCard,
  buildCouponThreeSourceRuntimeBlockedCard,
  buildCouponThreeSourceUnavailableCard,
} from "../server/lib/feishu/coupon-oa/three-source/cards.ts";
import { createCouponThreeSourceTask } from "../server/lib/coupon-oa/three-source/task.ts";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const liveSend = process.argv.includes("--send");
const only = argument("--only");
const draftFile = argument("--draft");

// 让预览按钮行也进入审计覆盖。
process.env.FEISHU_WEB_BASE_URL = "https://audit.example.com";

function baseDraft(ownerOpenId) {
  const task = createCouponThreeSourceTask({
    taskId: "CTS-audit",
    ownerOpenId,
  });
  task.revision = 4;
  task.status = "AwaitingSourceConfirmation";
  const source = {
    messageId: "om-audit",
    fileKey: "fk-audit",
    fileName: "配券表.xlsx",
    bytes: 10,
    sha256: "a".repeat(64),
  };
  task.sources = {
    couponTable: { role: "couponTable", ...source },
    whitelist: { role: "whitelist", ...source },
  };
  task.blacklistStatus = "absent_confirmed";
  return {
    recordId: "rec-audit",
    pilotId: "CTS-audit",
    ownerOpenId,
    task,
    schemaVersion: "coupon-three-source-pilot-v2",
    recognitions: {},
    selections: {},
    artifacts: [],
    processedMessageIds: [],
    validationIssues: [],
  };
}

function fullFeatureDraft(ownerOpenId) {
  const draft = baseDraft(ownerOpenId);
  draft.task.blacklistStatus = "absent_pending_confirmation";
  draft.failureReason = "审计示例原因";
  draft.validationIssues = [
    "输入校验[totalQuantity]：「申请总数量」的取值无法识别为数字，请修改后重新提交",
  ];
  draft.selections.ownerFieldValues = {
    overDeduction: "是",
    overDeductionReason: "审计示例",
    channels: ["京东", "拍拍"],
  };
  draft.recognitions.couponTable = {
    source: {
      messageId: "om-audit",
      fileKey: "fk-audit",
      fileName: "配券表.xlsx",
      bytes: 10,
      sha256: "a".repeat(64),
    },
    sourceHash: "a".repeat(64),
    roleCandidates: [],
    couponFieldCandidates: {
      totalQuantity: [
        {
          id: "total-1",
          key: "totalQuantity",
          score: 1,
          header: "总申请数量",
          headerRow: 1,
          column: "J",
          sheetName: "Sheet1",
          sampleValues: ["1000"],
          reasons: [],
        },
      ],
    },
    listCandidates: [],
    issues: [],
    ai: {
      runId: "run-audit",
      revision: 4,
      sourceSha256: "a".repeat(64),
      status: "failed",
      fallbackCode: "timeout",
      primary: true,
      activityCopyEnabled: true,
      result: {
        sourceHash: "a".repeat(64),
        roleCandidates: [],
        couponCandidates: [],
        fieldCandidates: [
          {
            key: "thresholdYuan",
            sheetName: "Sheet1",
            headerCell: "H1",
            valueCell: "H2",
            confidence: 0.5,
            reason: "低置信示例",
            origin: "ai_inferred",
            value: 100,
          },
        ],
        listCandidates: [],
        issues: [],
      },
    },
  };
  return draft;
}

function previewDraft(ownerOpenId) {
  const draft = baseDraft(ownerOpenId);
  draft.task.status = "AwaitingFinalConfirmation";
  draft.oaPrefill = {
    ownerId: ownerOpenId,
    revision: 4,
    snapshotHash: "e".repeat(64),
    values: {
      businessMode: "寄卖",
      activityName: "审计活动",
      activityPointPercent: 6,
      overDeduction: "否",
      activityStartAt: "2030-01-01",
      activityEndAt: "2030-01-02",
    },
    attachments: [],
    blacklistStatus: "absent_confirmed",
    overlap: { ids: [], sha256: "f".repeat(64) },
  };
  draft.artifacts = [
    {
      artifactId: "couponTable-x",
      order: 0,
      role: "couponTable",
      fileName: "配券表.xlsx",
      fileToken: "tok-1",
      bytes: 10,
      sha256: "1".repeat(64),
      templateId: "t",
      templateVersion: "v1",
      previewGrantedFor: ownerOpenId,
    },
    {
      artifactId: "calcImage-1",
      order: 0,
      role: "calcImage",
      fileName: "测算图1.png",
      fileToken: "tok-2",
      bytes: 10,
      sha256: "2".repeat(64),
      templateId: "user-upload",
      templateVersion: "1",
      contentType: "image/png",
      previewGrantedFor: ownerOpenId,
    },
  ];
  return draft;
}

const target =
  process.env.FEISHU_AUDIT_TARGET_OPEN_ID ??
  (draftFile ? JSON.parse(readFileSync(draftFile, "utf8")).ownerOpenId : undefined);

const realDraft = draftFile
  ? (() => {
      const parsed = JSON.parse(readFileSync(draftFile, "utf8"));
      if (!parsed.ownerOpenId) {
        throw new Error(
          "--draft 文件缺少 ownerOpenId(它在 Base 的 Owner Open ID 列,不在 State JSON)",
        );
      }
      return parsed;
    })()
  : undefined;

if (liveSend && !target) {
  console.error(
    "真发需要目标:用 --draft(带 ownerOpenId)或设置 FEISHU_AUDIT_TARGET_OPEN_ID",
  );
  process.exit(2);
}

// 干跑用占位 open_id;真发已单独强制要求目标。
const owner = target ?? "ou_audit-dry-run";
const oaValues = {
  applicationType: "优惠券申请",
  businessMode: "寄卖",
  activityName: "审计活动",
  activityBackground: "审计背景",
  activityPointPercent: 6,
  platformBearingPercent: 50,
  overDeduction: "否",
  estimatedGmvYuan: 1000,
  estimatedCostYuan: 100,
  channels: ["京东渠道"],
  activityStartAt: "2030-01-01",
  activityEndAt: "2030-01-02",
};

const matrix = [
  ["unavailable", () => buildCouponThreeSourceUnavailableCard()],
  ["runtimeBlocked", () => buildCouponThreeSourceRuntimeBlockedCard()],
  ["generating", () => buildCouponThreeSourceGeneratingArtifactsCard()],
  ["cleared", () =>
    buildCouponThreeSourceClearedCard({ clearedCount: 1, closedOaDraftCount: 1 })],
  ["intake-empty", () => buildCouponThreeSourceIntakeCard()],
  ["intake-draft", () => buildCouponThreeSourceIntakeCard(baseDraft(owner))],
  ["noBlacklist", () => buildCouponThreeSourceNoBlacklistCard(baseDraft(owner))],
  ["recognizing", () => buildCouponThreeSourceRecognizingCard(baseDraft(owner))],
  ["overlap", () => buildCouponThreeSourceOverlapCard({ draft: baseDraft(owner), count: 2 })],
  ["mapping-basic", () => buildCouponThreeSourceMappingCard(baseDraft(owner))],
  ["mapping-full", () => buildCouponThreeSourceMappingCard(fullFeatureDraft(owner))],
  ["preview-fallback", () => buildCouponThreeSourcePreviewCard(previewDraft(owner))],
  ["completed", () => buildCouponThreeSourceCompletedCard(baseDraft(owner))],
  ["error-reopen", () =>
    buildCouponThreeSourceErrorCard({
      message: "审计示例",
      reopen: { recordId: "rec-audit", revision: 4 },
    })],
  ["oaSubmit", () =>
    buildCouponOaSubmitCard({
      draftRecordId: "rec-oa",
      values: oaValues,
      attachments: [
        {
          role: "couponTable",
          fileName: "配券表.xlsx",
          fileCode: "code-1",
          sha256: "3".repeat(64),
          bytes: 100,
        },
      ],
      stepLabel: "第 4 步：核对无误后点击确认，将创建并发送正式 OA",
    })],
  ["oaAttachmentRequest", () =>
    buildCouponOaAttachmentRequestCard({
      draftId: "COA-1",
      missing: ["商品明细白名单（.xlsx）"],
    })],
  ...(realDraft
    ? [["mapping-REAL-DRAFT", () => buildCouponThreeSourceMappingCard(realDraft)]]
    : []),
];

const selected = only
  ? matrix.filter(([name]) => name.includes(only))
  : matrix;

console.log(
  `构建 ${selected.length} 张卡片(干跑仅验证构建器不抛错;--send 真发并撤回)…\n`,
);

// 本地 schema 上限静态检查(飞书是唯一裁判,但已实测的上限先在干跑拦住):
// - 组件 name > 100:ErrCode 11310(2026-10-16 事故,64 位哈希后缀);
// - input default_value > 800:预填预算(cards.ts CARD_PREFILL_MAX_LENGTH),
//   超限值应被丢弃而非截断流入提交值。
const NAME_LIMIT = 100;
const DEFAULT_VALUE_LIMIT = 800;
function collectLimitViolations(node, path, violations) {
  if (Array.isArray(node)) {
    node.forEach((item, index) =>
      collectLimitViolations(item, `${path}[${index}]`, violations),
    );
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (key === "name" && typeof value === "string" && value.length > NAME_LIMIT) {
      violations.push(
        `${path}.name ${value.length} > ${NAME_LIMIT}: ${value.slice(0, 72)}`,
      );
    }
    if (
      key === "default_value" &&
      typeof value === "string" &&
      value.length > DEFAULT_VALUE_LIMIT
    ) {
      violations.push(
        `${path}.default_value ${value.length} > ${DEFAULT_VALUE_LIMIT}`,
      );
    }
    collectLimitViolations(value, `${path}.${key}`, violations);
  }
}

const results = [];
for (const [name, build] of selected) {
  try {
    const card = build();
    const limitViolations = [];
    collectLimitViolations(card, "card", limitViolations);
    if (limitViolations.length > 0) {
      results.push({
        name,
        ok: false,
        error: `本地长度上限检查失败:\n  ${limitViolations.join("\n  ")}`,
      });
      continue;
    }
    if (!liveSend) {
      results.push({ name, ok: true, dryRun: true });
      continue;
    }
    const receipt = await sendFeishuCardWithReceipt(owner, card);
    results.push({ name, ok: true, messageId: receipt.messageId });
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
  }
}

// 真发成功后立即撤回,尽量不污染会话;撤回失败只影响整洁度不影响结论。
if (liveSend) {
  const token = await getTenantAccessToken();
  for (const result of results.filter((item) => item.ok && item.messageId)) {
    try {
      const response = await fetch(
        `https://open.feishu.cn/open-apis/im/v1/messages/${result.messageId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      );
      result.retracted = response.ok;
    } catch {
      result.retracted = false;
    }
  }
}

console.log("===== 卡片真发审计结果 =====");
for (const result of results) {
  if (result.ok) {
    const suffix = liveSend
      ? result.retracted
        ? "(已撤回)"
        : "(撤回失败,请手动清理)"
      : "(干跑)";
    console.log(`PASS ${result.name} ${suffix}`);
  } else {
    console.log(`FAIL ${result.name}:`);
    console.log(`  ${result.error}`);
  }
}
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
if (failed > 0) process.exit(1);
