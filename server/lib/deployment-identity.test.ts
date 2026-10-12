import { describe, expect, it } from "vitest";

import {
  DeploymentIdentityUnavailableError,
  getDeploymentIdentity,
} from "./deployment-identity";

describe("deployment identity", () => {
  it("returns the immutable Vercel Git commit identity", () => {
    expect(
      getDeploymentIdentity({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_SHA: "74BD72E319582A1BF05BE812BFF2D2508208C2E3",
      }),
    ).toEqual({
      environment: "preview",
      gitCommitSha: "74bd72e319582a1bf05be812bff2d2508208c2e3",
    });
  });

  it.each([undefined, "", "74bd72e", "not-a-git-sha"])(
    "fails closed for an invalid Git identity %j",
    (gitCommitSha) => {
      expect(() =>
        getDeploymentIdentity({ VERCEL_GIT_COMMIT_SHA: gitCommitSha }),
      ).toThrow(DeploymentIdentityUnavailableError);
    },
  );
});
