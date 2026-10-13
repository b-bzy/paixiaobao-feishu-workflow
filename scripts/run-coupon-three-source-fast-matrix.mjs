#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import catalogModule from "../server/lib/coupon-oa/three-source/e2e/case-catalog.ts";
import runnerModule from "../server/lib/coupon-oa/three-source/e2e/fast-runner.ts";

const { couponThreeSourceE2eCases } = catalogModule;
const { runFastE2eCase } = runnerModule;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const output = resolve(argument("--output") ?? "outputs/coupon-three-source-e2e/matrix");
const perCase = resolve(output, "per-case");
await mkdir(perCase, { recursive: true });

const results = [];
for (const caseValue of couponThreeSourceE2eCases) {
  const actual = await runFastE2eCase(caseValue);
  const classificationMatches =
    actual.classification === caseValue.expected.classification;
  const codeMatches =
    !caseValue.expected.userFacingCode ||
    actual.code === caseValue.expected.userFacingCode;
  const accepted = classificationMatches && codeMatches;
  const result = {
    caseId: caseValue.id,
    title: caseValue.title,
    accepted,
    expected: {
      classification: caseValue.expected.classification,
      code: caseValue.expected.userFacingCode,
    },
    actual: {
      classification: actual.classification,
      code: actual.code,
      revision: actual.revision,
      artifactRoles: actual.artifacts.map((item) => item.role),
      nativeOaCreated: actual.nativeOaCreated,
      networkCalls: actual.networkCalls,
    },
  };
  results.push(result);
  const directory = resolve(perCase, caseValue.id);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "result.json"), `${JSON.stringify(result, null, 2)}\n`, {
    mode: 0o600,
  });
}

const summary = {
  schemaVersion: "coupon-three-source-fast-matrix-v1",
  total: results.length,
  accepted: results.filter((item) => item.accepted).length,
  failed: results.filter((item) => !item.accepted).length,
  results,
};
await writeFile(resolve(output, "fast-matrix-results.json"), `${JSON.stringify(summary, null, 2)}\n`, {
  mode: 0o600,
});
process.stdout.write(`${JSON.stringify({ total: summary.total, accepted: summary.accepted, failed: summary.failed })}\n`);
if (summary.failed) process.exitCode = 1;
