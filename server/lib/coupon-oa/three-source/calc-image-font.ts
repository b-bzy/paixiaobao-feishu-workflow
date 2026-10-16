import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fontAssetStorage = "assets:server";
const fontAssetKey = "coupon-fonts:NotoSansSC-Variable.ttf";
const fontDirectory = join(tmpdir(), "pxb-calc-fonts");
const fontCacheDirectory = join(fontDirectory, "fontconfig-cache");
const fontFileName = "NotoSansSC-Variable.ttf";

let ensureOnce: Promise<boolean> | undefined;

async function registerBundledCjkFont(): Promise<boolean> {
  try {
    const { useStorage } = await import("nitropack/runtime");
    const raw =
      await useStorage(fontAssetStorage).getItemRaw<Uint8Array>(fontAssetKey);
    if (!raw) return false;
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    if (!bytes.byteLength) return false;
    await mkdir(fontCacheDirectory, { recursive: true });
    const fontPath = join(fontDirectory, fontFileName);
    await writeFile(fontPath, bytes);
    const configPath = join(fontDirectory, "fonts.conf");
    await writeFile(
      configPath,
      `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${fontDirectory}</dir><cachedir>${fontCacheDirectory}</cachedir></fontconfig>`,
    );
    // fontconfig 只在进程首次初始化时读取该变量，因此必须先于任何 SVG 文本渲染设置；
    // 设置后渲染只看得到内置字体，本地与 Vercel 输出保持一致。
    process.env.FONTCONFIG_FILE = configPath;
    return true;
  } catch {
    // Nitro 资产不可用（如单测环境）时退回系统字体；macOS 可正常回退中文。
    return false;
  }
}

export function ensureBundledCjkFont(): Promise<boolean> {
  ensureOnce ??= registerBundledCjkFont();
  return ensureOnce;
}
