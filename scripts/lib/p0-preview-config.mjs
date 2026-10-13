import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const p0PreviewStateVersion = 1;

function parseEnvValue(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseP0PreviewEnv(contents) {
  const values = {};
  for (const [index, line] of contents.split(/\r?\n/u).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) throw new Error(`本机 P0 配置第 ${index + 1} 行格式无效`);
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) {
      throw new Error(`本机 P0 配置第 ${index + 1} 行变量名无效`);
    }
    if (Object.hasOwn(values, key)) throw new Error(`本机 P0 配置重复变量：${key}`);
    values[key] = parseEnvValue(trimmed.slice(separator + 1));
  }
  return values;
}

export async function loadP0PreviewConfig({
  path = ".local/p0-preview.env",
  statImpl = stat,
  readFileImpl = readFile,
} = {}) {
  const details = await statImpl(path);
  if ((details.mode & 0o077) !== 0) {
    throw new Error(`${path} 权限必须为 0600`);
  }
  const values = parseP0PreviewEnv(await readFileImpl(path, "utf8"));
  for (const key of [
    "FEISHU_BRIDGE_KEY_ID",
    "FEISHU_BRIDGE_SHARED_SECRET",
    "CONTROL_PLANE_TICK_TOKEN",
    "VERCEL_AUTOMATION_BYPASS_SECRET",
  ]) {
    if (!values[key]?.trim()) throw new Error(`${key} 未配置`);
  }
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(values.FEISHU_BRIDGE_KEY_ID)) {
    throw new Error("FEISHU_BRIDGE_KEY_ID 格式无效");
  }
  if (values.FEISHU_BRIDGE_SHARED_SECRET.length < 32) {
    throw new Error("FEISHU_BRIDGE_SHARED_SECRET 至少需要 32 个字符");
  }
  return Object.freeze({ ...values });
}

function validateState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("P0 Preview 状态格式无效");
  }
  if (value.version !== p0PreviewStateVersion) {
    throw new Error("P0 Preview 状态版本不受支持");
  }
  if (value.deploymentUrl && !/^https:\/\/[^/]+\.vercel\.app$/u.test(value.deploymentUrl)) {
    throw new Error("P0 Preview 状态中的部署地址无效");
  }
  if (value.gitCommitSha && !/^[0-9a-f]{40}$/u.test(value.gitCommitSha)) {
    throw new Error("P0 Preview 状态中的 Git SHA 无效");
  }
  const serialized = JSON.stringify(value).toLowerCase();
  for (const forbidden of ["secret", "token", "password", "database_url"]) {
    if (serialized.includes(`\"${forbidden}`)) {
      throw new Error("P0 Preview 状态不能保存密钥字段");
    }
  }
  return value;
}

export async function readP0PreviewState(path = ".local/p0-preview-state.json") {
  try {
    return validateState(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeP0PreviewState(
  path = ".local/p0-preview-state.json",
  state,
) {
  const value = validateState({ ...state, version: p0PreviewStateVersion });
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
}

export async function clearP0PreviewState(path = ".local/p0-preview-state.json") {
  try {
    await unlink(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
