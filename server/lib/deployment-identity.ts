import { isCouponOaDraftStoreConfigured } from "./feishu/coupon-oa/config";

const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;

export class DeploymentIdentityUnavailableError extends Error {}

export function getDeploymentIdentity(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const gitCommitSha = environment.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase();
  if (!gitCommitSha || !GIT_SHA_PATTERN.test(gitCommitSha)) {
    throw new DeploymentIdentityUnavailableError(
      "Deployment Git commit identity is unavailable",
    );
  }

  return {
    gitCommitSha,
    environment: environment.VERCEL_ENV?.trim() || "unknown",
    readiness: {
      couponOaDraftStoreConfigured: isCouponOaDraftStoreConfigured(environment),
    },
  } as const;
}
