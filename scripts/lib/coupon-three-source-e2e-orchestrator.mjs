import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFile = promisify(execFileCallback);

function sanitizedEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => {
      const upper = key.toUpperCase();
      return !(
        upper.startsWith("FEISHU_") ||
        upper.startsWith("VERCEL_") ||
        upper.includes("APPROVAL") ||
        upper === "DATABASE_URL" ||
        upper.startsWith("OBJECT_STORE_") ||
        upper.startsWith("DEEPSEEK_")
      );
    }),
  );
}

async function defaultRunCommand(command, args, options = {}) {
  return execFile(command, args, {
    cwd: process.cwd(),
    env: options.environment,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function durableEnvironment(environment) {
  return {
    ...sanitizedEnvironment(environment),
    CONTROL_PLANE_TEST_DATABASE_URL:
      "postgresql://aihuishou:local-development-only@127.0.0.1:5432/aihuishou_workflow",
    OBJECT_STORE_TEST_ENDPOINT: "http://127.0.0.1:9000",
    OBJECT_STORE_TEST_REGION: "us-east-1",
    OBJECT_STORE_TEST_BUCKET: "coupon-e2e-local",
    OBJECT_STORE_TEST_ACCESS_KEY_ID: "local-aihuishou",
    OBJECT_STORE_TEST_SECRET_ACCESS_KEY:
      "local-development-only-change-before-use",
    OBJECT_STORE_TEST_FORCE_PATH_STYLE: "true",
  };
}

export async function runCouponThreeSourceE2e(input) {
  const lane = input.lane;
  if (!["fast", "durable", "all", "deepseek"].includes(lane)) {
    throw new Error(`unsupported E2E lane: ${lane}`);
  }
  if (
    lane === "deepseek" &&
    input.environment.COUPON_E2E_ALLOW_DEEPSEEK !== "true"
  ) {
    throw new Error("COUPON_E2E_ALLOW_DEEPSEEK=true is required");
  }
  const runCommand = input.runCommand ?? defaultRunCommand;
  const lanes = { fast: "not_run", durable: "not_run" };
  const failures = [];
  const outputDirectory = resolve(
    process.cwd(),
    "outputs/coupon-three-source-e2e",
    input.runId,
  );

  if (lane === "fast" || lane === "all") {
    try {
      const environment = sanitizedEnvironment(input.environment);
      await runCommand(
        "node",
        [
          "--import",
          "tsx",
          "scripts/generate-coupon-three-source-e2e-fixtures.mjs",
          "--output",
          `${outputDirectory}/fixtures`,
        ],
        { environment },
      );
      await runCommand(
        "pnpm",
        [
          "exec",
          "vitest",
          "run",
          "server/lib/coupon-oa/three-source/e2e",
          "--exclude",
          "**/*.integration.test.ts",
          "--exclude",
          "**/matrix-runner.test.ts",
        ],
        { environment },
      );
      await runCommand(
        "node",
        [
          "--import",
          "tsx",
          "scripts/run-coupon-three-source-fast-matrix.mjs",
          "--output",
          outputDirectory,
        ],
        { environment },
      );
      lanes.fast = "passed";
    } catch (error) {
      lanes.fast = "failed";
      failures.push({ lane: "fast", code: "FAST_LANE_FAILED" });
    }
  }

  if (lane === "durable" || lane === "all") {
    const environment = durableEnvironment(input.environment);
    let infrastructureStarted = false;
    try {
      await runCommand("pnpm", ["infra:up"], { environment });
      infrastructureStarted = true;
      await runCommand(
        "pnpm",
        [
          "exec",
          "vitest",
          "run",
          "server/lib/control-plane/s3-canonical-object-store.integration.test.ts",
          "server/lib/control-plane/coupon-three-source-local-e2e.integration.test.ts",
        ],
        { environment },
      );
      lanes.durable = "passed";
    } catch (error) {
      lanes.durable = infrastructureStarted
        ? "failed"
        : "infrastructure_failure";
      failures.push({
        lane: "durable",
        code: infrastructureStarted
          ? "DURABLE_LANE_FAILED"
          : "DURABLE_INFRASTRUCTURE_UNAVAILABLE",
      });
    } finally {
      if (infrastructureStarted && !input.keepInfra) {
        await runCommand("pnpm", ["infra:down"], { environment }).catch(() => {
          failures.push({ lane: "durable", code: "INFRASTRUCTURE_CLEANUP_FAILED" });
        });
      }
    }
  }

  if (lane === "deepseek") {
    const environment = {
      ...sanitizedEnvironment(input.environment),
      COUPON_E2E_ALLOW_DEEPSEEK: "true",
      DEEPSEEK_API_KEY: input.environment.DEEPSEEK_API_KEY,
    };
    if (!environment.DEEPSEEK_API_KEY) {
      throw new Error("DEEPSEEK_API_KEY is required for the DeepSeek lane");
    }
    await runCommand(
      "pnpm",
      [
        "exec",
        "vitest",
        "run",
        "server/lib/coupon-oa/three-source/e2e/deepseek-contract.integration.test.ts",
      ],
      { environment },
    );
  }

  return {
    runId: input.runId,
    outputDirectory,
    lanes,
    failures,
    exitCode: failures.length ? 1 : 0,
  };
}
