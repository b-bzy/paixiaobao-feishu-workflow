import { expect, it } from "vitest";
import { deployP0Preview, deploymentUrlFromStdout } from "./p0-preview-deploy.mjs";

it("uses the final Vercel Preview URL from decorated CLI output", () => {
  expect(
    deploymentUrlFromStdout("https://sample-abc.vercel.app\n"),
  ).toBe("https://sample-abc.vercel.app");
  expect(
    deploymentUrlFromStdout(
      "Inspect: https://inspect.example\nReady: https://sample-abc.vercel.app [1m]\n",
    ),
  ).toBe("https://sample-abc.vercel.app");
  expect(() => deploymentUrlFromStdout("ready\n")).toThrow("Preview URL");
});

it("deploys with branch metadata and verifies identity using bypass", async () => {
  const sha = "a".repeat(40);
  let args;
  let identityHeaders;
  const result = await deployP0Preview({
    branch: "p0-three-source-direct-http",
    gitCommitSha: sha,
    bypassSecret: "bypass-secret",
    runCommand: async (_file, commandArgs) => {
      args = commandArgs;
      return { stdout: "https://sample-abc.vercel.app\n", stderr: "" };
    },
    fetchImpl: async (_url, options) => {
      identityHeaders = options.headers;
      return new Response(
        JSON.stringify({ code: 0, result: { gitCommitSha: sha } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  expect(result.deploymentUrl).toBe("https://sample-abc.vercel.app");
  expect(args).toContain("githubCommitRef=p0-three-source-direct-http");
  expect(identityHeaders["x-vercel-protection-bypass"]).toBe("bypass-secret");
});
