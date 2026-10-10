import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseRunnerPolicy } from "./lib/feishu-dev-release-baseline.mjs";

const releaseTagPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u;

function validReleaseTag(value) {
  return (
    typeof value === "string" &&
    releaseTagPattern.test(value) &&
    !value.includes("..")
  );
}

function assertImageProtected(image, inspection) {
  if (!inspection?.repoDigests?.includes(image)) {
    throw new Error("FDEV-001 runner image digest is not protected");
  }
}

function assertNoEgressLane(inspection, evidenceVolume) {
  if (
    !inspection ||
    inspection.sourceReadOnly !== true ||
    inspection.evidenceVolume !== evidenceVolume ||
    inspection.networkMode !== "none"
  ) {
    throw new Error("FDEV-001 lane isolation is invalid");
  }
}

function assertPostgresOnlyLane(inspection, evidenceVolume) {
  const members = inspection?.network?.members;
  if (
    !inspection ||
    inspection.sourceReadOnly !== true ||
    inspection.evidenceVolume !== evidenceVolume ||
    inspection.network?.internal !== true ||
    !Array.isArray(members) ||
    members.length !== 2 ||
    [...members].sort().join(",") !== "postgres,postgres-only"
  ) {
    throw new Error("FDEV-001 lane isolation is invalid");
  }
}

function assertInnerLanePassed(result, lane) {
  if (
    !result ||
    result.schemaVersion !== "fdev001-inner-result-v1" ||
    result.executionClass !== "development_only" ||
    result.lane !== lane ||
    result.status !== "passed"
  ) {
    throw new Error(`FDEV-001 ${lane} lane failed`);
  }
}

export function parseHermeticBaselineArguments(argv) {
  if (
    argv.length !== 2 ||
    argv[0] !== "--release-tag" ||
    !validReleaseTag(argv[1])
  ) {
    throw new Error("Invalid FDEV-001 hermetic arguments");
  }
  return { releaseTag: argv[1] };
}

export async function runHermeticBaselineOrchestrator({
  releaseTag,
  git,
  docker,
  files,
  innerLane,
  idFactory,
}) {
  if (!validReleaseTag(releaseTag)) {
    throw new Error("Invalid FDEV-001 hermetic arguments");
  }

  let sourceDirectory;
  let evidenceVolume;
  try {
    const clone = await git.cloneFresh({
      releaseTag,
      disableGlobalAndSystemConfig: true,
      noLocalClone: true,
      detached: true,
    });
    sourceDirectory = clone?.sourceDirectory;
    if (typeof sourceDirectory !== "string" || !sourceDirectory) {
      throw new Error("FDEV-001 fresh clone is invalid");
    }

    const initialIdentity = await git.inspectIdentity({
      sourceDirectory,
      releaseTag,
    });
    const policy = parseRunnerPolicy(await files.readProtectedPolicy());

    for (const image of [policy.noEgressImage, policy.postgresOnlyImage]) {
      assertImageProtected(image, await docker.inspectImage(image));
    }

    const createdVolume = await docker.createEvidenceVolume({
      runId: idFactory(),
    });
    if (!createdVolume?.empty || typeof createdVolume.name !== "string") {
      throw new Error("FDEV-001 evidence volume is not new and empty");
    }
    evidenceVolume = createdVolume.name;

    const noEgressContainer = await docker.runLane({
      lane: "no-egress",
      sourceDirectory,
      evidenceVolume,
      policy,
    });
    assertNoEgressLane(
      await docker.inspectLane({
        lane: "no-egress",
        containerId: noEgressContainer?.containerId,
      }),
      evidenceVolume,
    );
    assertInnerLanePassed(
      await innerLane({
        lane: "no-egress",
        sourceDirectory,
        evidenceVolume,
        policy,
      }),
      "no-egress",
    );

    const postgresContainer = await docker.runLane({
      lane: "postgres-only",
      sourceDirectory,
      evidenceVolume,
      policy,
    });
    assertPostgresOnlyLane(
      await docker.inspectLane({
        lane: "postgres-only",
        containerId: postgresContainer?.containerId,
      }),
      evidenceVolume,
    );
    assertInnerLanePassed(
      await innerLane({
        lane: "postgres-only",
        sourceDirectory,
        evidenceVolume,
        policy,
      }),
      "postgres-only",
    );

    await git.recheckIdentity({
      sourceDirectory,
      releaseTag,
      initialIdentity,
    });

    return {
      schemaVersion: "fdev001-host-result-v1",
      executionClass: "host_preflight_only",
      status: "ready_for_formal_review",
      lanes: ["no-egress", "postgres-only"],
    };
  } finally {
    if (evidenceVolume) await docker.removeEvidenceVolume(evidenceVolume);
    if (sourceDirectory) await git.removeClone(sourceDirectory);
  }
}

async function main() {
  parseHermeticBaselineArguments(process.argv.slice(2));
  throw new Error("FDEV-001 hermetic runner requires protected CI adapters");
}

const scriptPath = resolve(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await main();
}
