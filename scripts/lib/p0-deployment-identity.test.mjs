import { describe, expect, it, vi } from "vitest";

import {
  deploymentIdentityUrl,
  parseExpectedGitCommitSha,
  verifyP0DeploymentIdentity,
} from "./p0-deployment-identity.mjs";

const expectedGitCommitSha = "74bd72e319582a1bf05be812bff2d2508208c2e3";
const target = new URL(
  "https://preview.example.com/api/feishu/poc-bridge",
);

describe("P0 deployment identity", () => {
  it("derives one immutable deployment identity endpoint from the target", () => {
    expect(deploymentIdentityUrl(target).href).toBe(
      "https://preview.example.com/api/deployment-identity",
    );
  });

  it("requires a full Git commit SHA", () => {
    expect(() => parseExpectedGitCommitSha("74bd72e")).toThrow(
      "full 40-character Git commit SHA",
    );
  });

  it("accepts only the exact expected deployment and forwards protection bypass", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        result: {
          gitCommitSha: expectedGitCommitSha,
          readiness: { couponOaDraftStoreConfigured: true },
        },
      }),
    }));

    await expect(
      verifyP0DeploymentIdentity({
        target,
        expectedGitCommitSha,
        vercelAutomationBypassSecret: "preview-bypass",
        fetchImpl,
      }),
    ).resolves.toEqual({ gitCommitSha: expectedGitCommitSha });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://preview.example.com/api/deployment-identity"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-vercel-protection-bypass": "preview-bypass",
        }),
      }),
    );
  });

  it("fails closed before work when the deployment is stale", async () => {
    await expect(
      verifyP0DeploymentIdentity({
        target,
        expectedGitCommitSha,
        fetchImpl: vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            code: 0,
            result: {
              gitCommitSha: "04b456b1b12e201c3fbc2f55ea6c94de48189f3f",
              readiness: { couponOaDraftStoreConfigured: true },
            },
          }),
        })),
      }),
    ).rejects.toMatchObject({ code: "identity_mismatch" });
  });

  it("fails closed when an old deployment has no identity endpoint", async () => {
    await expect(
      verifyP0DeploymentIdentity({
        target,
        expectedGitCommitSha,
        fetchImpl: vi.fn(async () => ({ ok: false, status: 404 })),
      }),
    ).rejects.toMatchObject({ code: "identity_http_error" });
  });

  it("fails closed when the OA test-draft Base is missing", async () => {
    await expect(
      verifyP0DeploymentIdentity({
        target,
        expectedGitCommitSha,
        fetchImpl: vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            code: 0,
            result: {
              gitCommitSha: expectedGitCommitSha,
              readiness: { couponOaDraftStoreConfigured: false },
            },
          }),
        })),
      }),
    ).rejects.toMatchObject({
      code: "coupon_oa_draft_store_not_configured",
    });
  });
});
