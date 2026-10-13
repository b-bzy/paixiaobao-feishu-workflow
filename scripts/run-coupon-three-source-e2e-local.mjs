#!/usr/bin/env node

import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { writeCouponThreeSourceE2eReport } from "../server/lib/coupon-oa/three-source/e2e/report.ts";
import { runCouponThreeSourceE2e } from "./lib/coupon-three-source-e2e-orchestrator.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const lane = argument("--lane") ?? "all";
const runId =
  argument("--run-id") ??
  new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const result = await runCouponThreeSourceE2e({
  lane,
  runId,
  keepInfra: process.argv.includes("--keep-infra"),
  environment: process.env,
});
await mkdir(resolve(result.outputDirectory), { recursive: true });
let matrixResults = [];
if (result.lanes.fast === "passed") {
  const matrix = JSON.parse(
    await readFile(
      resolve(result.outputDirectory, "fast-matrix-results.json"),
      "utf8",
    ),
  );
  matrixResults = matrix.results.map((item) => ({
    caseId: item.caseId,
    classification: item.accepted
      ? item.actual.classification
      : "unexpected_failure",
    revision: item.actual.revision,
    code: item.accepted ? item.actual.code : "EXPECTATION_MISMATCH",
    artifactRoles: item.actual.artifactRoles,
    effectIds: [],
  }));
}
await writeCouponThreeSourceE2eReport({
  outputDirectory: result.outputDirectory,
  runId,
  lanes: result.lanes,
  results: [
    ...matrixResults,
    ...result.failures.map((failure, index) => ({
      caseId: `INFRA-${index + 1}`,
      classification: "unexpected_failure",
      revision: 0,
      code: failure.code,
      artifactRoles: [],
      effectIds: [],
    })),
  ],
  boundary: {
    networkCalls: lane === "deepseek" ? 1 : 0,
    nativeOaCreated: false,
    feishuVerified: false,
  },
});
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = result.exitCode;
