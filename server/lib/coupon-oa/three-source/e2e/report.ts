import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type E2eLaneStatus =
  | "passed"
  | "failed"
  | "not_run"
  | "infrastructure_failure";

export interface CouponThreeSourceE2eReportResult {
  caseId: string;
  classification:
    | "passed"
    | "needs_clarification"
    | "expected_block"
    | "unexpected_failure";
  revision: number;
  code?: string;
  artifactRoles: string[];
  effectIds: string[];
}

export interface CouponThreeSourceE2eRunReport {
  outputDirectory: string;
  runId: string;
  lanes: { fast: E2eLaneStatus; durable: E2eLaneStatus };
  results: CouponThreeSourceE2eReportResult[];
  boundary: {
    networkCalls: number;
    nativeOaCreated: false;
    feishuVerified: false;
  };
}

const classificationLabels = {
  passed: "成功",
  needs_clarification: "待补充",
  expected_block: "预期阻断",
  unexpected_failure: "非预期失败",
} as const;

const laneLabels: Record<E2eLaneStatus, string> = {
  passed: "通过",
  failed: "失败",
  not_run: "未运行",
  infrastructure_failure: "基础设施失败",
};

function markdown(report: CouponThreeSourceE2eRunReport): string {
  const groups = Object.keys(classificationLabels).map((classification) => {
    const items = report.results.filter(
      (item) => item.classification === classification,
    );
    const rows = items.length
      ? items
          .map(
            (item) =>
              `- ${item.caseId}：${item.code ?? "无错误码"}（revision ${item.revision}）`,
          )
          .join("\n")
      : "- 无";
    return `## ${classificationLabels[classification as keyof typeof classificationLabels]}\n\n${rows}`;
  });
  return `# 三源优惠券本地 E2E 验收报告

- 运行 ID：${report.runId}
- 快速层：${laneLabels[report.lanes.fast]}
- 耐久层：${laneLabels[report.lanes.durable]}
- 网络调用次数：${report.boundary.networkCalls}
- 原生 OA 创建：否
- 飞书端未验证

${groups.join("\n\n")}

## 证据边界

本报告仅覆盖本地业务与耐久测试。飞书 tenant、事件传输、卡片渲染、文件 token、
Vercel Protection、Drive、Base、Approval 和原生 OA 均未验证。
`;
}

export async function writeCouponThreeSourceE2eReport(
  report: CouponThreeSourceE2eRunReport,
): Promise<{ json: string; markdown: string }> {
  await mkdir(report.outputDirectory, { recursive: true });
  const jsonPath = join(report.outputDirectory, "test-results.json");
  const markdownPath = join(report.outputDirectory, "本地E2E验收报告.md");
  const safeReport = {
    schemaVersion: "coupon-three-source-local-e2e-report-v1",
    runId: report.runId,
    lanes: report.lanes,
    results: report.results,
    boundary: report.boundary,
  };
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(safeReport, null, 2)}\n`, {
      mode: 0o600,
    }),
    writeFile(markdownPath, markdown(report), { mode: 0o600 }),
  ]);
  return { json: jsonPath, markdown: markdownPath };
}
