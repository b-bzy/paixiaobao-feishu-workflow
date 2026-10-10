import { spawnSync } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import {
  parseHermeticBaselineArguments,
  runHermeticBaselineOrchestrator,
} from "./run-feishu-dev-release-baseline-hermetic.mjs";

const sha = (character) => character.repeat(40);
const imageDigest = (character) =>
  `registry.example/fdev001-runner@sha256:${character.repeat(64)}`;

function policy() {
  return {
    schemaVersion: "fdev001-runner-policy-v1",
    noEgressPolicyId: "fdev001-no-egress-v1",
    noEgressImage: imageDigest("a"),
    postgresOnlyPolicyId: "fdev001-postgres-only-v1",
    postgresOnlyImage: imageDigest("b"),
    postgresTarget: "fdev001-postgres17-isolated-v1",
    dockerEngineMajor: 28,
    auditRunId: "12345678-1234-1234-1234-123456789abc",
  };
}

function identity() {
  return {
    schemaVersion: "fdev001-identity-v1",
    tagObjectSha: sha("a"),
    peeledCommitSha: sha("b"),
    headCommitSha: sha("b"),
  };
}

function dependencies(overrides = {}) {
  const git = {
    cloneFresh: vi.fn(async () => ({ sourceDirectory: "/isolated/source" })),
    inspectIdentity: vi.fn(async () => identity()),
    recheckIdentity: vi.fn(async () => identity()),
    removeClone: vi.fn(async () => undefined),
  };
  const docker = {
    inspectImage: vi.fn(async (image) => ({ repoDigests: [image] })),
    createEvidenceVolume: vi.fn(async () => ({ name: "fdev001-evidence", empty: true })),
    runLane: vi.fn(async ({ lane }) => ({ containerId: `${lane}-container` })),
    inspectLane: vi.fn(async ({ lane }) =>
      lane === "no-egress"
        ? {
            sourceReadOnly: true,
            evidenceVolume: "fdev001-evidence",
            networkMode: "none",
          }
        : {
            sourceReadOnly: true,
            evidenceVolume: "fdev001-evidence",
            network: {
              internal: true,
              members: ["postgres-only", "postgres"],
            },
          },
    ),
    removeEvidenceVolume: vi.fn(async () => undefined),
  };
  const files = { readProtectedPolicy: vi.fn(async () => policy()) };
  const innerLane = vi.fn(async ({ lane }) => ({
    schemaVersion: "fdev001-inner-result-v1",
    executionClass: "development_only",
    lane,
    status: "passed",
    commands: [],
  }));

  return {
    releaseTag: "fdev-001-candidate",
    git,
    docker,
    files,
    innerLane,
    idFactory: () => "run-1234",
    ...overrides,
  };
}

describe("FDEV-001 hermetic host arguments", () => {
  it("accepts only one release tag argument", () => {
    expect(
      parseHermeticBaselineArguments(["--release-tag", "fdev-001-candidate"]),
    ).toEqual({ releaseTag: "fdev-001-candidate" });

    for (const arguments_ of [
      [],
      ["--release-tag", "../candidate"],
      ["--release-tag", "candidate", "--output", "/tmp/evidence"],
      ["--runner-policy", "/tmp/policy.json"],
    ]) {
      expect(() => parseHermeticBaselineArguments(arguments_)).toThrow(
        "Invalid FDEV-001 hermetic arguments",
      );
    }
  });
  it("fails closed before it can invoke Docker outside protected CI adapters", () => {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/run-feishu-dev-release-baseline-hermetic.mjs",
        "--release-tag",
        "fdev-001-candidate",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "FDEV-001 hermetic runner requires protected CI adapters",
    );
  });
});

describe("FDEV-001 hermetic host orchestrator", () => {
  it("uses a fresh clone and completes no-egress before PostgreSQL-only", async () => {
    const input = dependencies();

    const result = await runHermeticBaselineOrchestrator(input);

    expect(input.git.cloneFresh).toHaveBeenCalledWith({
      releaseTag: "fdev-001-candidate",
      disableGlobalAndSystemConfig: true,
      noLocalClone: true,
      detached: true,
    });
    expect(input.git.inspectIdentity).toHaveBeenCalledWith({
      sourceDirectory: "/isolated/source",
      releaseTag: "fdev-001-candidate",
    });
    expect(input.docker.inspectImage).toHaveBeenCalledWith(imageDigest("a"));
    expect(input.docker.inspectImage).toHaveBeenCalledWith(imageDigest("b"));
    expect(input.docker.runLane).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ lane: "no-egress" }),
    );
    expect(input.docker.runLane).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ lane: "postgres-only" }),
    );
    expect(input.innerLane).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ lane: "no-egress" }),
    );
    expect(input.innerLane).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ lane: "postgres-only" }),
    );
    expect(input.git.recheckIdentity).toHaveBeenCalledWith({
      sourceDirectory: "/isolated/source",
      releaseTag: "fdev-001-candidate",
      initialIdentity: identity(),
    });
    expect(result).toEqual({
      schemaVersion: "fdev001-host-result-v1",
      executionClass: "host_preflight_only",
      status: "ready_for_formal_review",
      lanes: ["no-egress", "postgres-only"],
    });
    expect(JSON.stringify(result)).not.toContain("fdev-001-candidate");
    expect(input.docker.removeEvidenceVolume).toHaveBeenCalledWith("fdev001-evidence");
    expect(input.git.removeClone).toHaveBeenCalledWith("/isolated/source");
  });

  it("stops before any lane for a missing or invalid protected policy", async () => {
    const input = dependencies({
      files: { readProtectedPolicy: vi.fn(async () => ({ ...policy(), auditRunId: "missing" })) },
    });

    await expect(runHermeticBaselineOrchestrator(input)).rejects.toThrow(
      "Invalid runner policy",
    );

    expect(input.docker.inspectImage).not.toHaveBeenCalled();
    expect(input.docker.createEvidenceVolume).not.toHaveBeenCalled();
    expect(input.docker.runLane).not.toHaveBeenCalled();
    expect(input.git.removeClone).toHaveBeenCalledWith("/isolated/source");
  });

  it("rejects an image whose inspected repo digest differs from policy", async () => {
    const input = dependencies({
      docker: {
        ...dependencies().docker,
        inspectImage: vi.fn(async () => ({ repoDigests: [imageDigest("c")] })),
      },
    });

    await expect(runHermeticBaselineOrchestrator(input)).rejects.toThrow(
      "FDEV-001 runner image digest is not protected",
    );

    expect(input.docker.createEvidenceVolume).not.toHaveBeenCalled();
    expect(input.docker.runLane).not.toHaveBeenCalled();
  });

  it("rejects evidence-volume reuse or a writable source before a lane starts", async () => {
    const reused = dependencies({
      docker: {
        ...dependencies().docker,
        createEvidenceVolume: vi.fn(async () => ({ name: "old-volume", empty: false })),
      },
    });
    await expect(runHermeticBaselineOrchestrator(reused)).rejects.toThrow(
      "FDEV-001 evidence volume is not new and empty",
    );
    expect(reused.docker.runLane).not.toHaveBeenCalled();

    const writable = dependencies({
      docker: {
        ...dependencies().docker,
        inspectLane: vi.fn(async () => ({
          sourceReadOnly: false,
          evidenceVolume: "fdev001-evidence",
          networkMode: "none",
        })),
      },
    });
    await expect(runHermeticBaselineOrchestrator(writable)).rejects.toThrow(
      "FDEV-001 lane isolation is invalid",
    );
    expect(writable.innerLane).not.toHaveBeenCalled();
  });

  it("does not begin PostgreSQL-only after a failed no-egress inner result", async () => {
    const input = dependencies({
      innerLane: vi.fn(async ({ lane }) => ({
        schemaVersion: "fdev001-inner-result-v1",
        executionClass: "development_only",
        lane,
        status: lane === "no-egress" ? "failed" : "passed",
        commands: [],
      })),
    });

    await expect(runHermeticBaselineOrchestrator(input)).rejects.toThrow(
      "FDEV-001 no-egress lane failed",
    );

    expect(input.docker.runLane).toHaveBeenCalledTimes(1);
    expect(input.innerLane).toHaveBeenCalledTimes(1);
    expect(input.docker.removeEvidenceVolume).toHaveBeenCalledWith("fdev001-evidence");
    expect(input.git.removeClone).toHaveBeenCalledWith("/isolated/source");
  });

  it("rejects a PostgreSQL network with extra or external members", async () => {
    const input = dependencies({
      docker: {
        ...dependencies().docker,
        inspectLane: vi.fn(async ({ lane }) =>
          lane === "no-egress"
            ? {
                sourceReadOnly: true,
                evidenceVolume: "fdev001-evidence",
                networkMode: "none",
              }
            : {
                sourceReadOnly: true,
                evidenceVolume: "fdev001-evidence",
                network: {
                  internal: false,
                  members: ["postgres-only", "postgres", "unexpected"],
                },
              },
        ),
      },
    });

    await expect(runHermeticBaselineOrchestrator(input)).rejects.toThrow(
      "FDEV-001 lane isolation is invalid",
    );
    expect(input.innerLane).toHaveBeenCalledTimes(1);
  });
});
