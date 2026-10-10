import { spawn } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const baselineCommandTimeoutMs = 300_000;
const terminationGraceMs = 10_000;
const allowedLanes = new Set(["no-egress", "postgres-only"]);

const laneCommands = {
  "no-egress": [
    {
      id: "pnpm-install-offline",
      command: "pnpm",
      args: ["install", "--frozen-lockfile", "--offline"],
    },
    { id: "pnpm-lint", command: "pnpm", args: ["lint"] },
    {
      id: "pnpm-typecheck-server",
      command: "pnpm",
      args: ["typecheck:server"],
    },
    {
      id: "pnpm-typecheck-admin",
      command: "pnpm",
      args: ["typecheck:admin"],
    },
    { id: "pnpm-test", command: "pnpm", args: ["test"] },
    { id: "pnpm-build", command: "pnpm", args: ["build"] },
    {
      id: "pnpm-build-admin",
      command: "pnpm",
      args: ["build:admin"],
    },
    { id: "git-diff-check", command: "git", args: ["diff", "--check"] },
  ],
  "postgres-only": [
    {
      id: "db-migrate-test-first",
      command: "pnpm",
      args: ["db:migrate:control-plane:test"],
    },
    {
      id: "db-migrate-test-repeat",
      command: "pnpm",
      args: ["db:migrate:control-plane:test"],
    },
    {
      id: "control-plane-postgres",
      command: "pnpm",
      args: ["test:control-plane:postgres"],
    },
  ],
};

function assertLane(lane) {
  if (!allowedLanes.has(lane)) throw new Error("Invalid FDEV-001 lane");
}

function safeEnvironmentValue(value) {
  return typeof value === "string" && value.length > 0 && !/[\u0000\r\n]/u.test(value)
    ? value
    : undefined;
}

function validTestDatabaseUrl(value) {
  return typeof value === "string" && /^postgres(?:ql)?:\/\//iu.test(value);
}

function safeCommandResult(command, result) {
  const exitCode =
    Number.isInteger(result?.exitCode) && result.exitCode >= 0 && result.exitCode <= 255
      ? result.exitCode
      : 1;
  const durationMs =
    Number.isInteger(result?.durationMs) && result.durationMs >= 0
      ? result.durationMs
      : 0;
  return {
    id: command.id,
    result: result?.timedOut ? "timed_out" : exitCode === 0 ? "passed" : "failed",
    exitCode,
    durationMs,
  };
}

export function parseInnerVerifierArguments(argv) {
  if (
    argv.length !== 2 ||
    argv[0] !== "--lane" ||
    !allowedLanes.has(argv[1])
  ) {
    throw new Error("Invalid FDEV-001 verifier arguments");
  }
  return { lane: argv[1] };
}

export function commandsForBaselineLane(lane) {
  assertLane(lane);
  return laneCommands[lane].map((command) => ({
    ...command,
    args: [...command.args],
  }));
}

export function sanitizeBaselineChildEnvironment({
  lane,
  inheritedEnvironment,
  controlPlaneTestDatabaseUrl,
}) {
  assertLane(lane);
  const environment = { NODE_ENV: "test" };
  for (const name of ["PATH", "HOME", "LANG", "TZ", "PNPM_HOME"]) {
    const value = safeEnvironmentValue(inheritedEnvironment?.[name]);
    if (value) environment[name] = value;
  }

  if (lane === "postgres-only") {
    if (!validTestDatabaseUrl(controlPlaneTestDatabaseUrl)) {
      throw new Error(
        "CONTROL_PLANE_TEST_DATABASE_URL is required for postgres-only lane",
      );
    }
    environment.CONTROL_PLANE_TEST_DATABASE_URL = controlPlaneTestDatabaseUrl;
  }
  return environment;
}

export async function readPostgresLaneTestDatabaseUrl({
  lane,
  environment,
  readSecret = readFile,
}) {
  assertLane(lane);
  if (lane !== "postgres-only") return undefined;

  const secretPath = environment?.CONTROL_PLANE_TEST_DATABASE_URL_FILE;
  if (secretPath) {
    if (secretPath !== "/run/secrets/control_plane_test_database_url") {
      throw new Error("Invalid PostgreSQL lane secret source");
    }
    const value = (await readSecret(secretPath, "utf8")).trim();
    if (validTestDatabaseUrl(value)) return value;
  }

  if (validTestDatabaseUrl(environment?.CONTROL_PLANE_TEST_DATABASE_URL)) {
    return environment.CONTROL_PLANE_TEST_DATABASE_URL;
  }
  throw new Error("CONTROL_PLANE_TEST_DATABASE_URL is required for postgres-only lane");
}

export function spawnBaselineCommand({
  command,
  args,
  cwd,
  environment,
  timeoutMs = baselineCommandTimeoutMs,
  spawnImpl = spawn,
  now = Date.now,
}) {
  return new Promise((resolveResult) => {
    const startedAt = now();
    let settled = false;
    let timedOut = false;
    let killTimer;
    let timeout;

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      resolveResult({
        exitCode: result.exitCode,
        durationMs: Math.max(0, now() - startedAt),
        timedOut,
      });
    }

    let child;
    try {
      child = spawnImpl(command, args, {
        cwd,
        env: environment,
        shell: false,
        stdio: "ignore",
      });
    } catch {
      finish({ exitCode: 1 });
      return;
    }

    child.once("error", () => finish({ exitCode: 1 }));
    child.once("exit", (code) => finish({ exitCode: code ?? 1 }));
    timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), terminationGraceMs);
    }, timeoutMs);
  });
}

export async function runBaselineInnerVerifier({
  lane,
  sourceDirectory,
  scratchDirectory,
  inheritedEnvironment,
  controlPlaneTestDatabaseUrl,
  copySource,
  commandRunner = spawnBaselineCommand,
  writeEvidence,
}) {
  assertLane(lane);
  const environment = sanitizeBaselineChildEnvironment({
    lane,
    inheritedEnvironment,
    controlPlaneTestDatabaseUrl,
  });
  const commands = commandsForBaselineLane(lane);
  const results = [];
  let status = "passed";

  try {
    await copySource(sourceDirectory, scratchDirectory);
  } catch {
    status = "failed";
  }

  if (status === "passed") {
    for (const command of commands) {
      const commandResult = await commandRunner({
        ...command,
        cwd: scratchDirectory,
        environment,
        timeoutMs: baselineCommandTimeoutMs,
      });
      const safeResult = safeCommandResult(command, commandResult);
      results.push(safeResult);
      if (safeResult.result !== "passed") {
        status = "failed";
        break;
      }
    }
  }

  const evidence = {
    schemaVersion: "fdev001-inner-result-v1",
    executionClass: "development_only",
    lane,
    status,
    commands: results,
  };
  await writeEvidence(`inner-${lane}.json`, evidence);
  return evidence;
}

async function copyReadonlySource(sourceDirectory, scratchDirectory) {
  await cp(sourceDirectory, scratchDirectory, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
  });
}

async function writeInnerEvidence(filename, evidence) {
  const evidenceDirectory = "/workspace/evidence";
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  await writeFile(join(evidenceDirectory, filename), `${JSON.stringify(evidence)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

async function main() {
  const { lane } = parseInnerVerifierArguments(process.argv.slice(2));
  if (process.env.FDEV001_HOST_ORCHESTRATED !== "true") {
    throw new Error("FDEV-001 inner verifier requires host orchestration");
  }
  const controlPlaneTestDatabaseUrl = await readPostgresLaneTestDatabaseUrl({
    lane,
    environment: process.env,
  });
  await runBaselineInnerVerifier({
    lane,
    sourceDirectory: "/workspace/source",
    scratchDirectory: "/workspace/scratch",
    inheritedEnvironment: process.env,
    controlPlaneTestDatabaseUrl,
    copySource: copyReadonlySource,
    writeEvidence: writeInnerEvidence,
  });
}

const scriptPath = resolve(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await main();
}
