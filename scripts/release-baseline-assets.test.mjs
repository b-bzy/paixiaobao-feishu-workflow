import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseRunnerPolicy } from "./lib/feishu-dev-release-baseline.mjs";

const assetsDirectory = resolve(process.cwd(), "infra/release-baseline");

describe("FDEV-001 release-baseline static assets", () => {
  it("defines exactly isolated no-egress and PostgreSQL-only lanes", async () => {
    const compose = await readFile(resolve(assetsDirectory, "compose.yml"), "utf8");

    expect(compose).toContain("no-egress:");
    expect(compose).toContain('network_mode: "none"');
    expect(compose).toContain("postgres-only:");
    expect(compose).toContain("postgres:");
    expect(compose).toContain("postgres_only:");
    expect(compose).toContain("internal: true");
    expect(compose).toContain("read_only: true");
    expect(compose).toContain("read_only: true");
    expect(compose).not.toContain("ports:");
  });

  it("requires protected runner inputs and keeps the example policy invalid", async () => {
    const [compose, dockerfile, schemaSource, exampleSource] = await Promise.all([
      readFile(resolve(assetsDirectory, "compose.yml"), "utf8"),
      readFile(resolve(assetsDirectory, "Dockerfile"), "utf8"),
      readFile(resolve(assetsDirectory, "runner-policy.schema.json"), "utf8"),
      readFile(resolve(assetsDirectory, "runner-policy.example.json"), "utf8"),
    ]);

    expect(compose).toContain("FDEV001_NO_EGRESS_IMAGE is required");
    expect(compose).toContain("FDEV001_POSTGRES_ONLY_IMAGE is required");
    expect(compose).toContain("FDEV001_EVIDENCE_VOLUME is required");
    expect(dockerfile).toContain("ARG FDEV001_RUNNER_IMAGE");
    expect(dockerfile).toContain("FROM ${FDEV001_RUNNER_IMAGE}");
    expect(dockerfile).not.toContain("COPY . ");

    const schema = JSON.parse(schemaSource);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.noEgressPolicyId.const).toBe(
      "fdev001-no-egress-v1",
    );
    expect(schema.properties.postgresTarget.const).toBe(
      "fdev001-postgres17-isolated-v1",
    );
    expect(() => parseRunnerPolicy(JSON.parse(exampleSource))).toThrow(
      "Invalid runner policy",
    );
  });
});
