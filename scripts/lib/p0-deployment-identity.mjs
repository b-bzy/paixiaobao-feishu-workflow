const gitShaPattern = /^[0-9a-f]{40}$/u;
const identityPath = "/api/deployment-identity";

export class P0DeploymentIdentityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "P0DeploymentIdentityError";
    this.code = code;
  }
}

export function parseExpectedGitCommitSha(value) {
  const gitCommitSha = value?.trim().toLowerCase();
  if (!gitCommitSha || !gitShaPattern.test(gitCommitSha)) {
    throw new P0DeploymentIdentityError(
      "invalid_expected_git_sha",
      "FEISHU_P0_EXPECTED_GIT_SHA must be a full 40-character Git commit SHA",
    );
  }
  return gitCommitSha;
}

export function deploymentIdentityUrl(target) {
  return new URL(identityPath, target.origin);
}

export async function verifyP0DeploymentIdentity({
  target,
  expectedGitCommitSha,
  vercelAutomationBypassSecret,
  fetchImpl = fetch,
  timeoutMs = 10_000,
}) {
  const expected = parseExpectedGitCommitSha(expectedGitCommitSha);
  const headers = { accept: "application/json" };
  if (vercelAutomationBypassSecret) {
    headers["x-vercel-protection-bypass"] = vercelAutomationBypassSecret;
  }

  let response;
  try {
    response = await fetchImpl(deploymentIdentityUrl(target), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new P0DeploymentIdentityError(
      "identity_unreachable",
      "P0 deployment identity check failed before receiving a response",
    );
  }
  if (!response.ok) {
    throw new P0DeploymentIdentityError(
      "identity_http_error",
      `P0 deployment identity check received HTTP ${response.status}`,
    );
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new P0DeploymentIdentityError(
      "identity_invalid_response",
      "P0 deployment identity response is not valid JSON",
    );
  }
  const actual = body?.result?.gitCommitSha?.trim().toLowerCase();
  if (!actual || !gitShaPattern.test(actual)) {
    throw new P0DeploymentIdentityError(
      "identity_missing_git_sha",
      "P0 deployment identity response does not contain a full Git commit SHA",
    );
  }
  if (actual !== expected) {
    throw new P0DeploymentIdentityError(
      "identity_mismatch",
      `P0 deployment identity mismatch: expected ${expected.slice(0, 7)}, received ${actual.slice(0, 7)}`,
    );
  }
  if (body?.result?.readiness?.couponOaDraftStoreConfigured !== true) {
    throw new P0DeploymentIdentityError(
      "coupon_oa_draft_store_not_configured",
      "P0 Preview 缺少 OA 测试稿 Base 配置",
    );
  }

  return { gitCommitSha: actual };
}
