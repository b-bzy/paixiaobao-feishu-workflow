#!/usr/bin/env node

/**
 * 三源优惠券本地用例检查器：把任意真实 xlsx 案例目录喂进三源离线管线，
 * 不经过飞书 / 控制面 / DeepSeek。按真实 pilot 服务的调用链组合
 * （inspect → confirm(ownerFieldValues) → parseMultiSheetTieredIdentifierList
 * → buildSourceConfirmation → createCanonicalPackage → generateOfflineArtifacts），
 * 逐步报告每个文件的角色识别、名单维度候选，以及管线在哪一步被哪条校验拦住。
 *
 * 用法：
 *   node --import tsx scripts/coupon-three-source-case-inspector.mts \
 *     --cases-root "/Users/jacob/Desktop/测试用例" \
 *     --set 活动背景=本地测试活动背景 --set 活动积分比例=6
 *   单目录：--case-dir ".../case1"；角色含糊时用 --coupon-table/--whitelist/
 *   --blacklist <文件名> 手工指定；--out 指定输出根目录。
 *
 * 输出：<out>/<case>/report.json 与 <out>/<case>/artifacts/（生成的标准
 * 配券表、白/黑名单产物可直接打开核对）。默认 .local/case-inspector/，
 * 该目录被 git 忽略；真实业务数据不得提交。
 *
 * 边界：纯本地零副作用；不发 AI 请求（当前 .env 无 DeepSeek key，识别仅走
 * 确定性层）；--set 仅模拟第二轮卡片上的 owner 手工补充；无黑名单时本地
 * 默认视为「确认本次无黑名单」（等价于卡片上的显式确认动作）；不生成 OA
 * 截图与预填快照（需要渲染器，仅 Preview/线上可做）。
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  confirmRegularFullReductionCouponSet,
  inspectThreeSourceWorkbook,
} from "../server/lib/coupon-oa/three-source/recognition";
import { parseMultiSheetTieredIdentifierList } from "../server/lib/coupon-oa/three-source/lists";
import {
  createCouponSetCanonicalPackage,
  generateOfflineArtifacts,
} from "../server/lib/coupon-oa/three-source/workflow";
import type {
  CouponFieldKey,
  OfflineSourceFile,
  WorkbookRecognition,
} from "../server/lib/coupon-oa/three-source/types";

const templatesDirectory = resolve(
  "docs/oa-ticket-reimbursement-materials/reference/templates",
);

/** 与服务端取值语义一致的中文字段别名 → 领域键。 */
const fieldAliases = new Map<string, CouponFieldKey>([
  ["活动名称", "activityName"],
  ["活动背景", "activityBackground"],
  ["业务模式", "businessMode"],
  ["申请人", "applicantName"],
  ["活动开始日期", "activityStartAt"],
  ["活动结束日期", "activityEndAt"],
  ["用券渠道", "channels"],
  ["满减门槛", "thresholdYuan"],
  ["优惠面额", "discountAmountYuan"],
  ["总申请数量", "totalQuantity"],
  ["单次发放到账张数", "grantQuantityPerClaim"],
  ["每日领取次数", "dailyClaimLimit"],
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
  ["是否超扣点", "overDeduction"],
  ["是否超扣", "overDeduction"],
  ["超扣", "overDeduction"],
  ["超扣点原因", "overDeductionReason"],
  ["超扣原因", "overDeductionReason"],
  ["活动积分比例", "activityPointPercent"],
]);

const numericKeys = new Set<CouponFieldKey>([
  "thresholdYuan",
  "discountAmountYuan",
  "totalQuantity",
  "grantQuantityPerClaim",
  "dailyClaimLimit",
  "expectedClaimRate",
  "expectedUseRate",
  "platformBearingRatio",
  "estimatedGmvYuan",
  "activityPointPercent",
]);

interface CaseFileReport {
  fileName: string;
  sourceHash8: string;
  detectedRole?: string;
  roleCandidates: { role: string; score: number; reasons: string[] }[];
  couponFieldKeys: string[];
  listCandidates: {
    kind: string;
    dimension?: string;
    sheetName: string;
    header: string;
    score: number;
  }[];
  issues: string[];
  inspectError?: string;
}

interface CaseReport {
  caseName: string;
  files: CaseFileReport[];
  pairing: {
    couponTable?: string;
    whitelist?: string;
    blacklist?: string;
    ambiguousRoles: string[];
    note?: string;
  };
  ownerSupplements: Record<string, string>;
  stages: { stage: string; ok: boolean; error?: string; detail?: string }[];
  artifacts?: { role: string; fileName: string; sha256: string; rowCount: number }[];
  elapsedMs: number;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function argumentsAll(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) values.push(process.argv[index + 1] ?? "");
  }
  return values;
}

function bestRole(recognition: WorkbookRecognition): string | undefined {
  const ranked = [...recognition.roleCandidates].sort(
    (a, b) => b.score - a.score,
  );
  return ranked[0]?.role;
}

async function summarizeFile(
  fileName: string,
  bytes: Uint8Array,
): Promise<CaseFileReport> {
  const source: OfflineSourceFile = { fileName, bytes };
  let recognition: WorkbookRecognition;
  try {
    recognition = await inspectThreeSourceWorkbook(source);
  } catch (error) {
    return {
      fileName,
      sourceHash8: "",
      roleCandidates: [],
      couponFieldKeys: [],
      listCandidates: [],
      issues: [],
      inspectError: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    fileName,
    sourceHash8: recognition.sourceHash.slice(0, 8),
    detectedRole: bestRole(recognition),
    roleCandidates: recognition.roleCandidates
      .map((candidate) => ({
        role: candidate.role,
        score: candidate.score,
        reasons: candidate.reasons.slice(0, 2),
      }))
      .sort((a, b) => b.score - a.score),
    couponFieldKeys: Object.entries(recognition.couponFieldCandidates)
      .filter(([, candidates]) => (candidates?.length ?? 0) > 0)
      .map(([key]) => key),
    listCandidates: recognition.listCandidates.map((candidate) => ({
      kind: candidate.kind,
      dimension: candidate.dimension,
      sheetName: candidate.sheetName,
      header: candidate.header,
      score: candidate.score,
    })),
    issues: recognition.issues,
  };
}

async function loadTemplates() {
  const [regularFullReductionTemplateBytes, whitelistTemplateBytes, blacklistTemplateBytes] =
    await Promise.all([
      readFile(join(templatesDirectory, "配券信息表-常规满减券.xlsx")),
      readFile(join(templatesDirectory, "商品明细白名单-多券档SKU-v1.xlsx")),
      readFile(join(templatesDirectory, "商品明细黑名单-多券档SKU-v1.xlsx")),
    ]);
  return {
    regularFullReductionTemplateBytes: new Uint8Array(
      regularFullReductionTemplateBytes,
    ),
    whitelistTemplateBytes: new Uint8Array(whitelistTemplateBytes),
    blacklistTemplateBytes: new Uint8Array(blacklistTemplateBytes),
  };
}

async function runCase(
  caseDirectory: string,
  overrides: Record<string, string | undefined>,
  ownerSupplements: Partial<Record<CouponFieldKey, unknown>>,
  supplementEcho: Record<string, string>,
): Promise<CaseReport> {
  const startedAt = Date.now();
  const caseName = basename(caseDirectory);
  const entries = await readdir(caseDirectory);
  const fileNames = entries
    .filter(
      (name) => name.toLowerCase().endsWith(".xlsx") && !name.startsWith("~$"),
    )
    .sort();

  const files: CaseFileReport[] = [];
  const sources = new Map<string, OfflineSourceFile>();
  for (const fileName of fileNames) {
    const bytes = new Uint8Array(await readFile(join(caseDirectory, fileName)));
    sources.set(fileName, { fileName, bytes });
    files.push(await summarizeFile(fileName, bytes));
  }

  const byRole = new Map<string, string[]>();
  for (const report of files) {
    if (!report.detectedRole) continue;
    const bucket = byRole.get(report.detectedRole) ?? [];
    bucket.push(report.fileName);
    byRole.set(report.detectedRole, bucket);
  }
  const ambiguousRoles = [...byRole.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([role]) => role);

  const pick = (role: string, flag: string): string | undefined => {
    if (overrides[flag]) return overrides[flag];
    const names = byRole.get(role);
    return names?.length === 1 ? names[0] : undefined;
  };
  const couponTableFile = pick("couponTable", "couponTable");
  const whitelistFile = pick("whitelist", "whitelist");
  const blacklistFile = pick("blacklist", "blacklist");

  const report: CaseReport = {
    caseName,
    files,
    pairing: {
      ...(couponTableFile ? { couponTable: couponTableFile } : {}),
      ...(whitelistFile ? { whitelist: whitelistFile } : {}),
      ...(blacklistFile ? { blacklist: blacklistFile } : {}),
      ambiguousRoles,
      ...(!couponTableFile || !whitelistFile
        ? {
            note: "无法唯一配对 couponTable/whitelist；用 --coupon-table/--whitelist/--blacklist 指定文件名重跑",
          }
        : {}),
    },
    ownerSupplements: supplementEcho,
    stages: [],
    elapsedMs: 0,
  };
  const recordStage = (
    stage: string,
    error: unknown,
    detail?: string,
  ): void => {
    report.stages.push({
      stage,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ...(detail ? { detail } : {}),
    });
  };

  if (!couponTableFile || !whitelistFile) {
    report.elapsedMs = Date.now() - startedAt;
    return report;
  }

  const ownerId = "local-case-inspector";
  const revision = 1;
  let currentStage = "confirm_coupon_set";
  let artifactsDir: string | undefined;
  try {
    const couponRecognition = await inspectThreeSourceWorkbook(
      sources.get(couponTableFile)!,
    );
    const couponSet = await confirmRegularFullReductionCouponSet({
      recognition: couponRecognition,
      ownerId,
      revision,
      ownerFieldValues: ownerSupplements,
    });
    report.stages.push({
      stage: "confirm_coupon_set",
      ok: true,
      detail: `确认 ${couponSet.tiers.length} 个券档`,
    });

    currentStage = "parse_whitelist";
    const whitelist = await parseMultiSheetTieredIdentifierList({
      recognition: await inspectThreeSourceWorkbook(
        sources.get(whitelistFile)!,
      ),
      role: "whitelist",
    });
    report.stages.push({
      stage: "parse_whitelist",
      ok: true,
      detail: `dimension=${whitelist.dimension}，${whitelist.entries.length} 条，${whitelist.sheetOrder.length} 档`,
    });

    let blacklist;
    if (blacklistFile) {
      currentStage = "parse_blacklist";
      blacklist = await parseMultiSheetTieredIdentifierList({
        recognition: await inspectThreeSourceWorkbook(
          sources.get(blacklistFile)!,
        ),
        role: "blacklist",
      });
      report.stages.push({
        stage: "parse_blacklist",
        ok: true,
        detail: `dimension=${blacklist.dimension}，${blacklist.entries.length} 条`,
      });
    }

    currentStage = "create_package";
    const blacklistStatus = blacklist
      ? blacklist.issues.length
        ? "invalid"
        : "uploaded"
      : "absent_confirmed";
    const packageValue = createCouponSetCanonicalPackage({
      ownerId,
      revision,
      couponSet,
      whitelist,
      blacklistStatus,
      blacklist,
      overlapDecision: "whitelist_wins",
    });
    report.stages.push({ stage: "create_package", ok: true });

    currentStage = "generate_artifacts";
    const templates = await loadTemplates();
    const artifacts = await generateOfflineArtifacts({
      package: packageValue,
      templates,
    });
    report.stages.push({
      stage: "generate_artifacts",
      ok: true,
      detail: artifacts.map((artifact) => artifact.fileName).join("、"),
    });
    artifactsDir = join(outputRoot, caseName, "artifacts");
    await mkdir(artifactsDir, { recursive: true });
    for (const artifact of artifacts) {
      await writeFile(join(artifactsDir, artifact.fileName), artifact.bytes);
    }
    report.artifacts = artifacts.map((artifact) => ({
      role: artifact.role,
      fileName: artifact.fileName,
      sha256: artifact.sha256.slice(0, 12),
      rowCount: artifact.rowCount,
    }));
  } catch (error) {
    recordStage(currentStage, error);
  }

  report.elapsedMs = Date.now() - startedAt;
  return report;
}

function printReport(report: CaseReport): void {
  const lines: string[] = [];
  lines.push(
    `\n== ${report.caseName} ==（${report.files.length} 个 xlsx，${report.elapsedMs}ms）`,
  );
  for (const file of report.files) {
    const role = file.inspectError
      ? `识别失败: ${file.inspectError}`
      : `${file.detectedRole ?? "无角色"}`;
    const lists = file.listCandidates
      .map((candidate) => {
        const dimensions = new Set(
          file.listCandidates
            .filter((item) => item.sheetName === candidate.sheetName)
            .map((item) => item.dimension ?? "?"),
        );
        return `${candidate.kind}/${[...dimensions].join("+")}@${candidate.sheetName}`;
      })
      .filter((value, index, all) => all.indexOf(value) === index)
      .join("、");
    lines.push(
      `  ${file.fileName}`,
      `    角色: ${role}（字段候选 ${file.couponFieldKeys.length}${lists ? `；名单: ${lists}` : ""}）`,
    );
    for (const issue of file.issues.slice(0, 4)) {
      lines.push(`    issue: ${issue}`);
    }
  }
  const pairing = report.pairing;
  lines.push(
    `  配对: couponTable=${pairing.couponTable ?? "✗"} whitelist=${pairing.whitelist ?? "✗"} blacklist=${pairing.blacklist ?? "—"}` +
      (pairing.ambiguousRoles.length
        ? `（角色含糊: ${pairing.ambiguousRoles.join("、")}）`
        : ""),
  );
  if (pairing.note) lines.push(`  提示: ${pairing.note}`);
  for (const stage of report.stages) {
    lines.push(
      stage.ok
        ? `  ✓ ${stage.stage}${stage.detail ? `: ${stage.detail}` : ""}`
        : `  ⛔ ${stage.stage}: ${stage.error}`,
    );
  }
  if (report.artifacts?.length) {
    for (const artifact of report.artifacts) {
      lines.push(
        `  产物: [${artifact.role}] ${artifact.fileName}（${artifact.rowCount} 行，sha256 ${artifact.sha256}）`,
      );
    }
  }
  console.log(lines.join("\n"));
}

const casesRoot = argument("--cases-root");
const caseDir = argument("--case-dir");
const outputRoot = resolve(argument("--out") ?? ".local/case-inspector");
const overrides: Record<string, string | undefined> = {
  couponTable: argument("--coupon-table"),
  whitelist: argument("--whitelist"),
  blacklist: argument("--blacklist"),
};

const ownerSupplements: Partial<Record<CouponFieldKey, unknown>> = {};
const supplementEcho: Record<string, string> = {};
for (const pair of argumentsAll("--set")) {
  const eq = pair.indexOf("=");
  if (eq <= 0) throw new Error(`--set 需要 key=value 格式，收到: ${pair}`);
  const rawKey = pair.slice(0, eq).trim();
  const rawValue = pair.slice(eq + 1).trim();
  const key = fieldAliases.get(rawKey) ?? (rawKey as CouponFieldKey);
  ownerSupplements[key] = numericKeys.has(key)
    ? Number(rawValue)
    : rawValue;
  supplementEcho[rawKey] = rawValue;
}

if (!casesRoot && !caseDir) {
  throw new Error("必须提供 --cases-root 或 --case-dir");
}

const directories = caseDir
  ? [resolve(caseDir)]
  : (await readdir(resolve(casesRoot!), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^case/i.test(entry.name))
      .map((entry) => join(resolve(casesRoot!), entry.name));

if (!directories.length) {
  throw new Error(`在 ${casesRoot} 下没有找到 case* 目录`);
}

await mkdir(outputRoot, { recursive: true });
for (const directory of directories) {
  const report = await runCase(
    directory,
    overrides,
    ownerSupplements,
    supplementEcho,
  );
  printReport(report);
  const caseOut = join(outputRoot, report.caseName);
  await mkdir(caseOut, { recursive: true });
  await writeFile(
    join(caseOut, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}
console.log(`\n详细报告与产物已写入 ${outputRoot}/<case>/`);
