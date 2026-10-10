import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  baselineCommandTimeoutMs,
  commandsForBaselineLane,
  parseInnerVerifierArguments,
  readPostgresLaneTestDatabaseUrl,
  runBaselineInnerVerifier,
  sanitizeBaselineChildEnvironment,
  spawnBaselineCommand,
} from "./verify-feishu-dev-release-baseline.mjs";

describe("FDEV-001 inner verifier", () => {
  it("accepts only one fixed lane argument", () => {
    expect(parseInnerVerifierArguments(["--lane", "no-egress"])).toEqual({
      lane: "no-egress",
    });
    expect(parseInnerVerifierArguments(["--lane", "postgres-only"])).toEqual({
      lane: "postgres-only",
    });

    for (const arguments_ of [
      [],
      ["--lane", "anything"],
      ["--lane", "no-egress", "--output", "/tmp/evidence"],
      ["--policy", "policy.json"],
    ]) {
      expect(() => parseInnerVerifierArguments(arguments_)).toThrow(
        "Invalid FDEV-001 verifier arguments",
      );
    }
  });

  it("uses immutable command allowlists for both lanes", () => {
    expect(commandsForBaselineLane("no-egress")).toEqual([
      { id: "pnpm-install-offline", command: "pnpm", args: ["install", "--frozen-lockfile", "--offline"] },
      { id: "pnpm-lint", command: "pnpm", args: ["lint"] },
      { id: "pnpm-typecheck-server", command: "pnpm", args: ["typecheck:server"] },
      { id: "pnpm-typecheck-admin", command: "pnpm", args: ["typecheck:admin"] },
      { id: "pnpm-test", command: "pnpm", args: ["test"] },
      { id: "pnpm-build", command: "pnpm", args: ["build"] },
      { id: "pnpm-build-admin", command: "pnpm", args: ["build:admin"] },
      { id: "git-diff-check", command: "git", args: ["diff", "--check"] },
    ]);
    expect(commandsForBaselineLane("postgres-only")).toEqual([
      { id: "db-migrate-test-first", command: "pnpm", args: ["db:migrate:control-plane:test"] },
      { id: "db-migrate-test-repeat", command: "pnpm", args: ["db:migrate:control-plane:test"] },
      { id: "control-plane-postgres", command: "pnpm", args: ["test:control-plane:postgres"] },
    ]);
    expect(() => commandsForBaselineLane("arbitrary-command")).toThrow(
      "Invalid FDEV-001 lane",
    );
  });

  it("strips production, proxy, package-manager, and external-service environment", () => {
    const environment = sanitizeBaselineChildEnvironment({
      lane: "no-egress",
      inheritedEnvironment: {
        PATH: "/usr/bin",
        HOME: "/home/runner",
        LANG: "C.UTF-8",
        DATABASE_URL: "postgresql://production.example/live",
        CONTROL_PLANE_TEST_DATABASE_URL: "postgresql://wrong.example/test",
        HTTP_PROXY: "https://proxy.example",
        npm_config_registry: "https://registry.example",
        NODE_OPTIONS: "--require injected.js",
        FEISHU_APP_SECRET: "secret",
        DEEPSEEK_API_KEY: "secret",
      },
    });

    expect(environment).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/runner",
      LANG: "C.UTF-8",
      NODE_ENV: "test",
    });

    expect(
      sanitizeBaselineChildEnvironment({
        lane: "postgres-only",
        inheritedEnvironment: { PATH: "/usr/bin", DATABASE_URL: "postgresql://prod" },
        controlPlaneTestDatabaseUrl: "postgresql://isolated.example/test",
      }),
    ).toEqual({
      PATH: "/usr/bin",
      NODE_ENV: "test",
      CONTROL_PLANE_TEST_DATABASE_URL: "postgresql://isolated.example/test",
    });
  });

  it("rejects a PostgreSQL lane without an orchestrator-provided test URL", () => {
    expect(() =>
      sanitizeBaselineChildEnvironment({
        lane: "postgres-only",
        inheritedEnvironment: { PATH: "/usr/bin" },
      }),
    ).toThrow("CONTROL_PLANE_TEST_DATABASE_URL is required for postgres-only lane");
  });

  it("reads the PostgreSQL URL only from the fixed container secret path", async () => {
    const readSecret = vi.fn(async () => "postgresql://isolated.example/control\n");

    await expect(
      readPostgresLaneTestDatabaseUrl({
        lane: "postgres-only",
        environment: {
          CONTROL_PLANE_TEST_DATABASE_URL_FILE:
            "/run/secrets/control_plane_test_database_url",
          DATABASE_URL: "postgresql://production.example/live",
        },
        readSecret,
      }),
    ).resolves.toBe("postgresql://isolated.example/control");
    expect(readSecret).toHaveBeenCalledWith(
      "/run/secrets/control_plane_test_database_url",
      "utf8",
    );

    await expect(
      readPostgresLaneTestDatabaseUrl({
        lane: "postgres-only",
        environment: {
          CONTROL_PLANE_TEST_DATABASE_URL_FILE: "/tmp/forbidden-secret",
        },
        readSecret,
      }),
    ).rejects.toThrow("Invalid PostgreSQL lane secret source");
  });

  it("uses argv-only spawn and terminates a timed-out child without capturing output", async () => {
    vi.useFakeTimers();
    const child = new EventEmitter();
    child.kill = vi.fn();
    const spawnImpl = vi.fn(() => child);
    const result = spawnBaselineCommand({
      command: "pnpm",
      args: ["test"],
      cwd: "/scratch",
      environment: { PATH: "/usr/bin", NODE_ENV: "test" },
      timeoutMs: 1000,
      spawnImpl,
    });

    expect(spawnImpl).toHaveBeenCalledWith("pnpm", ["test"], {
      cwd: "/scratch",
      env: { PATH: "/usr/bin", NODE_ENV: "test" },
      shell: false,
      stdio: "ignore",
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.emit("exit", null);

    await expect(result).resolves.toMatchObject({ exitCode: 1, timedOut: true });
    vi.useRealTimers();
  });

  it("copies into scratch, records safe results, and stops after first command failure", async () => {
    const copySource = vi.fn(async () => undefined);
    const writeEvidence = vi.fn(async () => undefined);
    const commandRunner = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, durationMs: 11 })
      .mockResolvedValueOnce({ exitCode: 23, durationMs: 17 });

    const result = await runBaselineInnerVerifier({
      lane: "no-egress",
      sourceDirectory: "/readonly/source",
      scratchDirectory: "/scratch",
      inheritedEnvironment: { PATH: "/usr/bin", FEISHU_APP_ID: "cli_test" },
      copySource,
      commandRunner,
      writeEvidence,
    });

    expect(copySource).toHaveBeenCalledWith("/readonly/source", "/scratch");
    expect(commandRunner).toHaveBeenCalledTimes(2);
    expect(commandRunner).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        command: "pnpm",
        args: ["install", "--frozen-lockfile", "--offline"],
        cwd: "/scratch",
        timeoutMs: baselineCommandTimeoutMs,
        environment: { PATH: "/usr/bin", NODE_ENV: "test" },
      }),
    );
    expect(writeEvidence).toHaveBeenCalledWith("inner-no-egress.json", {
      schemaVersion: "fdev001-inner-result-v1",
      executionClass: "development_only",
      lane: "no-egress",
      status: "failed",
      commands: [
        { id: "pnpm-install-offline", result: "passed", exitCode: 0, durationMs: 11 },
        { id: "pnpm-lint", result: "failed", exitCode: 23, durationMs: 17 },
      ],
    });
    expect(result).toEqual(
      expect.objectContaining({ status: "failed", executionClass: "development_only" }),
    );
    expect(JSON.stringify(result)).not.toContain("cli_test");
  });

  it("records a timeout without retaining child output or error text", async () => {
    const result = await runBaselineInnerVerifier({
      lane: "no-egress",
      sourceDirectory: "/readonly/source",
      scratchDirectory: "/scratch",
      inheritedEnvironment: { PATH: "/usr/bin" },
      copySource: vi.fn(async () => undefined),
      commandRunner: vi.fn(async () => ({
        exitCode: 1,
        durationMs: 300_000,
        timedOut: true,
        stdout: "sensitive stdout",
        stderr: "sensitive stderr",
        error: "sensitive error",
      })),
      writeEvidence: vi.fn(async () => undefined),
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "failed",
        commands: [
          {
            id: "pnpm-install-offline",
            result: "timed_out",
            exitCode: 1,
            durationMs: 300_000,
          },
        ],
      }),
    );
    expect(JSON.stringify(result)).not.toContain("sensitive");
  });
});
