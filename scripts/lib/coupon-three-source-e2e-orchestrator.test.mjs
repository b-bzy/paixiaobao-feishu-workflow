import { describe, expect, it, vi } from "vitest";
import { runCouponThreeSourceE2e } from "./coupon-three-source-e2e-orchestrator.mjs";

describe("coupon three-source E2E orchestrator", () => {
  it("runs fixture generation before the fast tests", async () => {
    const calls = [];
    const runCommand = vi.fn(async (command, args) => {
      calls.push([command, ...args].join(" "));
      return { stdout: "", stderr: "" };
    });
    const result = await runCouponThreeSourceE2e({
      lane: "fast",
      runId: "test-fast",
      runCommand,
      environment: {},
    });
    expect(result.lanes).toEqual({ fast: "passed", durable: "not_run" });
    expect(calls[0]).toContain("generate-coupon-three-source-e2e-fixtures");
    expect(calls[1]).toContain("vitest run");
  });

  it("fails closed when durable infrastructure cannot start", async () => {
    const runCommand = vi.fn(async (_command, args) => {
      if (args.includes("infra:up")) throw new Error("minio unavailable");
      return { stdout: "", stderr: "" };
    });
    const result = await runCouponThreeSourceE2e({
      lane: "durable",
      runId: "test-durable",
      runCommand,
      environment: {},
    });
    expect(result.lanes.durable).toBe("infrastructure_failure");
    expect(result.exitCode).toBe(1);
  });

  it("requires explicit opt-in for DeepSeek", async () => {
    await expect(
      runCouponThreeSourceE2e({
        lane: "deepseek",
        runId: "test-ai",
        runCommand: vi.fn(),
        environment: {},
      }),
    ).rejects.toThrow(/COUPON_E2E_ALLOW_DEEPSEEK/iu);
  });
});
