import { createHash } from "node:crypto";

const manifestPaths = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "apps/miaoda-admin/package.json",
];
const expectedMigrationFiles = [
  "0001_durable_control_plane.sql",
  "0002_durable_command_intake.sql",
  "0003_add_delivery_chat_id.sql",
  "0004_durable_effect_worker.sql",
];
const allowedCommandIds = new Set([
  "pnpm-lint",
  "pnpm-typecheck-server",
  "pnpm-typecheck-admin",
  "pnpm-test",
  "pnpm-build",
  "pnpm-build-admin",
  "git-diff-check",
  "migration-repeat",
  "control-plane-postgres",
]);
const allowedCommandResults = new Set(["passed", "failed", "not_run"]);
const imageDigestPattern =
  /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/u;
const auditRunIdPattern =
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const releaseTagPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, keys, message) {
  if (!isPlainObject(value)) throw new Error(message);
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(message);
  }
}

function isGitSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(value);
}

function assertSafeRuntimeValue(value) {
  return typeof value === "string" && /^[a-z0-9._-]+$/iu.test(value);
}

function hasUnsafeTrackedInput(path) {
  const name = path.split("/").at(-1) ?? "";
  return (
    name.startsWith(".env") ||
    name === ".npmrc" ||
    name.startsWith(".pnpmfile.") ||
    name.startsWith(".yarnrc") ||
    /(?:credential|secret|private|certificate|\.pem$|\.key$|\.p12$|\.pfx$)/iu.test(
      name,
    )
  );
}

function rejectUnsafeCandidateSource() {
  throw new Error("Candidate source inputs are not clean");
}

export function assertCandidateSourceInputs(input) {
  if (!isPlainObject(input)) rejectUnsafeCandidateSource();
  const {
    trackedFiles,
    untrackedFiles,
    ignoredFiles,
    scratchFiles,
    hasGlobalGitConfig,
  } = input;
  if (
    !Array.isArray(trackedFiles) ||
    !Array.isArray(untrackedFiles) ||
    !Array.isArray(ignoredFiles) ||
    !Array.isArray(scratchFiles) ||
    typeof hasGlobalGitConfig !== "boolean"
  ) {
    rejectUnsafeCandidateSource();
  }
  if (
    untrackedFiles.length ||
    ignoredFiles.length ||
    scratchFiles.length ||
    hasGlobalGitConfig ||
    trackedFiles.some((path) =>
      typeof path !== "string" || hasUnsafeTrackedInput(path),
    )
  ) {
    rejectUnsafeCandidateSource();
  }
}

function assertCleanCandidateStatus(status, diffCheck) {
  if (!status?.clean) throw new Error("Release baseline source is not clean");
  if (!diffCheck?.clean) {
    throw new Error("Release baseline source has whitespace errors");
  }
}

function assertCandidateGitIdentity({ objectType, tagObjectSha, peeledCommitSha, headCommitSha, objectFormat }) {
  if (objectType !== "tag") {
    throw new Error("Release baseline requires an annotated tag");
  }
  if (objectFormat !== "sha1" && objectFormat !== "sha256") {
    throw new Error("Release baseline Git object format is invalid");
  }
  const requiredLength = objectFormat === "sha1" ? 40 : 64;
  if (
    ![tagObjectSha, peeledCommitSha, headCommitSha].every(
      (value) =>
        isGitSha(value) && value.length === requiredLength,
    )
  ) {
    throw new Error("Release baseline Git identity is invalid");
  }
  if (peeledCommitSha !== headCommitSha) {
    throw new Error("Release baseline tag does not match HEAD");
  }
}

async function fingerprintFiles(files) {
  const manifestHashes = {};
  for (const path of manifestPaths) {
    const content = await files.readFile(path);
    if (typeof content !== "string") {
      throw new Error("Release baseline manifest input is missing");
    }
    manifestHashes[path] = sha256(content);
  }

  const migrationFiles = (await files.listMigrationFiles()).sort();
  if (
    migrationFiles.length !== expectedMigrationFiles.length ||
    migrationFiles.some((file, index) => file !== expectedMigrationFiles[index])
  ) {
    throw new Error("Release baseline migration set is invalid");
  }

  const migrationHashes = {};
  for (const file of migrationFiles) {
    const content = await files.readFile(`infra/postgres/migrations/${file}`);
    if (typeof content !== "string") {
      throw new Error("Release baseline migration input is missing");
    }
    migrationHashes[file] = sha256(content);
  }

  return { manifestHashes, migrationHashes };
}

function assertRuntime(runtime) {
  if (!isPlainObject(runtime)) {
    throw new Error("Release baseline runtime identity is invalid");
  }
  const { nodeVersion, pnpmVersion, platform, arch } = runtime;
  if (
    !/^v?\d+\.\d+\.\d+$/u.test(nodeVersion ?? "") ||
    !/^\d+\.\d+\.\d+$/u.test(pnpmVersion ?? "") ||
    !assertSafeRuntimeValue(platform) ||
    !assertSafeRuntimeValue(arch)
  ) {
    throw new Error("Release baseline runtime identity is invalid");
  }
  return { nodeVersion, pnpmVersion, platform, arch };
}

export async function inspectReleaseBaselineIdentity(input) {
  if (!isPlainObject(input) || !input.git || !input.files) {
    throw new Error("Release baseline inspection input is invalid");
  }

  const { git, files, sourceInputs, releaseTag } = input;
  if (
    typeof releaseTag !== "string" ||
    !releaseTagPattern.test(releaseTag) ||
    releaseTag.includes("..")
  ) {
    throw new Error("Release baseline tag is invalid");
  }
  assertCandidateSourceInputs(sourceInputs);
  const [status, diffCheck, objectType, tagObjectSha, peeledCommitSha, headCommitSha, objectFormat, gitVersion] =
    await Promise.all([
      git.status(),
      git.diffCheck(),
      git.objectType(releaseTag),
      git.tagObjectSha(releaseTag),
      git.peeledCommitSha(releaseTag),
      git.headCommitSha(),
      git.objectFormat(),
      git.version(),
    ]);

  assertCleanCandidateStatus(status, diffCheck);
  assertCandidateGitIdentity({
    objectType,
    tagObjectSha,
    peeledCommitSha,
    headCommitSha,
    objectFormat,
  });
  if (!/^\d+\.\d+\.\d+$/u.test(gitVersion ?? "")) {
    throw new Error("Release baseline Git identity is invalid");
  }

  const fingerprints = await fingerprintFiles(files);
  return Object.freeze({
    schemaVersion: "fdev001-identity-v1",
    tagObjectSha,
    peeledCommitSha,
    headCommitSha,
    objectFormat,
    gitVersion,
    runtime: assertRuntime(input.runtime),
    ...fingerprints,
  });
}

export async function recheckReleaseBaselineIdentity(input, initialIdentity) {
  const currentIdentity = await inspectReleaseBaselineIdentity(input);
  if (JSON.stringify(currentIdentity) !== JSON.stringify(initialIdentity)) {
    throw new Error("Release baseline identity drift");
  }
  return currentIdentity;
}

export function parseRunnerPolicy(value) {
  const invalid = () => {
    throw new Error("Invalid runner policy");
  };
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "noEgressPolicyId",
      "noEgressImage",
      "postgresOnlyPolicyId",
      "postgresOnlyImage",
      "postgresTarget",
      "dockerEngineMajor",
      "auditRunId",
    ],
    "Invalid runner policy",
  );
  if (
    value.schemaVersion !== "fdev001-runner-policy-v1" ||
    value.noEgressPolicyId !== "fdev001-no-egress-v1" ||
    value.postgresOnlyPolicyId !== "fdev001-postgres-only-v1" ||
    value.postgresTarget !== "fdev001-postgres17-isolated-v1" ||
    value.dockerEngineMajor !== 28 ||
    !imageDigestPattern.test(value.noEgressImage) ||
    !imageDigestPattern.test(value.postgresOnlyImage) ||
    !auditRunIdPattern.test(value.auditRunId)
  ) {
    invalid();
  }
  return Object.freeze({ ...value });
}

function assertManifestCandidate(value) {
  assertExactKeys(
    value,
    ["tagObjectSha", "peeledCommitSha", "headCommitSha"],
    "Invalid baseline manifest",
  );
  if (
    !isGitSha(value.tagObjectSha) ||
    !isGitSha(value.peeledCommitSha) ||
    !isGitSha(value.headCommitSha) ||
    value.peeledCommitSha !== value.headCommitSha
  ) {
    throw new Error("Invalid baseline manifest");
  }
}

function assertManifestCommands(value) {
  if (!Array.isArray(value)) throw new Error("Invalid baseline manifest");
  for (const command of value) {
    assertExactKeys(
      command,
      ["id", "result", "exitCode", "durationMs"],
      "Invalid baseline manifest",
    );
    if (
      !allowedCommandIds.has(command.id) ||
      !allowedCommandResults.has(command.result) ||
      !Number.isInteger(command.exitCode) ||
      command.exitCode < 0 ||
      command.exitCode > 255 ||
      !Number.isInteger(command.durationMs) ||
      command.durationMs < 0 ||
      command.durationMs > 86_400_000
    ) {
      throw new Error("Invalid baseline manifest");
    }
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nestedValue of Object.values(value)) deepFreeze(nestedValue);
  }
  return value;
}

export function buildSafeBaselineManifest(input) {
  assertExactKeys(
    input,
    ["schemaVersion", "createdAt", "candidate", "policy", "commands"],
    "Unknown baseline manifest field",
  );
  if (
    input.schemaVersion !== "fdev001-baseline-manifest-v1" ||
    Number.isNaN(Date.parse(input.createdAt)) ||
    new Date(input.createdAt).toISOString() !== input.createdAt
  ) {
    throw new Error("Invalid baseline manifest");
  }
  assertManifestCandidate(input.candidate);
  const policy = parseRunnerPolicy(input.policy);
  assertManifestCommands(input.commands);

  return deepFreeze({
    schemaVersion: input.schemaVersion,
    createdAt: input.createdAt,
    candidate: { ...input.candidate },
    policy,
    commands: input.commands.map((command) => ({ ...command })),
  });
}
