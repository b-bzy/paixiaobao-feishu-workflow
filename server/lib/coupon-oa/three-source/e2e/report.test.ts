import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeCouponThreeSourceE2eReport } from "./report";

describe("coupon three-source E2E report", () => {
  it("writes grouped redacted JSON and Chinese Markdown", async () => {
    const directory = await mkdtemp(join(tmpdir(), "coupon-e2e-report-"));
    const paths = await writeCouponThreeSourceE2eReport({
      outputDirectory: directory,
      runId: "run-test",
      lanes: { fast: "passed", durable: "infrastructure_failure" },
      results: [
        {
          caseId: "F01",
          classification: "passed",
          revision: 1,
          code: undefined,
          artifactRoles: ["couponTable"],
          effectIds: [],
        },
        {
          caseId: "F02",
          classification: "expected_block",
          revision: 0,
          code: "FILE_EMPTY",
          artifactRoles: [],
          effectIds: [],
        },
      ],
      boundary: {
        networkCalls: 0,
        nativeOaCreated: false,
        feishuVerified: false,
      },
    });
    const json = await readFile(paths.json, "utf8");
    const markdown = await readFile(paths.markdown, "utf8");
    expect(json).toContain("FILE_EMPTY");
    expect(markdown).toContain("基础设施失败");
    expect(markdown).toContain("飞书端未验证");
    expect(`${json}${markdown}`).not.toContain("open_id");
    expect(`${json}${markdown}`).not.toContain("secret");
  });
});
