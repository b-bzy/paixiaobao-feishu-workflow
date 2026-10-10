import { describe, expect, it } from "vitest";

import {
  assertCandidateSourceInputs,
  buildSafeBaselineManifest,
  inspectReleaseBaselineIdentity,
  parseRunnerPolicy,
  recheckReleaseBaselineIdentity,
} from "./feishu-dev-release-baseline.mjs";

const sha = (character) => character.repeat(40);
const imageDigest = (character) =>
  `registry.example/fdev001-runner@sha256:${character.repeat(64)}`;

function validPolicy() {
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

function validIdentityInput(overrides = {}) {
  const sourceInputs = {
    trackedFiles: ["package.json", "pnpm-lock.yaml"],
    untrackedFiles: [],
    ignoredFiles: [],
    scratchFiles: [],
    hasGlobalGitConfig: false,
  };
  const fileContents = new Map([
    ["package.json", "{\"name\":\"coupon\"}"],
    ["pnpm-lock.yaml", "lockfileVersion: '9.0'"],
    ["pnpm-workspace.yaml", "packages:\n  - apps/*"],
    ["apps/miaoda-admin/package.json", "{\"name\":\"admin\"}"],
    ["infra/postgres/migrations/0001_durable_control_plane.sql", "SELECT 1;"],
    ["infra/postgres/migrations/0002_durable_command_intake.sql", "SELECT 2;"],
    ["infra/postgres/migrations/0003_add_delivery_chat_id.sql", "SELECT 3;"],
    ["infra/postgres/migrations/0004_durable_effect_worker.sql", "SELECT 4;"],
  ]);
  const git = {
    status: async () => ({ clean: true }),
    diffCheck: async () => ({ clean: true }),
    objectType: async () => "tag",
    tagObjectSha: async () => sha("a"),
    peeledCommitSha: async () => sha("b"),
    headCommitSha: async () => sha("b"),
    objectFormat: async () => "sha1",
    version: async () => "2.47.0",
  };
  const files = {
    readFile: async (path) => fileContents.get(path),
    listMigrationFiles: async () =>
      [...fileContents.keys()]
        .filter((path) => path.startsWith("infra/postgres/migrations/"))
        .map((path) => path.split("/").at(-1)),
  };

  return {
    releaseTag: "fdev-001-candidate",
    git,
    files,
    sourceInputs,
    runtime: {
      nodeVersion: "v22.22.2",
      pnpmVersion: "10.14.0",
      platform: "linux",
      arch: "x64",
    },
    ...overrides,
  };
}

describe("FDEV-001 baseline identity", () => {
  it("captures only fixed safe candidate identity fields", async () => {
    const identity = await inspectReleaseBaselineIdentity(validIdentityInput());

    expect(identity).toMatchObject({
      schemaVersion: "fdev001-identity-v1",
      tagObjectSha: sha("a"),
      peeledCommitSha: sha("b"),
      headCommitSha: sha("b"),
      objectFormat: "sha1",
      migrationHashes: {
        "0001_durable_control_plane.sql": expect.stringMatching(/^[a-f0-9]{64}$/u),
        "0004_durable_effect_worker.sql": expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    expect(JSON.stringify(identity)).not.toContain("fdev-001-candidate");
  });

  it("binds every tag lookup to one validated candidate tag", async () => {
    const input = validIdentityInput();
    const observedTags = [];
    input.git = {
      ...input.git,
      objectType: async (tag) => {
        observedTags.push(tag);
        return "tag";
      },
      tagObjectSha: async (tag) => {
        observedTags.push(tag);
        return sha("a");
      },
      peeledCommitSha: async (tag) => {
        observedTags.push(tag);
        return sha("b");
      },
    };

    await inspectReleaseBaselineIdentity(input);

    expect(observedTags).toEqual([
      "fdev-001-candidate",
      "fdev-001-candidate",
      "fdev-001-candidate",
    ]);
    await expect(
      inspectReleaseBaselineIdentity(
        validIdentityInput({ releaseTag: "../not-a-tag" }),
      ),
    ).rejects.toThrow("Release baseline tag is invalid");
  });

  it("rejects dirty, untracked, ignored, scratch, and global-Git inputs without naming them", () => {
    for (const sourceInputs of [
      { ...validIdentityInput().sourceInputs, untrackedFiles: ["unexpected.tmp"] },
      { ...validIdentityInput().sourceInputs, ignoredFiles: [".env.local"] },
      { ...validIdentityInput().sourceInputs, scratchFiles: [".npmrc"] },
      { ...validIdentityInput().sourceInputs, hasGlobalGitConfig: true },
    ]) {
      expect(() => assertCandidateSourceInputs(sourceInputs)).toThrow(
        "Candidate source inputs are not clean",
      );
      try {
        assertCandidateSourceInputs(sourceInputs);
      } catch (error) {
        expect(String(error)).not.toContain(".env.local");
        expect(String(error)).not.toContain("unexpected.tmp");
      }
    }
  });

  it("rejects tracked runtime configuration without serializing its name", () => {
    const sourceInputs = validIdentityInput().sourceInputs;
    sourceInputs.trackedFiles.push("secrets/.env.production");

    expect(() => assertCandidateSourceInputs(sourceInputs)).toThrow(
      "Candidate source inputs are not clean",
    );
  });

  it("rejects a lightweight tag, dirty checkout, and non-zero diff check", async () => {
    await expect(
      inspectReleaseBaselineIdentity(
        validIdentityInput({
          git: { ...validIdentityInput().git, objectType: async () => "commit" },
        }),
      ),
    ).rejects.toThrow("Release baseline requires an annotated tag");

    await expect(
      inspectReleaseBaselineIdentity(
        validIdentityInput({
          git: {
            ...validIdentityInput().git,
            status: async () => ({ clean: false }),
          },
        }),
      ),
    ).rejects.toThrow("Release baseline source is not clean");

    await expect(
      inspectReleaseBaselineIdentity(
        validIdentityInput({
          git: {
            ...validIdentityInput().git,
            diffCheck: async () => ({ clean: false }),
          },
        }),
      ),
    ).rejects.toThrow("Release baseline source has whitespace errors");
  });

  it("rejects tag, commit, and source drift during the post-run recheck", async () => {
    const input = validIdentityInput();
    const initial = await inspectReleaseBaselineIdentity(input);
    const changed = validIdentityInput({
      git: {
        ...validIdentityInput().git,
        tagObjectSha: async () => sha("c"),
      },
    });

    await expect(recheckReleaseBaselineIdentity(changed, initial)).rejects.toThrow(
      "Release baseline identity drift",
    );
  });
});

describe("FDEV-001 closed policy and manifest contracts", () => {
  it("accepts only the fixed policy vocabulary and digest-pinned images", () => {
    expect(parseRunnerPolicy(validPolicy())).toEqual(validPolicy());

    expect(() =>
      parseRunnerPolicy({ ...validPolicy(), unexpected: "value" }),
    ).toThrow("Invalid runner policy");
    expect(() =>
      parseRunnerPolicy({ ...validPolicy(), noEgressImage: "node:22" }),
    ).toThrow("Invalid runner policy");
    expect(() =>
      parseRunnerPolicy({
        ...validPolicy(),
        auditRunId: "https://user:secret@example.test/audit",
      }),
    ).toThrow("Invalid runner policy");
  });

  it("serializes only safe candidate, policy, and command data", () => {
    const manifest = buildSafeBaselineManifest({
      schemaVersion: "fdev001-baseline-manifest-v1",
      createdAt: "2026-10-10T00:00:00.000Z",
      candidate: {
        tagObjectSha: sha("a"),
        peeledCommitSha: sha("b"),
        headCommitSha: sha("b"),
      },
      policy: validPolicy(),
      commands: [
        {
          id: "pnpm-test",
          result: "passed",
          exitCode: 0,
          durationMs: 1234,
        },
      ],
    });

    expect(manifest.commands).toEqual([
      { id: "pnpm-test", result: "passed", exitCode: 0, durationMs: 1234 },
    ]);
    expect(Object.isFrozen(manifest)).toBe(true);
  });

  it("rejects unknown, URL, credential, raw-output, and path-shaped manifest fields", () => {
    const input = {
      schemaVersion: "fdev001-baseline-manifest-v1",
      createdAt: "2026-10-10T00:00:00.000Z",
      candidate: {
        tagObjectSha: sha("a"),
        peeledCommitSha: sha("b"),
        headCommitSha: sha("b"),
      },
      policy: validPolicy(),
      commands: [],
    };

    expect(() =>
      buildSafeBaselineManifest({
        ...input,
        commandOutput: "postgresql://user:password@example.test/live",
      }),
    ).toThrow("Unknown baseline manifest field");
    expect(() =>
      buildSafeBaselineManifest({
        ...input,
        candidate: { ...input.candidate, tagObjectSha: "/tmp/candidate" },
      }),
    ).toThrow("Invalid baseline manifest");
    expect(() =>
      buildSafeBaselineManifest({
        ...input,
        commands: [
          {
            id: "pnpm-test",
            result: "passed",
            exitCode: 0,
            durationMs: 1,
            error: "raw stderr must never be recorded",
          },
        ],
      }),
    ).toThrow("Invalid baseline manifest");
  });
});
