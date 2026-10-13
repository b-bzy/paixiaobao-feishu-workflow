#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, join, relative, resolve } from "node:path";
import ExcelJS from "exceljs";
import {
  buildActivityCopyFacts,
  buildActivityNarrativeCandidate,
  buildSecondRoundDialogue,
  formatSecondRoundDialogue,
  selectActivityNarrativeCandidate,
  validateActivityCopyContext,
} from "./lib/coupon-activity-copy.mjs";

const execFile = promisify(execFileCallback);
const runMode = "practice_final_non_submittable";
const sourceCouponFileName = "配券型号表9.30-10.10.xlsx";
const sourceWhitelistFileName = "商品明细白名单9.30-10.10.xlsx";
const outputWhitelistFileName = "商品明细白名单-四券档SKU-本地演练-r001.xlsx";
const outputCouponFileName = "配券信息表-本地演练-r001.xlsx";
const screenshotFileName = "已填充配券信息表截图-本地演练-r001.png";
const channelMap = new Map([
  ["京东商城", "京东渠道"],
  ["拍拍二手", "严选APP及小程序"],
]);

let networkCalls = 0;
globalThis.fetch = () => {
  networkCalls += 1;
  throw new Error("local case runner attempted a network request");
};

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function canonicalBusinessDate(value, label) {
  const candidate = String(value ?? "").normalize("NFKC").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    throw new Error(`${label}必须使用 YYYY-MM-DD 格式`);
  }
  const [year, month, day] = candidate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${label}不是有效日期`);
  }
  return candidate;
}

async function loadSecondRoundSimulation(input) {
  const inputPath = resolve(input.path);
  if (!pathInside(input.caseDirectory, inputPath)) {
    throw new Error("--second-round-input 必须位于当前 case 目录内");
  }
  const parsed = JSON.parse(await readFile(inputPath, "utf8"));
  if (parsed?.simulation !== true) {
    throw new Error("第二轮本地输入必须显式设置 simulation=true");
  }
  const businessModeCandidate = String(parsed.businessMode ?? "")
    .normalize("NFKC")
    .trim();
  const businessMode =
    businessModeCandidate.toLowerCase() === "pop"
      ? "pop"
      : businessModeCandidate;
  if (!["严选", "寄卖", "pop"].includes(businessMode)) {
    throw new Error("业务模式必须是严选、寄卖或 POP");
  }
  const activityName = String(parsed.activityName ?? "").trim();
  const activityBackground = String(parsed.activityBackground ?? "").trim();
  if (!activityName || activityName.length > 120) {
    throw new Error("活动名称必须为 1 至 120 个字符");
  }
  if (!activityBackground || activityBackground.length > 2_000) {
    throw new Error("活动背景必须为 1 至 2000 个字符");
  }
  const activityPointPercent = Number(
    String(parsed.activityPointPercent ?? "").replace(/%$/u, ""),
  );
  if (
    !Number.isFinite(activityPointPercent) ||
    activityPointPercent <= 0 ||
    activityPointPercent > 100
  ) {
    throw new Error("活动点位必须是大于 0 且不超过 100 的百分数");
  }
  const activityStartAt = canonicalBusinessDate(
    parsed.activityStartAt,
    "活动开始日期",
  );
  const activityEndAt = canonicalBusinessDate(
    parsed.activityEndAt,
    "活动结束日期",
  );
  if (activityEndAt < activityStartAt) {
    throw new Error("活动结束日期不能早于开始日期");
  }
  const overDeduction = String(parsed.overDeduction ?? "").trim();
  if (!["是", "否"].includes(overDeduction)) {
    throw new Error("是否超扣必须填写“是”或“否”");
  }
  const overDeductionReason = String(parsed.overDeductionReason ?? "").trim();
  if (overDeduction === "是" && !overDeductionReason) {
    throw new Error("选择超扣时必须填写超扣原因");
  }
  if (overDeductionReason.length > 4_000) {
    throw new Error("超扣原因不能超过 4000 个字符");
  }
  const metadata = await fileMetadata(inputPath);
  return {
    path: relative(input.caseDirectory, inputPath),
    sha256: metadata.sha256,
    values: {
      businessMode,
      activityName,
      activityBackground,
      activityPointPercent,
      activityStartAt,
      activityEndAt,
      overDeduction,
      overDeductionReason: overDeduction === "是" ? overDeductionReason : "",
      channelsConfirmed: parsed.channelsConfirmed === true,
    },
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function hashPrefix(value) {
  return value.slice(0, 8);
}

function markdown(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function safeCellText(cell) {
  if (cell.value === null || cell.value === undefined) return "";
  try {
    if (typeof cell.value === "object" && "richText" in cell.value) {
      return cell.value.richText.map((item) => item.text).join("").trim();
    }
    if (typeof cell.value === "object" && "result" in cell.value) {
      return String(cell.value.result ?? "").trim();
    }
    return String(cell.text || cell.value).trim();
  } catch {
    return "";
  }
}

function decimal(value, label) {
  const parsed = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`${label} 不是有效数值：${value}`);
  return parsed;
}

function nearlyEqual(left, right) {
  return Math.abs(left - right) <= Math.max(0.000001, Math.abs(right) * 0.000001);
}

function pathInside(parent, child) {
  const relation = relative(parent, child);
  return relation === "" || (!relation.startsWith("..") && !relation.includes("../"));
}

async function writePrivate(path, content) {
  await writeFile(path, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

async function writePrivateJson(path, value) {
  await writePrivate(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function fileMetadata(path) {
  const [bytes, details] = await Promise.all([readFile(path), stat(path)]);
  return {
    path,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    mtimeMs: details.mtimeMs,
    ino: details.ino,
  };
}

function sourceStateMatches(before, after) {
  return (
    before.bytes === after.bytes &&
    before.sha256 === after.sha256 &&
    before.mtimeMs === after.mtimeMs &&
    before.ino === after.ino
  );
}

async function loadAiMappingReview(input) {
  const reviewPath = resolve(input.path);
  if (!pathInside(input.caseDirectory, reviewPath)) {
    throw new Error("--ai-mapping-run 必须位于当前 case 目录内");
  }
  const review = JSON.parse(await readFile(reviewPath, "utf8"));
  if (
    review.status !== "saved_ai_proposals_reverified" ||
    review.mappingConfirmationStatus !== "ready_for_practice_generation"
  ) {
    throw new Error("AI 映射审查尚未完成本地重新验证或未达到可生成本地练习产物状态");
  }
  const confirmationPath = join(dirname(reviewPath), "ai-audit", "mapping-confirmation.json");
  const confirmation = JSON.parse(await readFile(confirmationPath, "utf8"));
  if (
    confirmation.status !== "ready_for_practice_generation" ||
    confirmation.selectedIdentifierDimension !== "SKU" ||
    confirmation.selectedIdentifierCoverage !== true ||
    confirmation.tierAlignmentPassed !== true ||
    confirmation.blacklistState !== "absent_confirmed"
  ) {
    throw new Error("AI 映射确认结果不符合本案已确认的 SKUID / 无黑名单决策");
  }
  const reviewedSources = Array.isArray(review.sources) ? review.sources : [];
  const expectedSources = [
    { fileName: sourceCouponFileName, metadata: input.sources.coupon },
    { fileName: sourceWhitelistFileName, metadata: input.sources.whitelist },
  ];
  for (const expected of expectedSources) {
    const reviewed = reviewedSources.find((item) => item?.fileName === expected.fileName);
    if (reviewed?.sha256 !== expected.metadata.sha256) {
      throw new Error(`AI 映射审查源文件哈希不匹配：${expected.fileName}`);
    }
  }
  const [reviewMetadata, confirmationMetadata] = await Promise.all([
    fileMetadata(reviewPath),
    fileMetadata(confirmationPath),
  ]);
  let activityCopy;
  if (review.activityCopy) {
    const activityCopyReviewPath = join(dirname(reviewPath), "ai-audit", "activity-copy-review.json");
    const activityCopyReview = JSON.parse(await readFile(activityCopyReviewPath, "utf8"));
    if (
      activityCopyReview.factsHash !== review.activityCopy.factsHash ||
      activityCopyReview.validation?.proposalHash !== review.activityCopy.proposalHash
    ) {
      throw new Error("AI 映射审查中的活动文案事实或 proposal hash 不一致");
    }
    activityCopy = {
      status: activityCopyReview.status,
      reviewPath: relative(input.caseDirectory, activityCopyReviewPath),
      factsHash: activityCopyReview.factsHash,
      proposalHash: activityCopyReview.validation?.proposalHash ?? null,
      model: activityCopyReview.model ?? null,
      modelAliasCandidateCount: activityCopyReview.validation?.modelAliasCandidates?.length ?? 0,
      productLabelCandidateCount: activityCopyReview.validation?.productLabelCandidates?.length ?? 0,
      warningCount: activityCopyReview.validation?.warnings?.length ?? 0,
      ambiguityCount: activityCopyReview.validation?.ambiguities?.length ?? 0,
      issueCount: activityCopyReview.validation?.issues?.length ?? 0,
    };
  }
  return {
    status: "locally_reverified",
    runPath: relative(input.caseDirectory, reviewPath),
    runSha256: reviewMetadata.sha256,
    confirmationPath: relative(input.caseDirectory, confirmationPath),
    confirmationSha256: confirmationMetadata.sha256,
    selectedIdentifierDimension: confirmation.selectedIdentifierDimension,
    blacklistState: confirmation.blacklistState,
    tierAlignmentPassed: confirmation.tierAlignmentPassed === true,
    activityCopy,
  };
}

async function loadActivityCopyContext(input) {
  const contextPath = resolve(input.path);
  if (!pathInside(input.caseDirectory, contextPath)) {
    throw new Error("--activity-copy-context 必须位于当前 case 目录内");
  }
  const [content, metadata] = await Promise.all([
    readFile(contextPath, "utf8"),
    fileMetadata(contextPath),
  ]);
  return {
    context: validateActivityCopyContext(JSON.parse(content)),
    path: relative(input.caseDirectory, contextPath),
    sha256: metadata.sha256,
  };
}

function headersFor(worksheet) {
  return Array.from({ length: worksheet.columnCount }, (_, index) =>
    safeCellText(worksheet.getRow(1).getCell(index + 1)),
  );
}

function cellFor(row, headerIndex, header) {
  const column = headerIndex.get(header);
  if (!column) throw new Error(`配券表缺少列：${header}`);
  return row.getCell(column);
}

function couponDataRows(worksheet, headerIndex) {
  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const channel = safeCellText(cellFor(row, headerIndex, "用券渠道"));
    const couponName = safeCellText(cellFor(row, headerIndex, "优惠券名称"));
    if (!channel && !couponName) continue;
    if (!couponName) continue;
    if (!channel) {
      throw new Error(`配券表第 ${rowNumber} 行缺少用券渠道`);
    }
    rows.push({ rowNumber, row, channel, couponName });
  }
  return rows;
}

function couponRecord(entry, headerIndex) {
  const text = (header) => safeCellText(cellFor(entry.row, headerIndex, header));
  const number = (header) => decimal(text(header), `配券表 ${header}`);
  const totalQuantity = number("总申请数量");
  const grantQuantityPerClaim = number("单次发放到账张数");
  const dailyClaimLimit = number("每日领取次数");
  const discountAmountYuan = number("面额");
  const thresholdYuan = number("限额");
  const expectedClaimRate = number("预计领用率");
  const expectedUseRate = number("预计使用率");
  const platformBearingRatio = number("拍拍平台承担比例");
  const estimatedRoi = number("预估ROI");
  const estimatedCostYuan = number("预计费用");
  const estimatedGmvYuan = number("预计引入GMV");
  const expectedTotalQuantity = grantQuantityPerClaim * dailyClaimLimit * 3;
  const expectedCostYuan =
    totalQuantity *
    discountAmountYuan *
    expectedClaimRate *
    expectedUseRate *
    platformBearingRatio;
  const expectedGmvYuan = estimatedCostYuan * estimatedRoi;
  const checks = {
    totalQuantity: nearlyEqual(totalQuantity, expectedTotalQuantity),
    estimatedCostYuan: nearlyEqual(estimatedCostYuan, expectedCostYuan),
    estimatedGmvYuan: nearlyEqual(estimatedGmvYuan, expectedGmvYuan),
  };
  if (!Object.values(checks).every(Boolean)) {
    throw new Error(`配券表第 ${entry.rowNumber} 行的公式缓存值与本案源表公式不一致`);
  }
  return {
    sourceRow: entry.rowNumber,
    channel: entry.channel,
    oaChannel: channelMap.get(entry.channel) ?? "待确认",
    couponName: entry.couponName,
    activityName: text("活动名称"),
    applicantName: text("申请人"),
    claimWindow: text("可领时间"),
    useWindow: text("可用时间"),
    totalQuantity,
    grantQuantityPerClaim,
    dailyClaimLimit,
    discountAmountYuan,
    thresholdYuan,
    discountRatio: number("优惠比例"),
    expectedClaimRate,
    expectedUseRate,
    platformBearingRatio,
    estimatedRoi,
    estimatedCostYuan,
    estimatedGmvYuan,
    couponType: text("优惠券类型"),
    productLimitType: text("限品类型"),
    claimRiskControl: text("领券用户风控"),
    claimRule: text("用户领券规则"),
    allowGift: text("优惠券赠送"),
    promotionMode: text("推广途径"),
    publicPromotionChannels: text("公开推广渠道"),
    formulaChecks: checks,
  };
}

function uniqueBy(values, selector) {
  return [...new Map(values.map((value) => [selector(value), value])).values()];
}

async function inspectCoupon(path) {
  const bytes = await readFile(path);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  if (workbook.worksheets.length !== 1) {
    throw new Error("本地练习仅支持单 Sheet 配券表");
  }
  const worksheet = workbook.worksheets[0];
  const headers = headersFor(worksheet);
  const headerIndex = new Map(headers.map((header, index) => [header, index + 1]));
  const requiredHeaders = [
    "用券渠道",
    "申请人",
    "可领时间",
    "可用时间",
    "优惠券名称",
    "活动名称",
    "总申请数量",
    "单次发放到账张数",
    "每日领取次数",
    "面额",
    "限额",
    "优惠比例",
    "预计领用率",
    "预计使用率",
    "拍拍平台承担比例",
    "预估ROI",
    "预计费用",
    "预计引入GMV",
    "优惠券类型",
    "限品类型",
    "领券用户风控",
    "用户领券规则",
    "优惠券赠送",
    "推广途径",
    "公开推广渠道",
  ];
  for (const header of requiredHeaders) {
    if (!headerIndex.has(header)) throw new Error(`配券表缺少必需列：${header}`);
  }
  const sourceRows = couponDataRows(worksheet, headerIndex);
  const records = sourceRows.map((entry) => couponRecord(entry, headerIndex));
  const channels = uniqueBy(records, (record) => record.channel);
  const couponTierRecords = uniqueBy(records, (record) => record.couponName);
  const couponTiers = couponTierRecords.map((record) => record.couponName);
  if (channels.length !== 2 || couponTiers.length !== 4 || records.length !== 8) {
    throw new Error("本地练习预期为四券档、双渠道、八条配券记录");
  }
  for (const record of records) {
    if (!channelMap.has(record.channel)) {
      throw new Error(`未登记的用券渠道：${record.channel}`);
    }
  }
  const firstChannelRecords = couponTiers.map((tier) =>
    records.find((record) => record.couponName === tier),
  );
  if (firstChannelRecords.some((record) => !record)) {
    throw new Error("无法找到每个券档的基准渠道记录");
  }
  const aggregate = firstChannelRecords.reduce(
    (total, record) => ({
      estimatedCostYuan: total.estimatedCostYuan + record.estimatedCostYuan,
      estimatedGmvYuan: total.estimatedGmvYuan + record.estimatedGmvYuan,
    }),
    { estimatedCostYuan: 0, estimatedGmvYuan: 0 },
  );
  aggregate.estimatedRoi = aggregate.estimatedGmvYuan / aggregate.estimatedCostYuan;
  const activityNames = uniqueBy(records, (record) => record.activityName).map(
    (record) => record.activityName,
  );
  const applicants = uniqueBy(records, (record) => record.applicantName).map(
    (record) => record.applicantName,
  );
  const platformShares = [...new Set(records.map((record) => record.platformBearingRatio))];
  const sourceMaxRow = Math.max(
    ...Array.from({ length: worksheet.rowCount }, (_, index) => index + 1).filter(
      (rowNumber) => {
        const row = worksheet.getRow(rowNumber);
        return Array.from({ length: worksheet.columnCount }, (_, offset) =>
          safeCellText(row.getCell(offset + 1)),
        ).some(Boolean);
      },
    ),
  );
  return {
    bytes,
    workbook,
    worksheet,
    records,
    couponTiers,
    sourceMaxRow,
    aggregate,
    activityNames,
    applicants,
    platformShares,
    channelLabels: channels.map((record) => ({
      source: record.channel,
      oa: record.oaChannel,
    })),
  };
}

function skuText(cell, sheetName, rowNumber) {
  if (cell.value === null || cell.value === undefined || !safeCellText(cell)) {
    return undefined;
  }
  if (cell.type === ExcelJS.ValueType.Formula) {
    throw new Error(`${sheetName}!A${rowNumber} 不能以公式作为 SKU`);
  }
  const value = safeCellText(cell);
  if (!/^\d+$/.test(value)) {
    throw new Error(`${sheetName}!A${rowNumber} 不是纯数字 SKU`);
  }
  if (!Number.isSafeInteger(Number(value))) {
    throw new Error(`${sheetName}!A${rowNumber} 超过安全整数范围`);
  }
  return value;
}

async function inspectWhitelist(path) {
  const bytes = await readFile(path);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  if (workbook.worksheets.length !== 4) {
    throw new Error("本地练习预期白名单包含四个券档 Sheet");
  }
  const tiers = [];
  const globalTiers = new Map();
  for (const worksheet of workbook.worksheets) {
    if (safeCellText(worksheet.getCell("A1")).toUpperCase() !== "SKUID") {
      throw new Error(`${worksheet.name} 的 A1 必须为 SKUID`);
    }
    const headers = headersFor(worksheet);
    const headerIndex = new Map(headers.map((header, index) => [header, index + 1]));
    const modelColumn = headerIndex.get("型号");
    const categoryHeader = headers.find((header) => header.includes("商品类别"));
    const categoryColumn = categoryHeader ? headerIndex.get(categoryHeader) : undefined;
    const seen = new Set();
    const skus = [];
    const modelEvidence = new Map();
    const categoryEvidence = new Map();
    let duplicateCount = 0;
    let numericSourceCount = 0;
    let incompleteRowCount = 0;
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const cell = row.getCell(1);
      const sku = skuText(cell, worksheet.name, rowNumber);
      if (!sku) continue;
      if (typeof cell.value === "number") numericSourceCount += 1;
      const model = modelColumn ? safeCellText(row.getCell(modelColumn)) : "";
      const category = categoryColumn ? safeCellText(row.getCell(categoryColumn)) : "";
      if (modelColumn && !model) incompleteRowCount += 1;
      if (model && !modelEvidence.has(model)) {
        modelEvidence.set(model, `${worksheet.name}!${row.getCell(modelColumn).address}`);
      }
      if (category && !categoryEvidence.has(category)) {
        categoryEvidence.set(category, `${worksheet.name}!${row.getCell(categoryColumn).address}`);
      }
      if (seen.has(sku)) {
        duplicateCount += 1;
        continue;
      }
      seen.add(sku);
      skus.push(sku);
      globalTiers.set(sku, [...(globalTiers.get(sku) ?? []), worksheet.name]);
    }
    tiers.push({
      name: worksheet.name,
      skus,
      sourceRowCount: worksheet.rowCount - 1,
      duplicateCount,
      numericSourceCount,
      modelHeader: modelColumn ? "型号" : null,
      modelColumn: modelColumn ? worksheet.getColumn(modelColumn).letter : null,
      models: [...modelEvidence.keys()],
      modelEvidence: [...modelEvidence.entries()].map(([value, cell]) => ({ value, cell })),
      categoryHeader: categoryHeader ?? null,
      categoryColumn: categoryColumn ? worksheet.getColumn(categoryColumn).letter : null,
      categories: [...categoryEvidence.keys()],
      categoryEvidence: [...categoryEvidence.entries()].map(([value, cell]) => ({ value, cell })),
      incompleteRowCount,
    });
  }
  const crossTierDuplicates = [...globalTiers.values()].filter(
    (tierNames) => new Set(tierNames).size > 1,
  ).length;
  return {
    bytes,
    tiers,
    crossTierDuplicates,
    totalUniqueWithinTiers: tiers.reduce((total, tier) => total + tier.skus.length, 0),
    globalUniqueSkuCount: globalTiers.size,
  };
}

function normalizeTierKey(value) {
  return String(value ?? "").replace(/\s/g, "").replace(/^满/, "");
}

function assertConfiguredTierSubset(coupon, whitelist) {
  const configuredTiers = [...new Set(coupon.couponTiers)];
  const whitelistTiers = whitelist.tiers.map((tier) => tier.name);
  const whitelistTierKeys = new Set(whitelistTiers.map(normalizeTierKey));
  const configuredTierKeys = new Set(configuredTiers.map(normalizeTierKey));
  const missingWhitelistTiers = configuredTiers.filter(
    (tier) => !whitelistTierKeys.has(normalizeTierKey(tier)),
  );
  const unexpectedWhitelistTiers = whitelistTiers.filter(
    (tier) => !configuredTierKeys.has(normalizeTierKey(tier)),
  );
  if (missingWhitelistTiers.length || unexpectedWhitelistTiers.length) {
    throw new Error(
      `本地白名单券档与配券表未能一一映射：缺少 ${missingWhitelistTiers.join("、") || "无"}；额外 ${unexpectedWhitelistTiers.join("、") || "无"}`,
    );
  }
  return {
    configuredTiers,
    whitelistTiers,
    unconfiguredTiers: [],
  };
}

async function writeFourTierWhitelist(path, tiers) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "aihuishou-feishu-workflow local practice runner";
  workbook.created = new Date();
  for (const tier of tiers) {
    const worksheet = workbook.addWorksheet(tier.name);
    worksheet.getCell("A1").value = "sku";
    worksheet.getCell("A1").font = { bold: true };
    worksheet.getColumn(1).width = 24;
    for (const [index, sku] of tier.skus.entries()) {
      const cell = worksheet.getRow(index + 2).getCell(1);
      cell.value = sku;
      cell.numFmt = "@";
    }
    worksheet.autoFilter = `A1:A${tier.skus.length + 1}`;
  }
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  const verified = new ExcelJS.Workbook();
  await verified.xlsx.load(bytes);
  if (verified.worksheets.length !== tiers.length) {
    throw new Error("生成的四券档白名单 Sheet 数不一致");
  }
  for (const tier of tiers) {
    const worksheet = verified.getWorksheet(tier.name);
    if (!worksheet || safeCellText(worksheet.getCell("A1")) !== "sku") {
      throw new Error(`生成的白名单缺少或错误的券档：${tier.name}`);
    }
    const output = Array.from({ length: tier.skus.length }, (_, index) => {
      const cell = worksheet.getRow(index + 2).getCell(1);
      if (cell.numFmt !== "@") throw new Error(`${tier.name} 的 SKU 未使用文本格式`);
      return safeCellText(cell);
    });
    if (JSON.stringify(output) !== JSON.stringify(tier.skus)) {
      throw new Error(`${tier.name} 的去重 SKU 输出不一致`);
    }
  }
  return {
    bytes,
    sha256: sha256(bytes),
    rowCount: tiers.reduce((total, tier) => total + tier.skus.length, 0),
  };
}

function safeText(value) {
  const text = String(value ?? "").trim();
  return /^[=+@-]/.test(text) ? `'${text}` : text;
}

function copyBlueprintRow(worksheet, sourceRowNumber, targetRowNumber) {
  const sourceRow = worksheet.getRow(sourceRowNumber);
  const targetRow = worksheet.getRow(targetRowNumber);
  targetRow.height = sourceRow.height;
  for (let column = 1; column <= sourceRow.cellCount; column += 1) {
    const sourceCell = sourceRow.getCell(column);
    const targetCell = targetRow.getCell(column);
    targetCell.style = structuredClone(sourceCell.style);
    targetCell.dataValidation = structuredClone(sourceCell.dataValidation);
    targetCell.protection = structuredClone(sourceCell.protection);
  }
}

function setFormula(cell, formula, result) {
  cell.value = { formula, result };
}

async function writeMappedCouponWorkbook(path, coupon) {
  const templatePath = join(
    process.cwd(),
    "docs/oa-ticket-reimbursement-materials/reference/templates/配券信息表-常规满减券.xlsx",
  );
  const templateBytes = await readFile(templatePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBytes);
  const worksheet = workbook.getWorksheet("满减券");
  if (!worksheet) throw new Error("登记的常规满减券模板缺少“满减券”Sheet");
  if (safeCellText(worksheet.getCell("F1")) !== "用券渠道") {
    throw new Error("登记的常规满减券模板表头不匹配");
  }
  worksheet.spliceRows(3, 3);
  for (let index = 1; index < coupon.records.length; index += 1) {
    const targetRowNumber = index + 2;
    worksheet.insertRow(targetRowNumber, []);
    copyBlueprintRow(worksheet, 2, targetRowNumber);
  }
  for (const [index, record] of coupon.records.entries()) {
    const rowNumber = index + 2;
    const row = worksheet.getRow(rowNumber);
    for (const column of ["A", "B", "C", "D", "E"]) {
      row.getCell(column).value = null;
    }
    row.getCell("F").value = safeText(record.channel);
    row.getCell("G").value = safeText(record.applicantName);
    row.getCell("H").value = safeText(record.claimWindow);
    row.getCell("I").value = safeText(record.useWindow);
    row.getCell("K").value = safeText(record.activityName);
    row.getCell("L").value = record.totalQuantity;
    row.getCell("M").value = record.grantQuantityPerClaim;
    row.getCell("N").value = record.dailyClaimLimit;
    row.getCell("O").value = record.discountAmountYuan;
    row.getCell("P").value = record.thresholdYuan;
    row.getCell("R").value = record.expectedClaimRate;
    row.getCell("S").value = record.expectedUseRate;
    row.getCell("T").value = record.platformBearingRatio;
    row.getCell("W").value = record.estimatedGmvYuan;
    row.getCell("X").value = safeText(record.couponType);
    row.getCell("Y").value = safeText(record.productLimitType);
    row.getCell("Z").value = safeText(record.claimRiskControl);
    row.getCell("AA").value = safeText(record.claimRule);
    row.getCell("AB").value = safeText(record.allowGift);
    row.getCell("AC").value = safeText(record.promotionMode);
    row.getCell("AD").value = safeText(record.publicPromotionChannels);
    setFormula(row.getCell("J"), `"满"&P${rowNumber}&"减"&O${rowNumber}`, record.couponName);
    setFormula(row.getCell("Q"), `O${rowNumber}/P${rowNumber}`, record.discountRatio);
    setFormula(
      row.getCell("V"),
      `L${rowNumber}*O${rowNumber}*R${rowNumber}*S${rowNumber}*T${rowNumber}`,
      record.estimatedCostYuan,
    );
    setFormula(row.getCell("U"), `W${rowNumber}/V${rowNumber}`, record.estimatedRoi);
    row.commit();
  }
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });

  const verified = new ExcelJS.Workbook();
  await verified.xlsx.load(bytes);
  const verifiedSheet = verified.getWorksheet("满减券");
  if (!verifiedSheet) throw new Error("重新打开后缺少“满减券”Sheet");
  for (const [index, record] of coupon.records.entries()) {
    const rowNumber = index + 2;
    const row = verifiedSheet.getRow(rowNumber);
    for (const column of ["A", "B", "C", "D", "E"]) {
      if (row.getCell(column).value !== null) {
        throw new Error(`映射配券表 ${column}${rowNumber} 必须保持空白`);
      }
    }
    const formulas = {
      J: `"满"&P${rowNumber}&"减"&O${rowNumber}`,
      Q: `O${rowNumber}/P${rowNumber}`,
      V: `L${rowNumber}*O${rowNumber}*R${rowNumber}*S${rowNumber}*T${rowNumber}`,
      U: `W${rowNumber}/V${rowNumber}`,
    };
    for (const [column, expectedFormula] of Object.entries(formulas)) {
      const value = row.getCell(column).value;
      if (!value || typeof value !== "object" || value.formula !== expectedFormula) {
        throw new Error(`映射配券表 ${column}${rowNumber} 公式不匹配`);
      }
    }
    const expectedValues = {
      F: record.channel,
      G: record.applicantName,
      H: record.claimWindow,
      I: record.useWindow,
      K: record.activityName,
      L: record.totalQuantity,
      M: record.grantQuantityPerClaim,
      N: record.dailyClaimLimit,
      O: record.discountAmountYuan,
      P: record.thresholdYuan,
      R: record.expectedClaimRate,
      S: record.expectedUseRate,
      T: record.platformBearingRatio,
      W: record.estimatedGmvYuan,
      X: record.couponType,
      Y: record.productLimitType,
      Z: record.claimRiskControl,
      AA: record.claimRule,
      AB: record.allowGift,
      AC: record.promotionMode,
      AD: record.publicPromotionChannels,
    };
    for (const [column, expectedValue] of Object.entries(expectedValues)) {
      const actualValue = safeCellText(row.getCell(column));
      if (
        (typeof expectedValue === "number" && !nearlyEqual(Number(actualValue), expectedValue)) ||
        (typeof expectedValue === "string" && actualValue !== expectedValue)
      ) {
        throw new Error(`映射配券表 ${column}${rowNumber} 字段回填不一致`);
      }
    }
  }
  return {
    templateId: "coupon-table-regular-full-reduction-v1",
    templateVersion: "v1",
    generatorRuleVersion: "coupon-three-source-local-case-v1.1",
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
    rowCount: coupon.records.length,
    formulaPolicy: "case-source-cost-formula-includes-expected-claim-rate",
  };
}

async function cropPngToContent(path) {
  const cropScript = String.raw`
import json
import sys
from PIL import Image

path = sys.argv[1]
image = Image.open(path).convert("RGB")
gray = image.convert("L")
mask = gray.point(lambda pixel: 255 if pixel < 245 else 0)
bbox = mask.getbbox()
if bbox is None:
    raise RuntimeError("rendered PNG contains no visible table content")
left, top, right, bottom = bbox
padding = 24
left = max(0, left - padding)
top = max(0, top - padding)
right = min(image.width, right + padding)
bottom = min(image.height, bottom + padding)
cropped = image.crop((left, top, right, bottom))
if cropped.width < 100 or cropped.height < 100:
    raise RuntimeError("cropped PNG is too small to be a complete coupon-table image")
cropped.save(path, "PNG")
print(json.dumps({"width": cropped.width, "height": cropped.height, "bbox": [left, top, right, bottom]}))
`;
  const { stdout } = await execFile("python3", ["-c", cropScript, path]);
  return JSON.parse(stdout.trim());
}

async function renderCouponTable(input) {
  const { couponArtifact, renderDirectory, attachmentsDirectory } = input;
  const renderWorkbookPath = join(renderDirectory, "已填充配券信息表-本地演练.xlsx");
  const pdfPath = join(renderDirectory, "已填充配券信息表-本地演练.pdf");
  const outputPngPath = join(attachmentsDirectory, screenshotFileName);
  const profileDirectory = join(renderDirectory, "lo-profile");
  const sourceArtifactBytes = await readFile(couponArtifact.path);
  const sourceArtifactSha256 = sha256(sourceArtifactBytes);
  if (sourceArtifactSha256 !== couponArtifact.sha256) {
    throw new Error("已填充标准配券表 hash 与已验证产物不一致");
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(sourceArtifactBytes);
  const worksheet = workbook.getWorksheet("满减券");
  if (!worksheet) throw new Error("已填充标准配券表缺少“满减券”Sheet");
  const lastDataRow = couponArtifact.rowCount + 1;
  if (worksheet.rowCount < lastDataRow) {
    throw new Error("已填充标准配券表的配置行不足，拒绝生成截图");
  }
  worksheet.pageSetup = {
    ...worksheet.pageSetup,
    orientation: "landscape",
    paperSize: 8,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    horizontalCentered: true,
    verticalCentered: false,
    margins: {
      left: 0.1,
      right: 0.1,
      top: 0.25,
      bottom: 0.25,
      header: 0.1,
      footer: 0.1,
    },
  };
  const renderedRange = `${worksheet.name}!A1:AD${lastDataRow}`;
  worksheet.pageSetup.printArea = `A1:AD${lastDataRow}`;
  const renderBytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  await writeFile(renderWorkbookPath, renderBytes, { flag: "wx", mode: 0o600 });
  await mkdir(profileDirectory, { mode: 0o700 });
  await execFile("soffice", [
    "--headless",
    `-env:UserInstallation=file://${profileDirectory}`,
    "--convert-to",
    "pdf",
    "--outdir",
    renderDirectory,
    renderWorkbookPath,
  ]);
  const { stdout: pdfInfo } = await execFile("pdfinfo", [pdfPath]);
  const pages = Number(pdfInfo.match(/^Pages:\s+(\d+)$/m)?.[1]);
  if (pages !== 1) {
    throw new Error(`已填充标准配券表截图渲染为 ${pages || "未知"} 页，拒绝生成不完整截图`);
  }
  const imagePrefix = join(attachmentsDirectory, "filled-coupon-workbook");
  await execFile("pdftoppm", ["-png", "-r", "300", pdfPath, imagePrefix]);
  await rename(`${imagePrefix}-1.png`, outputPngPath);
  const imageDimensions = await cropPngToContent(outputPngPath);
  const outputBytes = await readFile(outputPngPath);
  if (!outputBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("已填充标准配券表截图不是有效 PNG");
  }
  return {
    path: outputPngPath,
    sha256: sha256(outputBytes),
    bytes: outputBytes.byteLength,
    pageCount: pages,
    imageDimensions,
    renderedSheet: worksheet.name,
    renderedRange,
    sourceArtifactPath: couponArtifact.path,
    sourceArtifactSha256,
    sourceArtifactTemplateId: couponArtifact.templateId,
    sourceArtifactTemplateVersion: couponArtifact.templateVersion,
    sourceArtifactGeneratorRuleVersion: couponArtifact.generatorRuleVersion,
    sourceFormulaNote: "由同一 revision 的已验证标准配券信息表完整渲染；不读取或替代原始源表。",
  };
}

function draftMarkdown(input) {
  const {
    caseRelativeOutput,
    coupon,
    whitelist,
    couponArtifact,
    whitelistArtifact,
    screenshot,
    sources,
    aiMappingReview,
    activityCopy,
    secondRoundDialogue,
    secondRoundSimulation,
  } = input;
  const rows = coupon.records
    .map(
      (record) =>
        `| ${record.sourceRow} | ${markdown(record.couponName)} | ${markdown(record.channel)} | ${record.thresholdYuan} | ${record.discountAmountYuan} | ${record.totalQuantity} | ${record.estimatedCostYuan} | ${record.estimatedGmvYuan} | ${record.estimatedRoi} |`,
    )
    .join("\n");
  const whitelistRows = whitelist.tiers
    .map(
      (tier) =>
        `| ${markdown(tier.name)} | ${tier.sourceRowCount} | ${tier.skus.length} | ${tier.duplicateCount} | ${tier.numericSourceCount} |`,
    )
    .join("\n");
  const generatedNarrative = activityCopy?.candidate?.generatedCandidate;
  const selectedNarrative = activityCopy?.selection;
  const simulatedValues = secondRoundSimulation?.values;
  const activityNameValue = simulatedValues?.activityName
    ? simulatedValues.activityName
    : selectedNarrative?.activityName
    ? selectedNarrative.activityName
    : generatedNarrative?.activityName
      ? `候选：${generatedNarrative.activityName}`
      : coupon.activityNames.join("、") || "待补充";
  const activityNameStatus = simulatedValues?.activityName
    ? "第二轮本地模拟输入已通过确定性校验"
    : selectedNarrative
    ? `已通过候选 hash 本地确认：${selectedNarrative.candidateHash}`
    : generatedNarrative
      ? `生成候选状态：${generatedNarrative.status}；配券表 K 列原值：${coupon.activityNames.join("、") || "无"}`
      : "配券表 K 列候选；需业务确认";
  const activityBackgroundValue = simulatedValues?.activityBackground
    ? simulatedValues.activityBackground
    : selectedNarrative?.activityBackground
    ? selectedNarrative.activityBackground
    : generatedNarrative?.activityBackground
      ? `候选：${generatedNarrative.activityBackground}`
      : "待补充";
  const activityBackgroundStatus = simulatedValues?.activityBackground
    ? "第二轮本地模拟输入已通过确定性校验；仍不可提交 OA"
    : selectedNarrative
    ? "已通过候选 hash 本地确认；仍不可提交 OA"
    : generatedNarrative
      ? generatedNarrative.blockers.length
        ? `已写入待审核草稿；以下差异需业务审核：${generatedNarrative.blockers.join("；")}`
        : "已生成待确认候选；需传入 --confirm-activity-copy <candidateHash> 才能选择"
      : "源表未提供，阻断正式提交";
  const activityCopyIssues = simulatedValues?.activityBackground
    ? []
    : selectedNarrative
    ? []
    : generatedNarrative?.blockers?.length
      ? generatedNarrative.blockers.map((blocker) => `活动文案候选：${blocker}`)
      : generatedNarrative
        ? ["活动文案候选已生成，仍需显式确认候选 hash"]
        : ["活动背景未提供"];
  const noticeMarkdown = [
    ...(generatedNarrative?.notices ?? []).map((notice) => `- ${notice.message}`),
    ...(simulatedValues
      ? [
          `- 第二轮字段来自本地模拟输入 \`${secondRoundSimulation.path}\`，不代表真实业务确认。`,
        ]
      : [
          "- 是否超扣点当前默认“否”，将在最终统一确认时一并确认；如改为“是”，必须填写原因。",
        ]),
    "- 本期按配券表与白名单已一一映射的四个券档生成；未配置其他券档不构成模板差异。",
  ].join("\n");
  const blockerItems = simulatedValues
    ? simulatedValues.channelsConfirmed
      ? []
      : ["配置渠道映射尚未由业务确认。"]
    : [
        "业务模式、带年份的活动日期尚未提供。",
        ...activityCopyIssues,
        "活动点位不能从同时存在的 1% 与 2% 券档中自动选择。",
        "渠道文案映射和最终申请人仍需业务/流程确认。",
      ];
  const blockerMarkdown = blockerItems.length
    ? blockerItems
    .map((issue, index) => `${index + 1}. ${issue}`)
        .join("\n")
    : "无第二轮待补充项。申请人和部门仍只会在飞书最终确认时按当前身份解析。";
  return `# 优惠券 OA 填单底稿（本地练习）\n\n` +
    `> **状态：${runMode}**  \n` +
    `> 本文件只在本机生成；未调用飞书、未上传文件、未创建原生 OA，不能作为正式提交材料。\n\n` +
    `## 运行与来源\n\n` +
    `- 本地输出：\`${caseRelativeOutput}\`\n` +
    `- 配券表：\`${basename(sources.coupon.path)}\`（SHA-256：\`${sources.coupon.sha256}\`）\n` +
    `- 白名单：\`${basename(sources.whitelist.path)}\`（SHA-256：\`${sources.whitelist.sha256}\`）\n` +
    `- 黑名单：**本次无黑名单（用户已确认）**；未生成空黑名单附件。\n` +
    (aiMappingReview
      ? `- AI 映射审查：\`${markdown(aiMappingReview.runPath)}\`（本地重新验证通过；SHA-256：\`${aiMappingReview.runSha256}\`）\n`
      : "- AI 映射审查：未绑定本次练习输出。\n") +
    (aiMappingReview?.activityCopy
      ? `- AI 活动文案事实提议：\`${aiMappingReview.activityCopy.status}\`，型号别名候选 ${aiMappingReview.activityCopy.modelAliasCandidateCount} 个（\`${markdown(aiMappingReview.activityCopy.reviewPath)}\`）\n`
      : "") +
    `\n## OA 预填草稿\n\n` +
    `| OA 字段 | 本地映射值 | 映射来源 / 状态 |\n| --- | --- | --- |\n` +
    `| 申请类型 | 优惠券申请 | 固定值 |\n` +
    `| 部门 | 最终确认时自动带出 | 最终确认人的飞书主部门；无法唯一确定时阻断并要求确认 |\n` +
    `| 申请人 | 最终确认时自动带出 | 最终确认人的飞书身份；配券表人名不能作为 OA 联系人 |\n` +
    `| 业务模式 | ${markdown(simulatedValues?.businessMode ?? "待补充")} | ${simulatedValues ? "第二轮本地模拟输入已校验" : "源表未提供，阻断正式提交"} |\n` +
    `| 活动名称 | ${markdown(activityNameValue)} | ${markdown(activityNameStatus)} |\n` +
    `| 活动背景 | ${markdown(activityBackgroundValue)} | ${markdown(activityBackgroundStatus)} |\n` +
    `| 活动点位(%) | ${simulatedValues ? simulatedValues.activityPointPercent : "待补充"} | ${simulatedValues ? "第二轮本地模拟输入已校验" : "四券档含 1% 与 2%，不可自动合并为单值"} |\n` +
    `| 平台承担比例(%) | ${coupon.platformShares.map((value) => value * 100).join("、")}% | 配券表 T 列，八条记录一致 |\n` +
    `| 是否超扣点 / 原因 | ${simulatedValues ? `${simulatedValues.overDeduction}${simulatedValues.overDeductionReason ? `：${simulatedValues.overDeductionReason}` : ""}` : "否（默认）"} | ${simulatedValues ? "第二轮本地模拟输入已校验" : "工作流默认值；将在最终统一确认时一并确认，选择“是”时原因必填"} |\n` +
    `| 预估费用 | ${coupon.aggregate.estimatedCostYuan} 元 | 按四个券档单次汇总；使用源表公式 |\n` +
    `| 预估 GMV | ${coupon.aggregate.estimatedGmvYuan} 元 | 按四个券档单次汇总；使用源表公式 |\n` +
    `| ROI | ${coupon.aggregate.estimatedRoi} | 同一汇总口径重新计算 |\n` +
    `| 配置渠道 | ${coupon.channelLabels.map((item) => `${item.source} → ${item.oa}`).join("；")} | 本地映射候选，待业务确认 |\n` +
    `| 活动开始 / 结束日期 | ${simulatedValues ? `${simulatedValues.activityStartAt} 至 ${simulatedValues.activityEndAt}` : "待补充"} | ${simulatedValues ? "第二轮本地模拟输入已校验" : "配券表仅有无年份的可领/可用时间文本；请参照配券节奏表人工确认"} |\n` +
    `| 活动 ID / 批次 ID / putKey / PC/M 链接 | 保持空白 | 按已确认规则不追问、不生成 |\n\n` +
    `## 配券表映射明细\n\n` +
    `| 源行 | 券名称 | 源渠道 | 门槛 | 面额 | 总申请数量 | 预计费用 | 预计 GMV | ROI |\n| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows}\n\n` +
    `**本案费用公式：** \`总申请数量 × 面额 × 预计领用率 × 预计使用率 × 平台承担比例\`。  \n` +
    `源表“总申请数量”还使用 \`单次到账张数 × 每日领取次数 × 3\`；乘数 3 仅作为本案源表规则记录，未推广为通用规则。\n\n` +
    `## 本地附件计划\n\n` +
    `| 角色 | 本地文件 | SHA-256 | 说明 |\n| --- | --- | --- | --- |\n` +
    `| 配券信息表 | \`standard-artifacts/${outputCouponFileName}\` | \`${couponArtifact.sha256}\` | 基于登记的常规满减券模板重新填充；A-E 回填字段为空；含 8 条配置 |\n` +
    `| 商品明细白名单 | \`standard-artifacts/${outputWhitelistFileName}\` | \`${whitelistArtifact.sha256}\` | 本案四个已映射券档、本券档内去重、SKU 文本格式；未配置其他券档不构成模板差异 |\n` +
    `| 商品明细黑名单 | 无 | — | 本次无黑名单，不创建空附件 |\n` +
    `| 具体满减测算图片 | \`attachments/${screenshotFileName}\` | \`${screenshot.sha256}\` | 从同一 revision 的已填充标准配券表渲染；源配券表 SHA-256：\`${screenshot.sourceArtifactSha256}\` |\n\n` +
    `## 白名单处理结果\n\n` +
    `| 源券档 | 源数据行数 | 本券档去重后 SKU 数 | 本券档移除重复数 | 数值格式 SKU 数 |\n| --- | ---: | ---: | ---: | ---: |\n${whitelistRows}\n\n` +
    `- 保留跨券档重复 SKU：${whitelist.crossTierDuplicates} 个。用户确认只在同券档内去重。\n` +
    `- SKUID 按源单元格显示整数转换为文本 SKU；用户确认无须保留前导零。\n` +
    `- 仅取 SKUID，不使用 SPUID、商品名称、价格、型号或链接列。\n\n` +
    `## 信息提示\n\n${noticeMarkdown}\n\n` +
    `## 阻断与待确认项\n\n${blockerMarkdown}\n\n` +
    formatSecondRoundDialogue(secondRoundDialogue);
}

async function main() {
  const requestedCaseDirectory = argument("--case-dir");
  const requestedOutputSuffix = argument("--output-suffix");
  const requestedAiMappingRun = argument("--ai-mapping-run");
  const requestedActivityCopyContext = argument("--activity-copy-context");
  const requestedConfirmActivityCopy = argument("--confirm-activity-copy");
  const requestedSecondRoundInput = argument("--second-round-input");
  if (requestedOutputSuffix && !/^[a-zA-Z0-9_-]+$/.test(requestedOutputSuffix)) {
    throw new Error("--output-suffix 只能包含字母、数字、下划线和连字符");
  }
  if (!requestedCaseDirectory) {
    throw new Error("必须显式提供 --case-dir，拒绝默认扫描真实案例目录");
  }
  const caseDirectory = resolve(requestedCaseDirectory);
  const attachmentsDirectory = join(caseDirectory, "attachments");
  const outputRoot = join(caseDirectory, "local-output");
  if (!pathInside(caseDirectory, attachmentsDirectory) || !pathInside(caseDirectory, outputRoot)) {
    throw new Error("case 输出路径必须位于 case 目录内");
  }
  const attachmentNames = await readdir(attachmentsDirectory);
  if (
    attachmentNames.filter((name) => name.endsWith(".xlsx")).sort().join("|") !==
    [sourceCouponFileName, sourceWhitelistFileName].sort().join("|")
  ) {
    throw new Error("本地练习只接受本案确认的两份 XLSX 输入，不能混入未知文件");
  }
  const couponPath = join(attachmentsDirectory, sourceCouponFileName);
  const whitelistPath = join(attachmentsDirectory, sourceWhitelistFileName);
  const sourcesBefore = {
    coupon: await fileMetadata(couponPath),
    whitelist: await fileMetadata(whitelistPath),
  };
  if (requestedConfirmActivityCopy && !requestedActivityCopyContext) {
    throw new Error("--confirm-activity-copy 必须与 --activity-copy-context 一起使用");
  }
  const activityCopyContext = requestedActivityCopyContext
    ? await loadActivityCopyContext({
        path: requestedActivityCopyContext,
        caseDirectory,
      })
    : undefined;
  const aiMappingReview = requestedAiMappingRun
    ? await loadAiMappingReview({
        path: requestedAiMappingRun,
        caseDirectory,
        sources: sourcesBefore,
      })
    : undefined;
  const secondRoundSimulation = requestedSecondRoundInput
    ? await loadSecondRoundSimulation({
        path: requestedSecondRoundInput,
        caseDirectory,
      })
    : undefined;
  const baseRunName = `r001-${hashPrefix(sourcesBefore.coupon.sha256)}-${hashPrefix(sourcesBefore.whitelist.sha256)}`;
  const runName = requestedOutputSuffix
    ? `${baseRunName}-${requestedOutputSuffix}`
    : baseRunName;
  const outputDirectory = join(outputRoot, runName);
  const artifactsDirectory = join(outputDirectory, "standard-artifacts");
  const screenshotsDirectory = join(outputDirectory, "attachments");
  const renderDirectory = join(outputDirectory, "_render");
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  await mkdir(outputDirectory, { mode: 0o700 });
  await Promise.all([
    mkdir(artifactsDirectory, { mode: 0o700 }),
    mkdir(screenshotsDirectory, { mode: 0o700 }),
    mkdir(renderDirectory, { mode: 0o700 }),
  ]);

  const coupon = await inspectCoupon(couponPath);
  const whitelist = await inspectWhitelist(whitelistPath);
  const configuredTierSubset = assertConfiguredTierSubset(coupon, whitelist);
  const activityCopy = activityCopyContext
    ? (() => {
        const facts = buildActivityCopyFacts({
          sourceHashes: {
            coupon: sourcesBefore.coupon.sha256,
            whitelist: sourcesBefore.whitelist.sha256,
          },
          couponRecords: coupon.records,
          whitelistTiers: whitelist.tiers,
        });
        const candidate = buildActivityNarrativeCandidate({
          context: activityCopyContext.context,
          facts,
        });
        const selection = requestedConfirmActivityCopy
          ? selectActivityNarrativeCandidate({
              candidate,
              candidateHash: requestedConfirmActivityCopy,
            })
          : undefined;
        return {
          status: selection ? "confirmed_for_local_practice" : candidate.generatedCandidate.status,
          context: {
            path: activityCopyContext.path,
            sha256: activityCopyContext.sha256,
          },
          facts,
          candidate,
          selection,
        };
      })()
    : {
        status: "not_requested",
        reason: "本次本地练习未提供活动文案上下文",
      };
  if (
    aiMappingReview?.activityCopy?.factsHash &&
    activityCopy.facts?.factsHash &&
    aiMappingReview.activityCopy.factsHash !== activityCopy.facts.factsHash
  ) {
    throw new Error("活动文案 AI 审查与当前本地事实 hash 不匹配");
  }
  const couponForOutput = secondRoundSimulation
    ? {
        ...coupon,
        activityNames: [secondRoundSimulation.values.activityName],
        records: coupon.records.map((record) => ({
          ...record,
          activityName: secondRoundSimulation.values.activityName,
        })),
      }
    : coupon;
  const couponArtifactPath = join(artifactsDirectory, outputCouponFileName);
  const generatedCouponArtifact = await writeMappedCouponWorkbook(
    couponArtifactPath,
    couponForOutput,
  );
  const couponArtifact = {
    path: couponArtifactPath,
    ...generatedCouponArtifact,
  };
  const screenshot = await renderCouponTable({
    couponArtifact,
    renderDirectory,
    attachmentsDirectory: screenshotsDirectory,
  });
  const whitelistArtifactPath = join(artifactsDirectory, outputWhitelistFileName);
  const whitelistArtifact = await writeFourTierWhitelist(
    whitelistArtifactPath,
    whitelist.tiers,
  );

  const sourcesAfter = {
    coupon: await fileMetadata(couponPath),
    whitelist: await fileMetadata(whitelistPath),
  };
  if (
    !sourceStateMatches(sourcesBefore.coupon, sourcesAfter.coupon) ||
    !sourceStateMatches(sourcesBefore.whitelist, sourcesAfter.whitelist)
  ) {
    throw new Error("检测到源文件在本地练习期间变化，拒绝发布结果");
  }
  if (networkCalls !== 0) throw new Error("本地练习期间发生网络调用");

  const relativeOutput = relative(caseDirectory, outputDirectory) || ".";
  const generatedNarrative = activityCopy.candidate?.generatedCandidate;
  const selectedNarrative = activityCopy.selection;
  const simulatedValues = secondRoundSimulation?.values;
  const activityCopyBlockers = simulatedValues?.activityBackground
    ? []
    : selectedNarrative
    ? []
    : generatedNarrative?.blockers?.length
      ? generatedNarrative.blockers.map((blocker) => `活动文案候选：${blocker}`)
      : generatedNarrative
        ? ["活动文案候选已生成，仍需显式确认候选 hash"]
        : ["活动背景未提供"];
  const practiceDraft = {
    schemaVersion: "coupon-oa-local-practice-v1",
    status: runMode,
    practiceOnly: true,
    submissionReady: false,
    oaCreated: false,
    nativeOaStatus: "not_attempted",
    networkCalls,
    sources: {
      coupon: { sha256: sourcesBefore.coupon.sha256, bytes: sourcesBefore.coupon.bytes },
      whitelist: { sha256: sourcesBefore.whitelist.sha256, bytes: sourcesBefore.whitelist.bytes },
      blacklistStatus: "absent_confirmed",
    },
    aiMappingReview: aiMappingReview ?? {
      status: "not_provided",
      reason: "本次本地练习未绑定 DeepSeek 映射审查结果",
    },
    activityCopy,
    secondRoundSimulation,
    userConfirmedDecisions: {
      noBlacklistConfirmed: true,
      identifierColumn: "SKUID",
      numericSkuMayBeConvertedToText: true,
      whitelistDeduplication: "within_tier_only",
      crossTierDuplicatesPreserved: true,
      financialScope: "four_tiers_single_channel_baseline",
      costFormula: "source_total_quantity_times_face_value_times_claim_rate_times_use_rate_times_platform_share",
      calculationImageMode: "filled_standard_coupon_workbook_render",
      activityNarrativeCandidateHash: selectedNarrative?.candidateHash ?? null,
      ...(secondRoundSimulation
        ? {
            secondRoundSimulationSha256: secondRoundSimulation.sha256,
            channelsConfirmed: simulatedValues.channelsConfirmed,
          }
        : {}),
    },
    oaValues: {
      applicationType: "优惠券申请",
      department: {
        source: "feishuIdentity",
        status: "resolved_on_final_confirmation",
      },
      applicant: {
        source: "feishuIdentity",
        status: "resolved_on_final_confirmation",
      },
      businessMode: simulatedValues
        ? {
            value: simulatedValues.businessMode,
            source: "localSecondRoundSimulation",
            status: "confirmed_for_local_practice",
          }
        : { status: "unresolved" },
      activityName: {
        sourceCandidate: coupon.activityNames,
        generatedCandidate: generatedNarrative?.activityName ?? null,
        selectedValue:
          simulatedValues?.activityName ?? selectedNarrative?.activityName ?? null,
        status: simulatedValues?.activityName
          ? "confirmed_for_local_practice"
          : selectedNarrative
          ? "confirmed_for_local_practice"
          : generatedNarrative?.activityName
            ? generatedNarrative.status
            : "requires_business_confirmation",
      },
      activityBackground: {
        generatedCandidate: generatedNarrative?.activityBackground ?? null,
        selectedValue:
          simulatedValues?.activityBackground ??
          selectedNarrative?.activityBackground ??
          null,
        blockers: simulatedValues
          ? []
          : (generatedNarrative?.blockers ?? activityCopyBlockers),
        status: simulatedValues?.activityBackground
          ? "confirmed_for_local_practice"
          : selectedNarrative
          ? "confirmed_for_local_practice"
          : generatedNarrative?.activityBackground
            ? generatedNarrative.status
            : "unresolved",
      },
      activityPointPercent: {
        ...(simulatedValues
          ? {
              value: simulatedValues.activityPointPercent,
              source: "localSecondRoundSimulation",
              status: "confirmed_for_local_practice",
            }
          : {
              status: "unresolved",
              reason: "source contains multiple coupon discount ratios",
            }),
      },
      platformBearingPercent: coupon.platformShares.map((value) => value * 100),
      overDeduction: {
        value: simulatedValues?.overDeduction ?? "否",
        source: simulatedValues
          ? "localSecondRoundSimulation"
          : "workflowDefault",
        status: simulatedValues
          ? "confirmed_for_local_practice"
          : "defaulted_pending_unified_confirmation",
        ...(simulatedValues?.overDeductionReason
          ? { reason: simulatedValues.overDeductionReason }
          : {}),
      },
      estimatedCostYuan: coupon.aggregate.estimatedCostYuan,
      estimatedGmvYuan: coupon.aggregate.estimatedGmvYuan,
      estimatedRoi: coupon.aggregate.estimatedRoi,
      channels: coupon.channelLabels,
      activityDates: {
        status: simulatedValues
          ? "confirmed_for_local_practice"
          : "unresolved",
        ...(simulatedValues
          ? {
              startAt: simulatedValues.activityStartAt,
              endAt: simulatedValues.activityEndAt,
              source: "localSecondRoundSimulation",
            }
          : {}),
        sourceClaimWindows: uniqueBy(coupon.records, (record) => record.claimWindow).map(
          (record) => record.claimWindow,
        ),
        sourceUseWindows: uniqueBy(coupon.records, (record) => record.useWindow).map(
          (record) => record.useWindow,
        ),
      },
      intentionallyBlank: ["活动ID", "批次Id", "优惠券活动配置KEY(putKey)", "PC端领券链接", "M端领券链接"],
    },
    couponRows: couponForOutput.records,
    whitelist: {
      mode: "four_tier_local_practice_template",
      templateSubsetStatus: "verified_configured_subset",
      configuredTiers: configuredTierSubset.configuredTiers,
      whitelistTiers: configuredTierSubset.whitelistTiers,
      unconfiguredTiers: configuredTierSubset.unconfiguredTiers,
      tiers: whitelist.tiers.map((tier) => ({
        name: tier.name,
        sourceRowCount: tier.sourceRowCount,
        deduplicatedSkuCount: tier.skus.length,
        removedWithinTierDuplicates: tier.duplicateCount,
        numericSourceSkuCount: tier.numericSourceCount,
      })),
      crossTierDuplicatesPreserved: whitelist.crossTierDuplicates,
      globalUniqueSkuCount: whitelist.globalUniqueSkuCount,
    },
    attachments: {
      couponTable: {
        role: "local_mapped_template_artifact",
        path: relative(caseDirectory, couponArtifactPath),
        sha256: couponArtifact.sha256,
        bytes: couponArtifact.bytes,
      },
      whitelist: {
        role: "local_four_tier_practice_artifact",
        path: relative(caseDirectory, whitelistArtifactPath),
        sha256: whitelistArtifact.sha256,
        bytes: whitelistArtifact.bytes.byteLength,
      },
      calculationImage: {
        role: "generated_filled_coupon_workbook_screenshot",
        path: relative(caseDirectory, screenshot.path),
        sha256: screenshot.sha256,
        bytes: screenshot.bytes,
        sourceArtifactPath: relative(caseDirectory, screenshot.sourceArtifactPath),
        sourceArtifactSha256: screenshot.sourceArtifactSha256,
        sourceArtifactTemplateId: screenshot.sourceArtifactTemplateId,
        sourceArtifactTemplateVersion: screenshot.sourceArtifactTemplateVersion,
        sourceArtifactGeneratorRuleVersion: screenshot.sourceArtifactGeneratorRuleVersion,
        pageCount: screenshot.pageCount,
        renderedSheet: screenshot.renderedSheet,
        renderedRange: screenshot.renderedRange,
        note: screenshot.sourceFormulaNote,
      },
    },
    blockers: [
      ...(simulatedValues
        ? simulatedValues.channelsConfirmed
          ? []
          : ["配置渠道映射尚未由业务确认"]
        : [
            "业务模式未提供",
            ...activityCopyBlockers,
            "带年份的活动日期未确认",
            "活动点位无法从混合券档自动确定",
          ]),
    ],
  };
  const secondRoundDialogue = buildSecondRoundDialogue({
    activityCopy,
    oaValues: practiceDraft.oaValues,
  });
  practiceDraft.secondRoundDialogue = secondRoundDialogue;
  const markdownDraft = draftMarkdown({
    caseRelativeOutput: relativeOutput,
    coupon: couponForOutput,
    whitelist,
    couponArtifact,
    whitelistArtifact,
    screenshot,
    sources: sourcesBefore,
    aiMappingReview,
    activityCopy,
    secondRoundDialogue,
    secondRoundSimulation,
  });
  await writePrivateJson(join(outputDirectory, "activity-copy-run.json"), activityCopy);
  if (secondRoundSimulation) {
    await writePrivateJson(
      join(outputDirectory, "second-round-simulation.json"),
      secondRoundSimulation,
    );
  }
  await writePrivateJson(join(outputDirectory, "second-round-dialogue.json"), secondRoundDialogue);
  await writePrivate(
    join(outputDirectory, "second-round-dialogue.md"),
    formatSecondRoundDialogue(secondRoundDialogue),
  );
  if (activityCopy.facts) {
    await writePrivateJson(join(outputDirectory, "activity-copy-facts.json"), activityCopy.facts);
    await writePrivateJson(join(outputDirectory, "activity-narrative-candidate.json"), activityCopy.candidate);
  }
  await writePrivateJson(join(outputDirectory, "mapped-oa-draft.json"), practiceDraft);
  await writePrivate(join(outputDirectory, "mapped-oa-draft.md"), markdownDraft);
  await writePrivateJson(join(outputDirectory, "mapping-report.json"), {
    status: runMode,
    sourceHashes: practiceDraft.sources,
    aiMappingReview: practiceDraft.aiMappingReview,
    activityCopy: {
      status: activityCopy.status,
      candidateHash: activityCopy.candidate?.candidateHash ?? null,
      factsHash: activityCopy.facts?.factsHash ?? null,
      notices: generatedNarrative?.notices ?? [],
    },
    secondRoundDialogue: {
      status: secondRoundDialogue.status,
      exceptionCount: secondRoundDialogue.exceptionDisplay.length,
      missingFieldCount: secondRoundDialogue.missingFields.length,
    },
    recognizedCouponRows: coupon.records.length,
    recognizedCouponTiers: coupon.couponTiers,
    sourceFormulaChecks: coupon.records.map((record) => ({
      sourceRow: record.sourceRow,
      couponName: record.couponName,
      checks: record.formulaChecks,
    })),
    whitelist: practiceDraft.whitelist,
    blockers: practiceDraft.blockers,
  });
  await writePrivate(
    join(outputDirectory, "mapping-report.md"),
    `# 本地映射报告\n\n状态：\`${runMode}\`\n\n` +
      `- 识别配券记录：${coupon.records.length} 条（${coupon.couponTiers.length} 个券档、${coupon.channelLabels.length} 个渠道）\n` +
      `- 白名单：${whitelist.tiers.length} 个券档；仅在券档内去重；跨券档重复 SKU 保留：${whitelist.crossTierDuplicates} 个\n` +
      `- 黑名单：本次无黑名单（用户已确认）\n` +
      `- 活动文案候选：${activityCopy.status}${activityCopy.candidate?.candidateHash ? `（hash：${activityCopy.candidate.candidateHash}）` : ""}\n` +
      `- 所有源公式缓存校验：通过\n` +
      `- 详情请查看同目录 \`mapped-oa-draft.md\`；该草稿不可提交。\n`,
  );
  await writePrivateJson(join(outputDirectory, "run-manifest.json"), {
    status: runMode,
    outputDirectory: relativeOutput,
    networkCalls,
    oaCreated: false,
    sourceFilesUnchanged: true,
    aiMappingReview: practiceDraft.aiMappingReview,
    activityCopy: {
      status: activityCopy.status,
      candidateHash: activityCopy.candidate?.candidateHash ?? null,
      factsHash: activityCopy.facts?.factsHash ?? null,
      notices: generatedNarrative?.notices ?? [],
    },
    secondRoundDialogue: {
      status: secondRoundDialogue.status,
      exceptionCount: secondRoundDialogue.exceptionDisplay.length,
      missingFieldCount: secondRoundDialogue.missingFields.length,
    },
    sources: {
      before: sourcesBefore,
      after: sourcesAfter,
    },
    outputs: {
      couponArtifact: {
        path: relative(caseDirectory, couponArtifactPath),
        sha256: couponArtifact.sha256,
        templateId: couponArtifact.templateId,
        templateVersion: couponArtifact.templateVersion,
        generatorRuleVersion: couponArtifact.generatorRuleVersion,
      },
      whitelistArtifact: {
        path: relative(caseDirectory, whitelistArtifactPath),
        sha256: whitelistArtifact.sha256,
      },
      screenshot: {
        path: relative(caseDirectory, screenshot.path),
        sha256: screenshot.sha256,
        sourceArtifactPath: relative(caseDirectory, screenshot.sourceArtifactPath),
        sourceArtifactSha256: screenshot.sourceArtifactSha256,
        sourceArtifactTemplateId: screenshot.sourceArtifactTemplateId,
        sourceArtifactTemplateVersion: screenshot.sourceArtifactTemplateVersion,
        sourceArtifactGeneratorRuleVersion: screenshot.sourceArtifactGeneratorRuleVersion,
        pageCount: screenshot.pageCount,
        renderedSheet: screenshot.renderedSheet,
        renderedRange: screenshot.renderedRange,
        imageDimensions: screenshot.imageDimensions,
      },
    },
  });
  console.log(
    JSON.stringify(
      {
        status: runMode,
        outputDirectory,
        networkCalls,
        oaCreated: false,
        activityCopyStatus: activityCopy.status,
        activityNarrativeCandidateHash: activityCopy.candidate?.candidateHash ?? null,
        secondRoundStatus: secondRoundDialogue.status,
        secondRoundExceptionCount: secondRoundDialogue.exceptionDisplay.length,
        secondRoundMissingFieldCount: secondRoundDialogue.missingFields.length,
        blockers: practiceDraft.blockers.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`local case runner failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
