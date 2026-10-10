#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import ExcelJS from "exceljs";
import {
  buildActivityCopyAiPrompt,
  validateActivityCopyAiProposal,
  validateActivityCopyContext,
} from "./lib/coupon-activity-copy.mjs";

const defaultDeepSeekUrl = "https://api.deepseek.com/chat/completions";
const defaultModel = "deepseek-chat";
const chunkCharacterLimit = 45_000;
const externalCanonicalFieldAliases = new Map([
  ["活动名称", "activityName"],
  ["活动背景", "activityBackground"],
  ["业务模式", "businessMode"],
  ["申请人", "applicantName"],
  ["活动开始日期", "activityStartAt"],
  ["活动结束日期", "activityEndAt"],
  ["用券渠道", "channels"],
  ["总申请数量", "totalQuantity"],
  ["单次发放到账张数", "grantQuantityPerClaim"],
  ["每日领取次数", "dailyClaimLimit"],
  ["面额", "discountAmountYuan"],
  ["限额", "thresholdYuan"],
  ["可领时间", "claimWindow"],
  ["可用时间", "useWindow"],
  ["预计领用率", "expectedClaimRate"],
  ["预计使用率", "expectedUseRate"],
  ["拍拍平台承担比例", "platformBearingRatio"],
  ["预计引入GMV", "estimatedGmvYuan"],
  ["用户领券规则", "claimRule"],
  ["优惠券赠送", "allowGift"],
  ["推广途径", "promotionMode"],
  ["公开推广渠道", "publicPromotionChannels"],
]);
const intentionalBlankModelFields = new Set([
  "活动ID",
  "批次Id",
  "putKey",
  "PC端领券链接",
  "M端领券链接",
]);
const computedModelFields = new Set([
  "优惠券名称",
  "优惠比例",
  "预估ROI",
  "预计费用",
]);
const fixedTemplateDefaultModelFields = new Set([
  "优惠券类型",
  "限品类型",
  "领券用户风控",
]);
const allowedCanonicalFields = new Set([
  "activityName",
  "activityBackground",
  "businessMode",
  "applicantName",
  "activityStartAt",
  "activityEndAt",
  "channels",
  "thresholdYuan",
  "discountAmountYuan",
  "totalQuantity",
  "grantQuantityPerClaim",
  "dailyClaimLimit",
  "claimWindow",
  "useWindow",
  "expectedClaimRate",
  "expectedUseRate",
  "platformBearingRatio",
  "estimatedGmvYuan",
  "claimRule",
  "allowGift",
  "promotionMode",
  "publicPromotionChannels",
  "overDeduction",
  "overDeductionReason",
]);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeFileName(value) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error("输出后缀只能包含字母、数字、下划线和连字符");
  }
  return value;
}

function normalizeEnvValue(value) {
  const text = value.trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

async function readDotEnv(path) {
  try {
    const content = await readFile(path, "utf8");
    const values = {};
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match) values[match[1]] = normalizeEnvValue(match[2]);
    }
    return values;
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

function safeCellValue(cell) {
  if (cell.value === null || cell.value === undefined) return undefined;
  if (typeof cell.value === "object" && "richText" in cell.value) {
    return {
      kind: "richText",
      value: cell.value.richText.map((item) => item.text).join(""),
    };
  }
  if (typeof cell.value === "object" && "formula" in cell.value) {
    return {
      kind: "formula",
      formula: cell.value.formula,
      result: cell.value.result ?? null,
    };
  }
  if (cell.value instanceof Date) {
    return { kind: "date", value: cell.value.toISOString() };
  }
  return { kind: typeof cell.value, value: String(cell.value) };
}

function serializedCell(cell) {
  const value = safeCellValue(cell);
  if (!value) return undefined;
  return {
    address: cell.address,
    type: cell.type,
    value,
    numberFormat: cell.numFmt || undefined,
  };
}

function rowCells(worksheet, rowNumber) {
  const row = worksheet.getRow(rowNumber);
  const cells = [];
  for (let column = 1; column <= worksheet.columnCount; column += 1) {
    const cell = serializedCell(row.getCell(column));
    if (cell) cells.push(cell);
  }
  return cells;
}

function mergeRanges(worksheet) {
  return Object.keys(worksheet._merges ?? {}).sort();
}

function chunkSheet(input) {
  const chunks = [];
  let pendingRows = [];
  let pendingSize = 0;
  const flush = () => {
    if (!pendingRows.length) return;
    const payload = {
      fileName: input.fileName,
      sourceHash: input.sourceHash,
      sheetName: input.sheetName,
      sheetState: input.sheetState,
      dimensions: input.dimensions,
      mergedCells: input.mergedCells,
      rows: pendingRows,
    };
    const raw = JSON.stringify(payload);
    chunks.push({
      chunkIndex: chunks.length,
      firstRow: pendingRows[0].row,
      lastRow: pendingRows.at(-1).row,
      payload,
      sha256: sha256(raw),
      characters: raw.length,
    });
    pendingRows = [];
    pendingSize = 0;
  };
  for (let rowNumber = 1; rowNumber <= input.worksheet.rowCount; rowNumber += 1) {
    const cells = rowCells(input.worksheet, rowNumber);
    if (!cells.length) continue;
    const row = { row: rowNumber, cells };
    const rowSize = JSON.stringify(row).length;
    if (pendingRows.length && pendingSize + rowSize > chunkCharacterLimit) flush();
    pendingRows.push(row);
    pendingSize += rowSize;
  }
  flush();
  return chunks;
}

async function serializeWorkbook(path) {
  const bytes = await readFile(path);
  const sourceHash = sha256(bytes);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const fileName = basename(path);
  const chunks = workbook.worksheets.flatMap((worksheet) =>
    chunkSheet({
      fileName,
      sourceHash,
      worksheet,
      sheetName: worksheet.name,
      sheetState: worksheet.state,
      dimensions: {
        rows: worksheet.rowCount,
        columns: worksheet.columnCount,
      },
      mergedCells: mergeRanges(worksheet),
    }),
  );
  const cells = new Map(
    chunks.flatMap((chunk) =>
      chunk.payload.rows.flatMap((row) =>
        row.cells.map((cell) => [`${chunk.payload.sheetName}!${cell.address}`, cell]),
      ),
    ),
  );
  const addresses = new Set(cells.keys());
  return {
    path,
    fileName,
    sourceHash,
    bytes: bytes.byteLength,
    sheets: workbook.worksheets.map((worksheet) => ({
      name: worksheet.name,
      state: worksheet.state,
      rowCount: worksheet.rowCount,
      columnCount: worksheet.columnCount,
      mergedCells: mergeRanges(worksheet),
    })),
    chunks,
    cells,
    addresses,
  };
}

function parseJsonContent(value) {
  const text = String(value ?? "").trim();
  const json = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(json);
  } catch {
    throw new Error("DeepSeek 未返回可解析的 JSON");
  }
}

function proposalSystemPrompt() {
  return [
    "你是 Excel 三源优惠券 OA 映射识别器。",
    "只依据用户提供的工作簿内容提出候选，不得补造业务事实。",
    "所有字段候选必须引用存在的 Sheet 名和单元格坐标。",
    "遇到歧义、缺失、公式、非文本 SKU、重复或跨券档冲突时，必须列入 warnings 或 ambiguities。",
    "不得返回飞书 file_code、审批实例、活动 ID、批次 ID、putKey 或链接的虚构值。",
    "只返回严格 JSON。",
  ].join("\n");
}

function chunkPrompt(chunk) {
  return {
    task: "识别本工作簿分块的结构和映射证据。",
    responseSchema: {
      sourceRoleCandidates: [
        { role: "couponTable|whitelist|blacklist", confidence: 0, reasons: ["" ] },
      ],
      tableRegions: [
        { sheetName: "", headerRow: 1, dataStartRow: 2, dataEndRow: 2, reasons: [""] },
      ],
      fieldCandidates: [
        {
          canonicalField: "one of known coupon OA fields or unknown",
          sheetName: "",
          headerCell: "A1",
          evidenceCells: ["A2"],
          confidence: 0,
          reason: "",
        },
      ],
      identifierCandidates: [
        { dimension: "SKU|SPU|MERCHANT_ID", sheetName: "", headerCell: "A1", confidence: 0, reason: "" },
      ],
      tierCandidates: [
        { tier: "", source: "sheetName|header|column|title", sheetName: "", evidenceCells: ["A1"], confidence: 0, reason: "" },
      ],
      warnings: [""],
      ambiguities: [""],
    },
    workbookChunk: chunk.payload,
  };
}

function aggregatePrompt(workbook, chunkAnalyses) {
  return {
    task: "基于同一工作簿的全部分块分析，生成全局三源映射候选。不要补造未出现的值。",
    responseSchema: {
      sourceRole: "couponTable|whitelist|blacklist|unknown",
      sourceRoleConfidence: 0,
      tableRegions: [
        { sheetName: "", headerRow: 1, dataStartRow: 2, dataEndRow: 2, reason: "" },
      ],
      fieldCandidates: [
        {
          canonicalField: "known OA field",
          sheetName: "",
          headerCell: "A1",
          evidenceCells: ["A2"],
          confidence: 0,
          reason: "",
        },
      ],
      identifierCandidates: [
        { dimension: "SKU|SPU|MERCHANT_ID", sheetName: "", headerCell: "A1", confidence: 0, reason: "" },
      ],
      tierCandidates: [
        { tier: "", source: "sheetName|header|column|title", sheetName: "", evidenceCells: ["A1"], confidence: 0, reason: "" },
      ],
      missingFacts: [""],
      warnings: [""],
      ambiguities: [""],
    },
    workbook: {
      fileName: workbook.fileName,
      sourceHash: workbook.sourceHash,
      sheets: workbook.sheets,
      chunks: chunkAnalyses,
    },
  };
}

function assertDeepSeekEndpoint(url) {
  const endpoint = new URL(url);
  if (endpoint.origin !== "https://api.deepseek.com") {
    throw new Error("DeepSeek API 地址必须为 https://api.deepseek.com");
  }
  if (endpoint.pathname !== "/chat/completions") {
    throw new Error("DeepSeek API 地址必须使用 /chat/completions");
  }
  return endpoint;
}

async function callDeepSeek(input) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(input.endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: proposalSystemPrompt() },
          { role: "user", content: JSON.stringify(input.prompt) },
        ],
      }),
    });
    const body = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new Error(`DeepSeek 请求失败：HTTP ${response.status}`);
    }
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("DeepSeek 响应缺少 message content");
    }
    return {
      response: body,
      proposal: parseJsonContent(content),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function cellDisplayValue(cell) {
  if (!cell?.value || typeof cell.value !== "object") return "";
  if (cell.value.kind === "formula") return String(cell.value.result ?? "");
  return String(cell.value.value ?? "");
}

function normalizeLabel(value) {
  return String(value ?? "").replace(/[\s_\-]/g, "").toLowerCase();
}

function normalizeTier(value) {
  return String(value ?? "").replace(/\s/g, "").replace(/^满/, "");
}

function validateIdentifierCandidates(proposal, workbook, issues, localWarnings) {
  const dimensions = new Set(["SKU", "SPU", "MERCHANT_ID"]);
  const candidates = Array.isArray(proposal?.identifierCandidates)
    ? proposal.identifierCandidates
    : [];
  const verified = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || !dimensions.has(candidate.dimension)) {
      issues.push("DeepSeek 返回了无效标识列候选");
      continue;
    }
    if (typeof candidate.sheetName !== "string" || typeof candidate.headerCell !== "string") {
      issues.push(`标识列 ${candidate.dimension} 缺少 Sheet 或表头坐标`);
      continue;
    }
    const headerAddress = `${candidate.sheetName}!${candidate.headerCell}`;
    const header = workbook.cells.get(headerAddress);
    if (!header) {
      issues.push(`标识列 ${candidate.dimension} 引用了不存在的表头坐标：${headerAddress}`);
      continue;
    }
    const headerText = cellDisplayValue(header);
    const normalizedHeader = normalizeLabel(headerText);
    const headerSemanticMatch = candidate.dimension === "SKU"
      ? normalizedHeader.includes("sku")
      : candidate.dimension === "SPU"
        ? normalizedHeader.includes("spu")
        : normalizedHeader.includes("merchant") || normalizedHeader.includes("商家") || normalizedHeader.includes("店铺");
    if (!headerSemanticMatch) {
      localWarnings.push(
        `标识列候选 ${candidate.dimension} 的表头 ${headerAddress}（${headerText || "空白"}）未验证出对应语义`,
      );
    }
    const confidence = Number(candidate.confidence);
    verified.push({
      dimension: candidate.dimension,
      sheetName: candidate.sheetName,
      headerCell: candidate.headerCell,
      headerText,
      headerSemanticMatch,
      confidence: Number.isFinite(confidence) ? confidence : null,
      reason: typeof candidate.reason === "string" ? candidate.reason : "",
    });
  }
  return verified;
}

function validateTierCandidates(proposal, workbook, issues, localWarnings) {
  const sources = new Set(["sheetName", "header", "column", "title"]);
  const candidates = Array.isArray(proposal?.tierCandidates) ? proposal.tierCandidates : [];
  const verified = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || typeof candidate.tier !== "string" || !candidate.tier.trim()) {
      issues.push("DeepSeek 返回了无效券档候选");
      continue;
    }
    if (!sources.has(candidate.source) || typeof candidate.sheetName !== "string") {
      issues.push(`券档 ${candidate.tier} 缺少有效来源或 Sheet`);
      continue;
    }
    if (!workbook.sheets.some((sheet) => sheet.name === candidate.sheetName)) {
      issues.push(`券档 ${candidate.tier} 引用了不存在的 Sheet：${candidate.sheetName}`);
      continue;
    }
    const evidenceCells = stringArray(candidate.evidenceCells);
    if (!evidenceCells.length) {
      issues.push(`券档 ${candidate.tier} 缺少证据单元格`);
      continue;
    }
    const addresses = evidenceCells.map((cell) => `${candidate.sheetName}!${cell}`);
    if (addresses.some((address) => !workbook.cells.has(address))) {
      issues.push(`券档 ${candidate.tier} 引用了不存在的证据单元格`);
      continue;
    }
    const evidenceValues = addresses.map((address) => cellDisplayValue(workbook.cells.get(address)));
    const normalizedCandidate = normalizeTier(candidate.tier);
    const tierSemanticMatch = candidate.source === "sheetName"
      ? normalizeTier(candidate.sheetName) === normalizedCandidate
      : evidenceValues.some((value) => normalizeTier(value).includes(normalizedCandidate));
    if (!tierSemanticMatch) {
      localWarnings.push(`券档候选 ${candidate.tier} 的本地证据未匹配券档文本`);
    }
    const confidence = Number(candidate.confidence);
    verified.push({
      tier: candidate.tier,
      source: candidate.source,
      sheetName: candidate.sheetName,
      evidenceCells,
      evidenceValues,
      tierSemanticMatch,
      confidence: Number.isFinite(confidence) ? confidence : null,
      reason: typeof candidate.reason === "string" ? candidate.reason : "",
    });
  }
  return verified;
}

function validateTableRegions(proposal, workbook, issues) {
  const candidates = Array.isArray(proposal?.tableRegions) ? proposal.tableRegions : [];
  const verified = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || typeof candidate.sheetName !== "string") {
      issues.push("DeepSeek 返回了无效数据区域候选");
      continue;
    }
    const sheet = workbook.sheets.find((item) => item.name === candidate.sheetName);
    const headerRow = Number(candidate.headerRow);
    const dataStartRow = Number(candidate.dataStartRow);
    const dataEndRow = Number(candidate.dataEndRow);
    if (
      !sheet ||
      !Number.isInteger(headerRow) ||
      !Number.isInteger(dataStartRow) ||
      !Number.isInteger(dataEndRow) ||
      headerRow < 1 ||
      dataStartRow <= headerRow ||
      dataEndRow < dataStartRow ||
      dataEndRow > sheet.rowCount
    ) {
      issues.push(`数据区域 ${candidate.sheetName} 的行边界无效`);
      continue;
    }
    verified.push({
      sheetName: candidate.sheetName,
      headerRow,
      dataStartRow,
      dataEndRow,
      reason: typeof candidate.reason === "string" ? candidate.reason : "",
    });
  }
  return verified;
}

function buildMappingConfirmation(verified, decisions) {
  const coupon = verified.find((item) => item.validation.sourceRole === "couponTable");
  const whitelist = verified.find((item) => item.validation.sourceRole === "whitelist");
  const blacklist = verified.find((item) => item.validation.sourceRole === "blacklist");
  const couponTiers = coupon?.validation.tierCandidates ?? [];
  const whitelistTiers = whitelist?.validation.tierCandidates ?? [];
  const couponTierKeys = new Set(couponTiers.map((item) => normalizeTier(item.tier)));
  const whitelistTierKeys = new Set(whitelistTiers.map((item) => normalizeTier(item.tier)));
  const unmatchedCouponTiers = couponTiers
    .filter((item) => !whitelistTierKeys.has(normalizeTier(item.tier)))
    .map((item) => item.tier);
  const unmatchedWhitelistTiers = whitelistTiers
    .filter((item) => !couponTierKeys.has(normalizeTier(item.tier)))
    .map((item) => item.tier);
  const selectedIdentifierCandidates = decisions.selectedIdentifierDimension && whitelist
    ? whitelist.validation.identifierCandidates.filter(
        (item) => item.dimension === decisions.selectedIdentifierDimension && item.headerSemanticMatch,
      )
    : [];
  const expectedWhitelistSheets = new Set(whitelistTiers.map((item) => item.sheetName));
  const selectedIdentifierSheets = new Set(selectedIdentifierCandidates.map((item) => item.sheetName));
  const selectedIdentifierCoverage = !decisions.selectedIdentifierDimension
    ? null
    : [...expectedWhitelistSheets].every((sheetName) => selectedIdentifierSheets.has(sheetName));
  const integrityPassed = verified.every((item) => item.validation.issues.length === 0);
  const tierAlignmentPassed =
    couponTierKeys.size > 0 &&
    whitelistTierKeys.size > 0 &&
    unmatchedCouponTiers.length === 0 &&
    unmatchedWhitelistTiers.length === 0;
  const blacklistState = blacklist
    ? "uploaded"
    : decisions.noBlacklistConfirmed
      ? "absent_confirmed"
      : "absent_pending_confirmation";
  const status = !integrityPassed || !coupon || !whitelist || !tierAlignmentPassed
    ? "needs_review"
    : !decisions.selectedIdentifierDimension
      ? "awaiting_identifier_selection"
      : !selectedIdentifierCoverage
        ? "needs_review"
        : blacklistState === "absent_pending_confirmation"
          ? "awaiting_blacklist_confirmation"
          : "ready_for_practice_generation";
  return {
    status,
    integrityPassed,
    tierAlignmentPassed,
    couponTiers,
    whitelistTiers,
    unmatchedCouponTiers,
    unmatchedWhitelistTiers,
    selectedIdentifierDimension: decisions.selectedIdentifierDimension ?? null,
    selectedIdentifierCandidates,
    selectedIdentifierCoverage,
    blacklistState,
    couponFieldMappings: coupon?.validation.fieldCandidates ?? [],
    couponPolicyExcludedFields: coupon?.validation.policyExcludedFields ?? [],
    whitelistIdentifierCandidates: whitelist?.validation.identifierCandidates ?? [],
  };
}

function mappingConfirmationMarkdown(review) {
  const lines = [
    "# 本地 AI 映射确认报告",
    "",
    `- 映射状态：\`${review.status}\``,
    `- 坐标/哈希完整性：${review.integrityPassed ? "通过" : "未通过"}`,
    `- 配券表与白名单券档对齐：${review.tierAlignmentPassed ? "通过" : "未通过"}`,
    `- 黑名单状态：\`${review.blacklistState}\``,
    `- 已选择标识维度：${review.selectedIdentifierDimension ?? "待业务确认"}`,
    "",
    "## 券档对齐",
    "",
    "| 配券表券档 | 白名单券档 |",
    "| --- | --- |",
    ...review.couponTiers.map((tier) => {
      const match = review.whitelistTiers.find(
        (item) => normalizeTier(item.tier) === normalizeTier(tier.tier),
      );
      return `| ${tier.tier} | ${match?.tier ?? "未匹配"} |`;
    }),
    "",
    "## 已验证的配券表字段映射",
    "",
    "| 源表表头 | 内部 OA 字段 | 坐标 |",
    "| --- | --- | --- |",
    ...review.couponFieldMappings.map(
      (field) => `| ${field.sourceField} | ${field.canonicalField} | ${field.sheetName}!${field.headerCell} |`,
    ),
    "",
    "## 白名单标识列候选",
    "",
    "| 维度 | 坐标 | 表头语义本地验证 |",
    "| --- | --- | --- |",
    ...review.whitelistIdentifierCandidates.map(
      (candidate) => `| ${candidate.dimension} | ${candidate.sheetName}!${candidate.headerCell} | ${candidate.headerSemanticMatch ? "通过" : "待确认"} |`,
    ),
    "",
    "## 按策略不写入 OA 的配券表字段",
    "",
    "| 源表字段 | 原因 |",
    "| --- | --- |",
    ...review.couponPolicyExcludedFields.map(
      (field) => `| ${field.sourceField} | ${field.category} |`,
    ),
    "",
    "该报告只确认 AI proposal 的源坐标、哈希与跨表券档关系。它不补造业务事实，也不创建飞书 OA。",
    "",
  ];
  return lines.join("\n");
}

function validateProposal(proposal, workbook) {
  const sourceRole = typeof proposal?.sourceRole === "string" ? proposal.sourceRole : "unknown";
  const issues = [];
  const localWarnings = [];
  const auxiliarySourceFields = [];
  const policyExcludedFields = [];
  const verifiedFields = [];
  const fieldCandidates = Array.isArray(proposal?.fieldCandidates)
    ? proposal.fieldCandidates
    : [];
  for (const candidate of fieldCandidates) {
    if (!candidate || typeof candidate !== "object") {
      issues.push("DeepSeek 返回了无效字段候选");
      continue;
    }
    const sourceField = candidate.canonicalField;
    if (typeof sourceField !== "string" || !sourceField.trim()) {
      issues.push("DeepSeek 字段候选缺少字段名称");
      continue;
    }
    const field = externalCanonicalFieldAliases.get(sourceField) ?? sourceField;
    const sheetName = candidate.sheetName;
    const headerCell = candidate.headerCell;
    const evidenceCells = stringArray(candidate.evidenceCells);
    const candidateLabel = allowedCanonicalFields.has(field) ? field : sourceField;
    const policyCategory = intentionalBlankModelFields.has(sourceField)
      ? "intentionally_blank"
      : computedModelFields.has(sourceField)
        ? "computed_from_source"
        : fixedTemplateDefaultModelFields.has(sourceField)
          ? "fixed_template_default"
          : "unmapped_noncanonical";
    if (typeof sheetName !== "string" || typeof headerCell !== "string") {
      issues.push(`字段 ${candidateLabel} 缺少 Sheet 或表头坐标`);
      continue;
    }
    const headerAddress = `${sheetName}!${headerCell}`;
    if (!workbook.addresses.has(headerAddress)) {
      issues.push(`字段 ${candidateLabel} 引用了不存在的表头坐标：${headerAddress}`);
      continue;
    }
    const confidence = Number(candidate.confidence);
    const verifiedCandidate = {
      sourceField,
      sheetName,
      headerCell,
      evidenceCells,
      confidence: Number.isFinite(confidence) ? confidence : null,
      reason: typeof candidate.reason === "string" ? candidate.reason : "",
    };
    if (!evidenceCells.length) {
      if (policyCategory === "intentionally_blank") {
        policyExcludedFields.push({ ...verifiedCandidate, category: policyCategory });
        continue;
      }
      issues.push(`字段 ${candidateLabel} 缺少证据单元格`);
      continue;
    }
    const missingEvidence = evidenceCells.filter(
      (cell) => !workbook.addresses.has(`${sheetName}!${cell}`),
    );
    if (missingEvidence.length) {
      issues.push(`字段 ${candidateLabel} 引用了不存在的证据单元格`);
      continue;
    }
    if (!allowedCanonicalFields.has(field)) {
      if (sourceRole === "whitelist" || sourceRole === "blacklist") {
        auxiliarySourceFields.push(verifiedCandidate);
        continue;
      }
      policyExcludedFields.push({ ...verifiedCandidate, category: policyCategory });
      continue;
    }
    verifiedFields.push({
      canonicalField: field,
      ...verifiedCandidate,
    });
  }
  const identifierCandidates = validateIdentifierCandidates(proposal, workbook, issues, localWarnings);
  const tierCandidates = validateTierCandidates(proposal, workbook, issues, localWarnings);
  const tableRegions = validateTableRegions(proposal, workbook, issues);
  return {
    status: issues.length ? "needs_review" : "verified_candidates",
    sourceRole,
    sourceRoleConfidence: Number.isFinite(Number(proposal?.sourceRoleConfidence))
      ? Number(proposal.sourceRoleConfidence)
      : null,
    fieldCandidates: verifiedFields,
    auxiliarySourceFields,
    policyExcludedFields,
    identifierCandidates,
    tierCandidates,
    tableRegions,
    missingFacts: stringArray(proposal?.missingFacts),
    warnings: [...stringArray(proposal?.warnings), ...localWarnings],
    ambiguities: stringArray(proposal?.ambiguities),
    issues,
  };
}

async function writePrivate(path, contents) {
  await writeFile(path, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

async function writePrivateJson(path, value) {
  await writePrivate(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function sourceMetadata(path) {
  const [bytes, file] = await Promise.all([readFile(path), stat(path)]);
  return {
    fileName: basename(path),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    mtimeMs: file.mtimeMs,
    ino: file.ino,
  };
}

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path && !path.startsWith("..") && !path.includes("../");
}

async function loadReusableAiRun(input) {
  const runPath = resolve(input.path);
  if (!isWithin(input.outputRoot, runPath)) {
    throw new Error("--reuse-ai-run 必须指向当前 case 的 local-output 目录中的既有识别结果");
  }
  const previousRun = JSON.parse(
    await readFile(join(runPath, "ai-recognition-run.json"), "utf8"),
  );
  const previousSources = Array.isArray(previousRun.sources) ? previousRun.sources : [];
  if (previousSources.length !== input.sources.length) {
    throw new Error("既有 AI 识别结果的源文件数量与当前 case 不一致");
  }
  for (const source of input.sources) {
    const previous = previousSources.find((item) => item?.fileName === source.fileName);
    if (previous?.sha256 !== source.sourceHash) {
      throw new Error(`既有 AI 识别结果与当前源文件哈希不匹配：${source.fileName}`);
    }
  }
  return { runPath, previousRun };
}

function parseReusableAggregateResponse(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("既有 DeepSeek 聚合响应缺少 message content");
  }
  return parseJsonContent(content);
}

async function loadActivityCopyInputs(input) {
  const contextPath = resolve(input.contextPath);
  const factsPath = resolve(input.factsPath);
  if (!isWithin(input.caseDirectory, contextPath) || !isWithin(input.caseDirectory, factsPath)) {
    throw new Error("活动文案上下文和事实文件必须位于当前 case 目录内");
  }
  const [contextContent, factsContent, contextMetadata, factsMetadata] = await Promise.all([
    readFile(contextPath, "utf8"),
    readFile(factsPath, "utf8"),
    sourceMetadata(contextPath),
    sourceMetadata(factsPath),
  ]);
  const context = validateActivityCopyContext(JSON.parse(contextContent));
  const facts = JSON.parse(factsContent);
  const sourceHashes = new Set(input.serializations.map((workbook) => workbook.sourceHash));
  if (!sourceHashes.has(facts?.sources?.couponSha256) || !sourceHashes.has(facts?.sources?.whitelistSha256)) {
    throw new Error("活动文案事实绑定的源文件 hash 与当前 case 不匹配");
  }
  const prompt = buildActivityCopyAiPrompt({ context, facts });
  return {
    context,
    facts,
    prompt,
    contextPath: relative(input.caseDirectory, contextPath),
    factsPath: relative(input.caseDirectory, factsPath),
    contextFileSha256: contextMetadata.sha256,
    factsFileSha256: factsMetadata.sha256,
  };
}

async function main() {
  const caseArgument = argument("--case-dir");
  const useDeepSeek = process.argv.includes("--use-deepseek");
  const reuseAiRunArgument = argument("--reuse-ai-run");
  const outputSuffix = argument("--output-suffix");
  const selectedIdentifierDimension = argument("--selected-identifier");
  const noBlacklistConfirmed = process.argv.includes("--confirm-no-blacklist");
  const activityCopyContextArgument = argument("--activity-copy-context");
  const activityCopyFactsArgument = argument("--activity-copy-facts");
  if (Boolean(activityCopyContextArgument) !== Boolean(activityCopyFactsArgument)) {
    throw new Error("--activity-copy-context 与 --activity-copy-facts 必须同时提供");
  }
  if (
    selectedIdentifierDimension &&
    !new Set(["SKU", "SPU", "MERCHANT_ID"]).has(selectedIdentifierDimension)
  ) {
    throw new Error("--selected-identifier 只能是 SKU、SPU 或 MERCHANT_ID");
  }
  if (!caseArgument) {
    throw new Error("必须显式提供 --case-dir");
  }
  if (useDeepSeek && reuseAiRunArgument) {
    throw new Error("--use-deepseek 与 --reuse-ai-run 不能同时使用");
  }
  const caseDirectory = resolve(caseArgument);
  const attachmentsDirectory = join(caseDirectory, "attachments");
  const attachmentNames = (await readdir(attachmentsDirectory))
    .filter((name) => name.endsWith(".xlsx"))
    .sort();
  if (!attachmentNames.length) throw new Error("附件目录内没有 XLSX 文件");
  const sourcesBefore = await Promise.all(
    attachmentNames.map((name) => sourceMetadata(join(attachmentsDirectory, name))),
  );
  const serializations = await Promise.all(
    attachmentNames.map((name) => serializeWorkbook(join(attachmentsDirectory, name))),
  );
  const runSeed = sha256(
    serializations.map((workbook) => workbook.sourceHash).sort().join(":"),
  ).slice(0, 16);
  const runName = outputSuffix
    ? `ai-recognition-${runSeed}-${safeFileName(outputSuffix)}`
    : `ai-recognition-${runSeed}`;
  const outputRoot = join(caseDirectory, "local-output");
  const reusableAiRun = reuseAiRunArgument
    ? await loadReusableAiRun({
        path: reuseAiRunArgument,
        outputRoot,
        sources: serializations,
      })
    : undefined;
  const activityCopyInputs = activityCopyContextArgument
    ? await loadActivityCopyInputs({
        contextPath: activityCopyContextArgument,
        factsPath: activityCopyFactsArgument,
        caseDirectory,
        serializations,
      })
    : undefined;
  const dotEnv = useDeepSeek ? await readDotEnv(join(process.cwd(), ".env.local")) : {};
  const apiKey = useDeepSeek ? process.env.DEEPSEEK_API_KEY || dotEnv.DEEPSEEK_API_KEY : undefined;
  const endpoint = useDeepSeek
    ? assertDeepSeekEndpoint(
        process.env.DEEPSEEK_BASE_URL || dotEnv.DEEPSEEK_BASE_URL || defaultDeepSeekUrl,
      )
    : undefined;
  const model = useDeepSeek
    ? process.env.DEEPSEEK_MODEL || dotEnv.DEEPSEEK_MODEL || defaultModel
    : "saved-ai-response";
  if (useDeepSeek && !apiKey) {
    throw new Error("未在 .env.local 或当前 shell 中找到 DEEPSEEK_API_KEY");
  }

  const outputDirectory = join(outputRoot, runName);
  const auditDirectory = join(outputDirectory, "ai-audit");
  const requestDirectory = join(auditDirectory, "requests");
  const responseDirectory = join(auditDirectory, "responses");
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  await mkdir(outputDirectory, { mode: 0o700 });
  await mkdir(auditDirectory, { mode: 0o700 });
  await mkdir(requestDirectory, { mode: 0o700 });
  await mkdir(responseDirectory, { mode: 0o700 });

  const requestManifest = [];
  const verified = [];
  let deepSeekCalls = 0;
  if (reusableAiRun) {
    for (const workbook of serializations) {
      const responsePath = join(
        reusableAiRun.runPath,
        "ai-audit",
        "responses",
        `${workbook.sourceHash.slice(0, 12)}-aggregate.json`,
      );
      const response = JSON.parse(await readFile(responsePath, "utf8"));
      const proposal = parseReusableAggregateResponse(response);
      verified.push({
        fileName: workbook.fileName,
        sourceHash: workbook.sourceHash,
        proposal,
        validation: validateProposal(proposal, workbook),
        reusedAggregateResponsePath: relative(caseDirectory, responsePath),
        aggregateResponseHash: sha256(JSON.stringify(response)),
      });
    }
  } else {
    for (const workbook of serializations) {
      const chunkAnalyses = [];
      for (const chunk of workbook.chunks) {
        const prompt = chunkPrompt(chunk);
        const requestJson = JSON.stringify(prompt);
        const requestPath = join(
          requestDirectory,
          `${workbook.sourceHash.slice(0, 12)}-${sha256(chunk.payload.sheetName).slice(0, 8)}-chunk-${String(chunk.chunkIndex).padStart(3, "0")}.json`,
        );
        await writePrivate(requestPath, `${requestJson}\n`);
        const requestEntry = {
          sourceHash: workbook.sourceHash,
          chunkIndex: chunk.chunkIndex,
          chunkHash: chunk.sha256,
          characters: chunk.characters,
          requestPath: relative(caseDirectory, requestPath),
        };
        if (useDeepSeek) {
          const result = await callDeepSeek({
            endpoint,
            apiKey,
            model,
            prompt,
          });
          deepSeekCalls += 1;
          const responsePath = join(
            responseDirectory,
            `${workbook.sourceHash.slice(0, 12)}-${sha256(chunk.payload.sheetName).slice(0, 8)}-chunk-${String(chunk.chunkIndex).padStart(3, "0")}.json`,
          );
          await writePrivateJson(responsePath, result.response);
          chunkAnalyses.push({
            chunkIndex: chunk.chunkIndex,
            chunkHash: chunk.sha256,
            proposal: result.proposal,
            responseHash: sha256(JSON.stringify(result.response)),
          });
          requestEntry.responsePath = relative(caseDirectory, responsePath);
        }
        requestManifest.push(requestEntry);
      }
      if (useDeepSeek) {
        const prompt = aggregatePrompt(workbook, chunkAnalyses);
        const result = await callDeepSeek({ endpoint, apiKey, model, prompt });
        deepSeekCalls += 1;
        const responsePath = join(responseDirectory, `${workbook.sourceHash.slice(0, 12)}-aggregate.json`);
        await writePrivateJson(responsePath, result.response);
        const validation = validateProposal(result.proposal, workbook);
        verified.push({
          fileName: workbook.fileName,
          sourceHash: workbook.sourceHash,
          proposal: result.proposal,
          validation,
          aggregateResponsePath: relative(caseDirectory, responsePath),
        });
      }
    }
  }

  let activityCopyReview;
  if (activityCopyInputs) {
    const promptVersion = "activity-copy-ai-v1";
    if (reusableAiRun) {
      const savedPath = join(reusableAiRun.runPath, "ai-audit", "activity-copy-review.json");
      const savedReview = JSON.parse(await readFile(savedPath, "utf8"));
      if (
        savedReview.promptVersion !== promptVersion ||
        savedReview.contextFileSha256 !== activityCopyInputs.contextFileSha256 ||
        savedReview.factsFileSha256 !== activityCopyInputs.factsFileSha256 ||
        savedReview.factsHash !== activityCopyInputs.facts.factsHash
      ) {
        throw new Error("既有活动文案 AI 审计与当前上下文、事实或 prompt 版本不匹配");
      }
      const revalidated = validateActivityCopyAiProposal({
        facts: activityCopyInputs.facts,
        proposal: savedReview.proposal,
      });
      if (revalidated.proposalHash !== savedReview.validation?.proposalHash) {
        throw new Error("既有活动文案 AI proposal hash 不匹配");
      }
      activityCopyReview = {
        ...savedReview,
        status: revalidated.status,
        validation: revalidated,
        reusedFrom: relative(caseDirectory, savedPath),
      };
    } else if (useDeepSeek) {
      const requestPath = join(auditDirectory, "activity-copy-request.json");
      await writePrivateJson(requestPath, activityCopyInputs.prompt);
      const result = await callDeepSeek({
        endpoint,
        apiKey,
        model,
        prompt: activityCopyInputs.prompt,
      });
      deepSeekCalls += 1;
      const responsePath = join(auditDirectory, "activity-copy-response.json");
      await writePrivateJson(responsePath, result.response);
      const validation = validateActivityCopyAiProposal({
        facts: activityCopyInputs.facts,
        proposal: result.proposal,
      });
      activityCopyReview = {
        status: validation.status,
        promptVersion,
        model,
        contextPath: activityCopyInputs.contextPath,
        contextFileSha256: activityCopyInputs.contextFileSha256,
        factsPath: activityCopyInputs.factsPath,
        factsFileSha256: activityCopyInputs.factsFileSha256,
        factsHash: activityCopyInputs.facts.factsHash,
        requestPath: relative(caseDirectory, requestPath),
        requestHash: sha256(JSON.stringify(activityCopyInputs.prompt)),
        responsePath: relative(caseDirectory, responsePath),
        responseHash: sha256(JSON.stringify(result.response)),
        proposal: result.proposal,
        validation,
      };
    } else {
      activityCopyReview = {
        status: "ready_for_deepseek",
        promptVersion,
        contextPath: activityCopyInputs.contextPath,
        contextFileSha256: activityCopyInputs.contextFileSha256,
        factsPath: activityCopyInputs.factsPath,
        factsFileSha256: activityCopyInputs.factsFileSha256,
        factsHash: activityCopyInputs.facts.factsHash,
      };
    }
  }

  const sourcesAfter = await Promise.all(
    attachmentNames.map((name) => sourceMetadata(join(attachmentsDirectory, name))),
  );
  if (JSON.stringify(sourcesBefore) !== JSON.stringify(sourcesAfter)) {
    throw new Error("DeepSeek 识别期间源文件已变化，拒绝生成映射结论");
  }
  const mappingConfirmation = buildMappingConfirmation(verified, {
    selectedIdentifierDimension,
    noBlacklistConfirmed,
  });
  await writePrivateJson(join(auditDirectory, "mapping-confirmation.json"), mappingConfirmation);
  await writePrivate(
    join(outputDirectory, "mapping-confirmation.md"),
    mappingConfirmationMarkdown(mappingConfirmation),
  );
  if (activityCopyReview) {
    await writePrivateJson(join(auditDirectory, "activity-copy-review.json"), activityCopyReview);
  }
  await writePrivateJson(join(auditDirectory, "chunk-manifest.json"), {
    sources: serializations.map((workbook) => ({
      fileName: workbook.fileName,
      sourceHash: workbook.sourceHash,
      bytes: workbook.bytes,
      sheets: workbook.sheets,
      chunks: workbook.chunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        firstRow: chunk.firstRow,
        lastRow: chunk.lastRow,
        chunkHash: chunk.sha256,
        characters: chunk.characters,
      })),
    })),
  });
  await writePrivateJson(join(auditDirectory, "request-manifest.json"), {
    networkPolicy: reusableAiRun
      ? "local-audit-reverification"
      : useDeepSeek
        ? "deepseek-only"
        : "no-network-dry-run",
    endpoint: endpoint?.origin ?? null,
    model,
    deepSeekCalls,
    reusedAiRun: reusableAiRun
      ? relative(caseDirectory, reusableAiRun.runPath)
      : null,
    activityCopy: activityCopyReview
      ? {
          status: activityCopyReview.status,
          promptVersion: activityCopyReview.promptVersion,
          contextFileSha256: activityCopyReview.contextFileSha256,
          factsFileSha256: activityCopyReview.factsFileSha256,
          factsHash: activityCopyReview.factsHash,
          requestHash: activityCopyReview.requestHash ?? null,
          responseHash: activityCopyReview.responseHash ?? null,
        }
      : null,
    requests: requestManifest,
  });
  if (useDeepSeek || reusableAiRun) {
    await writePrivateJson(join(auditDirectory, "verified-mapping.json"), verified);
  }
  const review = {
    status: reusableAiRun
      ? "saved_ai_proposals_reverified"
      : useDeepSeek
        ? "ai_proposals_ready_for_review"
        : "ready_for_deepseek",
    practiceOnly: true,
    feishuCalls: 0,
    nativeOaCreated: false,
    deepSeekCalls,
    mappingConfirmationStatus: mappingConfirmation.status,
    selectedIdentifierDimension: mappingConfirmation.selectedIdentifierDimension,
    blacklistState: mappingConfirmation.blacklistState,
    activityCopy: activityCopyReview
      ? {
          status: activityCopyReview.status,
          promptVersion: activityCopyReview.promptVersion,
          factsHash: activityCopyReview.factsHash,
          proposalHash: activityCopyReview.validation?.proposalHash ?? null,
        }
      : null,
    reusedAiRun: reusableAiRun
      ? relative(caseDirectory, reusableAiRun.runPath)
      : null,
    sources: sourcesBefore,
    outputDirectory: relative(caseDirectory, outputDirectory),
    proposalSummary: verified.map((item) => ({
      fileName: item.fileName,
      sourceRole: item.validation.sourceRole,
      status: item.validation.status,
      fieldCandidateCount: item.validation.fieldCandidates.length,
      auxiliarySourceFieldCount: item.validation.auxiliarySourceFields.length,
      policyExcludedFieldCount: item.validation.policyExcludedFields.length,
      warningCount: item.validation.warnings.length,
      ambiguityCount: item.validation.ambiguities.length,
      issueCount: item.validation.issues.length,
    })),
  };
  await writePrivateJson(join(outputDirectory, "ai-recognition-run.json"), review);
  await writePrivate(
    join(outputDirectory, "ai-recognition-review.md"),
    `# DeepSeek 本地映射识别审查\n\n` +
      `- 状态：\`${review.status}\`\n` +
      `- 本次 DeepSeek 调用数：${deepSeekCalls}\n` +
      `- 飞书调用数：0\n` +
      `- 原生 OA 创建：否\n` +
      `- 模型：\`${model}\`\n` +
      `- 映射确认状态：\`${mappingConfirmation.status}\`（详见 \`mapping-confirmation.md\`）\n` +
      (activityCopyReview
        ? `- 活动文案 AI 事实提议：\`${activityCopyReview.status}\`（详见 \`ai-audit/activity-copy-review.json\`）\n`
        : "") +
      (review.reusedAiRun
        ? `- 复用的 AI 审计：\`${review.reusedAiRun}\`（仅在本地重新验证，未重发源表）\n`
        : `- 审计目录：\`ai-audit/\`（包含完整本地请求/响应，Git 已忽略）\n`) +
      `\nAI proposal 仅用于候选识别；必须经过本地规则验证和业务确认，不能直接提交 OA。\n`,
  );
  console.log(
    JSON.stringify(
      {
        status: review.status,
        outputDirectory,
        deepSeekCalls,
        feishuCalls: 0,
        nativeOaCreated: false,
        activityCopyStatus: activityCopyReview?.status ?? null,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`DeepSeek local recognition failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
