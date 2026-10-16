// 扫描卡片构建产物中全部字符串属性的长度,定位飞书 schema 上限类拒收
// (如 ErrCode 11310 "name exceed the default maximum 100")。
// 用法: node --import tsx scripts/scan-card-limits.mjs <草稿导出.json> [name阈值=60] [其他阈值=150]
// 草稿导出格式见 audit:cards --draft(需含顶层 ownerOpenId)。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const [draftFile, nameLimitArg, otherLimitArg] = process.argv.slice(2);
if (!draftFile) {
  console.error("用法: node --import tsx scripts/scan-card-limits.mjs <草稿导出.json> [name阈值] [其他阈值]");
  process.exit(1);
}
const NAME_LIMIT = Number(nameLimitArg ?? 60);
const OTHER_LIMIT = Number(otherLimitArg ?? 150);
const NAME_HARD_CAP = 100; // 飞书实测:组件 name 超过 100 报 ErrCode 11310

const cards = await import(
  resolve(process.cwd(), "server/lib/feishu/coupon-oa/three-source/cards.ts")
);
const draft = JSON.parse(readFileSync(resolve(draftFile), "utf8"));

const builders = {
  mapping: () => cards.buildCouponThreeSourceMappingCard(draft),
};

let violations = 0;
for (const [label, build] of Object.entries(builders)) {
  let card;
  try {
    card = build();
  } catch (error) {
    console.log(`${label}: 构建抛错: ${error.message}`);
    violations += 1;
    continue;
  }
  const strings = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${path}[${i}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === "string") strings.push({ key, path: `${path}.${key}`, value });
        else walk(value, `${path}.${key}`);
      }
    }
  };
  walk(card, "ROOT");
  strings.sort((a, b) => b.value.length - a.value.length);
  console.log(`\n===== ${label}(${strings.length} 个字符串属性) =====`);
  for (const s of strings.slice(0, 20)) {
    const overName = s.key === "name" && s.value.length > NAME_HARD_CAP;
    const notable =
      overName || (s.key === "name" && s.value.length > NAME_LIMIT) || (s.key !== "name" && s.value.length > OTHER_LIMIT);
    if (!notable) continue;
    if (overName) violations += 1;
    console.log(
      `${overName ? "!!OVER!!" : "  long  "} ${String(s.value.length).padStart(5)} ${s.key.padEnd(14)} ${s.path}`,
    );
    console.log(`         ${JSON.stringify(s.value.slice(0, 120))}`);
  }
}
process.exitCode = violations > 0 ? 1 : 0;
