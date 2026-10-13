import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { verifyP0DeploymentIdentity } from "./p0-deployment-identity.mjs";

const execFileAsync = promisify(execFile);

export function deploymentUrlFromStdout(stdout) {
  const urls = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^https:\/\/[^/]+\.vercel\.app$/u.test(line));
  if (urls.length !== 1) {
    throw new Error("Vercel 部署输出没有唯一 Preview URL");
  }
  return urls[0];
}

export async function deployP0Preview({
  branch,
  gitCommitSha,
  bypassSecret,
  cwd = process.cwd(),
  runCommand = async (file, args, options) => execFileAsync(file, args, options),
  fetchImpl = fetch,
}) {
  if (branch !== "p0-three-source-direct-http") {
    throw new Error("P0 Preview 只能从 p0-three-source-direct-http 分支部署");
  }
  if (!/^[0-9a-f]{40}$/u.test(gitCommitSha)) throw new Error("Git SHA 格式无效");
  const { stdout } = await runCommand(
    "pnpm",
    [
      "dlx",
      "vercel@latest",
      "deploy",
      "--yes",
      "--meta",
      "githubDeployment=1",
      "--meta",
      `githubCommitRef=${branch}`,
      "--meta",
      `githubCommitSha=${gitCommitSha}`,
    ],
    { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  const deploymentUrl = deploymentUrlFromStdout(stdout);
  await verifyP0DeploymentIdentity({
    target: new URL(`${deploymentUrl}/api/feishu/poc-bridge`),
    expectedGitCommitSha: gitCommitSha,
    vercelAutomationBypassSecret: bypassSecret,
    fetchImpl,
    timeoutMs: 20_000,
  });
  return { deploymentUrl, gitCommitSha };
}

export async function verifyP0Preview({
  deploymentUrl,
  gitCommitSha,
  bypassSecret,
  fetchImpl = fetch,
}) {
  await verifyP0DeploymentIdentity({
    target: new URL(`${deploymentUrl}/api/feishu/poc-bridge`),
    expectedGitCommitSha: gitCommitSha,
    vercelAutomationBypassSecret: bypassSecret,
    fetchImpl,
  });
  return { deploymentUrl, gitCommitSha, healthy: true };
}
