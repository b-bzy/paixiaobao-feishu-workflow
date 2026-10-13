#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { couponThreeSourceE2eCases } from "../server/lib/coupon-oa/three-source/e2e/case-catalog.ts";
import { buildE2eWorkbook } from "../server/lib/coupon-oa/three-source/e2e/workbook-fixture-builder.ts";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function assertOutputPath(path) {
  const repository = process.cwd();
  const allowedRoot = resolve(repository, "outputs/coupon-three-source-e2e");
  const output = resolve(repository, path);
  const relation = relative(allowedRoot, output);
  if (relation.startsWith("..") || relation.includes("../")) {
    throw new Error("fixture output must be inside outputs/coupon-three-source-e2e");
  }
  return output;
}

const output = assertOutputPath(
  argument("--output") ?? "outputs/coupon-three-source-e2e/generated/fixtures",
);
const requestedCase = argument("--case")?.toUpperCase();
const cases = requestedCase
  ? couponThreeSourceE2eCases.filter((item) => item.id === requestedCase)
  : couponThreeSourceE2eCases;

if (requestedCase && cases.length !== 1) {
  throw new Error(`unknown E2E case id: ${requestedCase}`);
}

const index = {
  schemaVersion: "coupon-three-source-e2e-fixtures-v1",
  generatedAt: new Date().toISOString(),
  caseCount: cases.length,
  workbookCount: 0,
  cases: [],
};

await mkdir(output, { recursive: true });
for (const item of cases) {
  const caseDirectory = resolve(output, item.id);
  await mkdir(caseDirectory, { recursive: true });
  const workbooks = [];
  for (const recipe of item.inputs.workbooks) {
    for (let variant = 1; variant <= recipe.variants; variant += 1) {
      const generated = await buildE2eWorkbook({
        recipe: recipe.recipe,
        variant,
      });
      const path = resolve(caseDirectory, generated.fileName);
      await writeFile(path, generated.bytes, { flag: "wx", mode: 0o600 });
      workbooks.push({
        role: recipe.role,
        path: relative(output, path),
        fileName: generated.fileName,
        bytes: generated.bytes.byteLength,
        sha256: generated.sha256,
        semanticFingerprint: generated.semanticFingerprint,
        recipe: recipe.recipe,
        variant,
      });
      index.workbookCount += 1;
    }
  }
  index.cases.push({ id: item.id, workbooks });
}

await writeFile(
  resolve(output, "fixture-index.json"),
  `${JSON.stringify(index, null, 2)}\n`,
  { flag: "wx", mode: 0o600 },
);

process.stdout.write(
  `${JSON.stringify({ output, caseCount: index.caseCount, workbookCount: index.workbookCount })}\n`,
);
