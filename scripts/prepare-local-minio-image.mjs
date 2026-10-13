import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const release = "RELEASE.2025-04-22T22-12-26Z";
const image = `minio/minio:${release}`;
const assets = {
  arm64: {
    name: `minio.linux-arm64.${release}`,
    sha256: "6c2f3142c94240206123177f4ba1e360daa5d1e0a4962e90757ef4f92c3ab57c",
  },
  amd64: {
    name: `minio.linux-amd64.${release}`,
    sha256: "53e2a2cb16c5366ea6fbbc479c19ddb4c6a0948273e752f740fb1fbf27bb817c",
  },
};

async function command(command, args, options = {}) {
  return execFile(command, args, {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
}

async function imageExists() {
  try {
    await command("docker", ["image", "inspect", image]);
    return true;
  } catch {
    return false;
  }
}

function architecture(value) {
  const normalized = value.trim().toLowerCase();
  if (["arm64", "aarch64"].includes(normalized)) return "arm64";
  if (["amd64", "x86_64"].includes(normalized)) return "amd64";
  throw new Error(`unsupported Docker architecture for local MinIO: ${value}`);
}

if (!(await imageExists())) {
  const dockerInfo = await command("docker", [
    "info",
    "--format",
    "{{.Architecture}}",
  ]);
  const target = assets[architecture(dockerInfo.stdout)];
  const context = await mkdtemp(join(tmpdir(), "coupon-minio-build-"));
  try {
    await command("gh", [
      "release",
      "download",
      release,
      "--repo",
      "minio/minio",
      "--pattern",
      target.name,
      "--dir",
      context,
    ]);
    const downloaded = join(context, target.name);
    const bytes = await readFile(downloaded);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== target.sha256) {
      throw new Error("downloaded MinIO release checksum does not match");
    }
    await rename(downloaded, join(context, "minio"));
    await command("docker", [
      "build",
      "-f",
      resolve("infra/minio-local.Dockerfile"),
      "-t",
      image,
      context,
    ]);
  } finally {
    await rm(context, { recursive: true, force: true });
  }
}

process.stdout.write(`[infra] local MinIO image ready: ${image}\n`);
