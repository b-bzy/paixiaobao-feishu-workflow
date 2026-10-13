import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearP0PreviewState,
  loadP0PreviewConfig,
  readP0PreviewState,
  writeP0PreviewState,
} from "./lib/p0-preview-config.mjs";
import { deployP0Preview, verifyP0Preview } from "./lib/p0-preview-deploy.mjs";

const expectedBranch = "p0-three-source-direct-http";
const statePath = ".local/p0-preview-state.json";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function repositoryFacts({ requireClean = true } = {}) {
  const branch = git("branch", "--show-current");
  const gitCommitSha = git("rev-parse", "HEAD");
  if (branch !== expectedBranch) {
    throw new Error(`当前分支必须是 ${expectedBranch}`);
  }
  if (requireClean && git("status", "--short")) {
    throw new Error("工作区存在未提交修改，拒绝部署无法复现的 Preview");
  }
  const project = JSON.parse(
    execFileSync("node", ["-e", "process.stdout.write(require('fs').readFileSync('.vercel/project.json','utf8'))"], {
      encoding: "utf8",
    }),
  );
  if (project.projectName !== "aihuishou-feishu-workflow") {
    throw new Error("当前目录未关联目标 Vercel 项目");
  }
  return { branch, gitCommitSha, projectName: project.projectName };
}

function processCommand(pid) {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

function ownedProcess(pid, expectedScript) {
  return Number.isInteger(pid) && processCommand(pid).includes(expectedScript);
}

function matchingProcessIds(expectedScript) {
  return execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" })
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.includes(expectedScript))
    .map((line) => Number.parseInt(line.split(/\s+/u)[0] ?? "", 10))
    .filter((pid) => Number.isInteger(pid) && pid !== process.pid);
}

async function check() {
  const facts = repositoryFacts();
  await loadP0PreviewConfig();
  const state = await readP0PreviewState(statePath);
  for (const [pid, script] of [
    [state?.bridgePid, "scripts/long-connection-bridge.mjs"],
    [state?.workerPid, "scripts/run-p0-control-plane-worker.mjs"],
  ]) {
    if (ownedProcess(pid, script)) throw new Error("已有 P0 runner 正在运行，请先执行 down");
    if (matchingProcessIds(script).length > 0) {
      throw new Error(`检测到未登记的 ${basename(script)} 进程，拒绝重复启动`);
    }
  }
  return facts;
}

async function deploy() {
  const facts = await check();
  const config = await loadP0PreviewConfig();
  const deployed = await deployP0Preview({
    branch: facts.branch,
    gitCommitSha: facts.gitCommitSha,
    bypassSecret: config.VERCEL_AUTOMATION_BYPASS_SECRET,
  });
  const state = {
    projectName: facts.projectName,
    branch: facts.branch,
    gitCommitSha: facts.gitCommitSha,
    deploymentUrl: deployed.deploymentUrl,
    deployedAt: new Date().toISOString(),
  };
  await writeP0PreviewState(statePath, state);
  return state;
}

async function startChild(script, environment, logPath) {
  mkdirSync(resolve(".local"), { recursive: true, mode: 0o700 });
  const log = openSync(logPath, "a", 0o600);
  const child = spawn(process.execPath, [script], {
    cwd: process.cwd(),
    env: environment,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  if (!ownedProcess(child.pid, script)) throw new Error(`${basename(script)} 启动失败`);
  return child.pid;
}

async function up() {
  const facts = await check();
  const config = await loadP0PreviewConfig();
  const existingState = await readP0PreviewState(statePath);
  let state;
  if (existingState?.gitCommitSha === facts.gitCommitSha) {
    await verifyP0Preview({
      deploymentUrl: existingState.deploymentUrl,
      gitCommitSha: facts.gitCommitSha,
      bypassSecret: config.VERCEL_AUTOMATION_BYPASS_SECRET,
    });
    state = existingState;
  } else {
    const deployed = await deployP0Preview({
      branch: facts.branch,
      gitCommitSha: facts.gitCommitSha,
      bypassSecret: config.VERCEL_AUTOMATION_BYPASS_SECRET,
    });
    state = {
      projectName: facts.projectName,
      branch: facts.branch,
      gitCommitSha: facts.gitCommitSha,
      deploymentUrl: deployed.deploymentUrl,
      deployedAt: new Date().toISOString(),
    };
    await writeP0PreviewState(statePath, state);
  }
  const environment = {
    ...process.env,
    ...config,
    FEISHU_BRIDGE_P0_MODE: "true",
    FEISHU_BRIDGE_TARGET_URL: `${state.deploymentUrl}/api/feishu/poc-bridge`,
    FEISHU_P0_EXPECTED_GIT_SHA: state.gitCommitSha,
    FEISHU_BRIDGE_EVENT_TYPES: "im.message.receive_v1,card.action.trigger",
  };
  let bridgePid;
  try {
    bridgePid = await startChild(
      "scripts/long-connection-bridge.mjs",
      environment,
      ".local/p0-preview-bridge.log",
    );
    const workerPid = await startChild(
      "scripts/run-p0-control-plane-worker.mjs",
      environment,
      ".local/p0-preview-worker.log",
    );
    await writeP0PreviewState(statePath, { ...state, bridgePid, workerPid });
    return { ...state, bridgePid, workerPid };
  } catch (error) {
    if (ownedProcess(bridgePid, "scripts/long-connection-bridge.mjs")) {
      process.kill(bridgePid, "SIGTERM");
    }
    throw error;
  }
}

async function status() {
  const state = await readP0PreviewState(statePath);
  if (!state) return { configured: false };
  const config = await loadP0PreviewConfig();
  const verified = await verifyP0Preview({
    deploymentUrl: state.deploymentUrl,
    gitCommitSha: state.gitCommitSha,
    bypassSecret: config.VERCEL_AUTOMATION_BYPASS_SECRET,
  });
  return {
    configured: true,
    deploymentUrl: verified.deploymentUrl,
    gitCommitSha: verified.gitCommitSha,
    bridgeRunning: ownedProcess(
      state.bridgePid,
      "scripts/long-connection-bridge.mjs",
    ),
    workerRunning: ownedProcess(
      state.workerPid,
      "scripts/run-p0-control-plane-worker.mjs",
    ),
  };
}

async function down() {
  const state = await readP0PreviewState(statePath);
  if (!state) return { stopped: false };
  for (const [pid, script] of [
    [state.workerPid, "scripts/run-p0-control-plane-worker.mjs"],
    [state.bridgePid, "scripts/long-connection-bridge.mjs"],
  ]) {
    if (pid && !ownedProcess(pid, script)) {
      throw new Error(`PID ${pid} 不属于当前 P0 会话，拒绝停止`);
    }
    if (pid) process.kill(pid, "SIGTERM");
  }
  await clearP0PreviewState(statePath);
  return { stopped: true };
}

export async function runP0PreviewCommand(command) {
  if (command === "check") return check();
  if (command === "deploy") return deploy();
  if (command === "up") return up();
  if (command === "status") return status();
  if (command === "down") return down();
  throw new Error("用法：p0-preview.mjs check|deploy|up|status|down");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runP0PreviewCommand(process.argv[2])
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "P0 Preview 操作失败");
      process.exitCode = 1;
    });
}
