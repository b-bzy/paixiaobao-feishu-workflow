#!/usr/bin/env node

/**
 * 9 case 全流程真发重测驱动（2026-10-16 修复轮）。
 * 每案：clear → /OA优惠券提报 → 以用户身份发文件 →（角色队列推进）
 * → AI 识别注入 → 映射卡渲染 → 智能填表（枚举选合法值）→ 确认 → 终态校验。
 * 输出每案 JSON 结论行 + 汇总；证据落 .local/flow-replay-r2/<case>/。
 */

import { execFile as execFileCallback } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { getTenantAccessToken } from "../server/lib/feishu/client.ts";
import { buildCouponThreeSourceMappingCard } from "../server/lib/feishu/coupon-oa/three-source/cards.ts";

const execFile = promisify(execFileCallback);
if (
  process.env.HTTP_PROXY ||
  process.env.HTTPS_PROXY ||
  process.env.ALL_PROXY
) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

const CASES_DIR = "/Users/jacob/Desktop/测试用例";
const CHAT_ID = "oc_8948df3f4203853e36c302cc539542f1";
const OUT_ROOT = resolve(".local/flow-replay-r2");

interface CasePlan {
  id: string;
  files: string[];
  startAt: string;
  endAt: string;
  rolePlan?: Record<string, "couponTable" | "whitelist" | "blacklist">;
  skipAi?: boolean;
}

const plans: CasePlan[] = [
  { id: "case3", files: ["配券型号表10.16-10.20.xlsx", "商品明细白名单10.16-10.20.xlsx"], startAt: "2026-10-16", endAt: "2026-10-20" },
  { id: "case4", files: ["配券型号表10.14-10.18.xlsx", "平台承担100%配券明细表10.14-10.18xlsx.xlsx"], startAt: "2026-10-14", endAt: "2026-10-18" },
  { id: "case8", files: ["M系列Mini主机.xlsx", "M系列Mini主机SKU.xlsx"], startAt: "2026-10-16", endAt: "2026-10-31" },
  { id: "case1", files: ["新商9月优惠券-26年9月w3.xlsx", "商家ID_新商9月优惠券-26年9月w3.xlsx"], startAt: "2026-09-16", endAt: "2026-09-30" },
  { id: "case2", files: ["10月新商优惠券-双十一前置.xlsx", "商家ID_10月新商优惠券-双十一前置.xlsx"], startAt: "2026-10-18", endAt: "2026-11-10" },
  { id: "case5", files: ["9.1-9.2乐器优惠券.xlsx", "乐器-白名单乐器商家id.xlsx"], startAt: "2026-09-01", endAt: "2026-09-02" },
  { id: "case6", files: ["平板优惠券申请3.30-3.31.xlsx", "平板常规店铺SKU优惠券 (2).xlsx"], startAt: "2026-03-30", endAt: "2026-03-31" },
  { id: "case7", files: ["平板优惠券申请3.24-3.26.xlsx", "平板常规店铺SKU优惠券 (2).xlsx"], startAt: "2026-03-24", endAt: "2026-03-26" },
  {
    id: "case9",
    files: [
      "10.1-10.10 POP手机 平销期 优惠券申请.xlsx",
      "10.1-10.16 资源机优惠券.xlsx",
      "ov华资源机spu.xlsx",
      "安卓sku.xlsx",
      "安卓全店券.xlsx",
      "苹果全店券.xlsx",
      "苹果机型sku券.xlsx",
      "苹果资源机sku卷.xlsx",
    ],
    startAt: "2026-10-01",
    endAt: "2026-10-16",
    rolePlan: {
      "10.1-10.16 资源机优惠券.xlsx": "couponTable",
      "安卓sku.xlsx": "whitelist",
      "安卓全店券.xlsx": "whitelist",
      "苹果全店券.xlsx": "blacklist",
      "苹果机型sku券.xlsx": "whitelist",
      "苹果资源机sku卷.xlsx": "whitelist",
    },
  },
];

function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    values[trimmed.slice(0, trimmed.indexOf("=")).trim()] = trimmed
      .slice(trimmed.indexOf("=") + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return values;
}

const previewEnv = parseEnv(await readFile(".local/p0-preview.env", "utf8"));
const state = JSON.parse(await readFile(".local/p0-preview-state.json", "utf8"));
const replay = JSON.parse(await readFile(".local/flow-replay.json", "utf8"));
const pilotAppToken = (await readFile(".local/diag-base-app-token", "utf8")).trim();
const TARGET = new URL(`${state.deploymentUrl}/api/feishu/poc-bridge`);

function signedHeaders(body: string): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(24).toString("base64url");
  const bodySha256 = createHash("sha256").update(body).digest("hex");
  const signature = createHmac("sha256", previewEnv.FEISHU_BRIDGE_SHARED_SECRET)
    .update(["POST", TARGET.pathname, previewEnv.FEISHU_BRIDGE_KEY_ID, timestamp, nonce, bodySha256].join("\n"))
    .digest("hex");
  return {
    "content-type": "application/json",
    "x-feishu-bridge-key-id": previewEnv.FEISHU_BRIDGE_KEY_ID,
    "x-feishu-bridge-timestamp": timestamp,
    "x-feishu-bridge-nonce": nonce,
    "x-feishu-bridge-body-sha256": bodySha256,
    "x-feishu-bridge-signature": signature,
  };
}

async function withRetry<T>(label: string, attempt: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let round = 0; round < 4; round += 1) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      await new Promise((done) => setTimeout(done, 3_000 * (round + 1)));
    }
  }
  throw new Error(`${label} 重试 4 次仍失败: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function postEvent(body: object): Promise<number> {
  const text = JSON.stringify(body);
  return withRetry("postEvent", async () => {
    const response = await fetch(TARGET, {
      method: "POST",
      headers: {
        ...signedHeaders(text),
        ...(previewEnv.VERCEL_AUTOMATION_BYPASS_SECRET
          ? { "x-vercel-protection-bypass": previewEnv.VERCEL_AUTOMATION_BYPASS_SECRET }
          : {}),
      },
      body: text,
    });
    return response.status;
  });
}

async function sendText(text: string): Promise<void> {
  const messageId = `om_replay_${randomUUID().replaceAll("-", "")}`;
  const status = await postEvent({
    header: { event_id: messageId, event_type: "im.message.receive_v1" },
    event: {
      sender: { sender_id: { open_id: replay.ownerOpenId } },
      message: {
        message_id: messageId,
        message_type: "text",
        chat_type: "p2p",
        chat_id: "oc_replay_injected",
        content: JSON.stringify({ text }),
      },
    },
  });
  if (status !== 200) throw new Error(`sendText ${text} -> ${status}`);
}

async function injectAction(input: {
  action: string;
  pilotRecord: string;
  revision: number;
  form?: Record<string, unknown>;
  valueExtra?: Record<string, unknown>;
}): Promise<void> {
  const status = await postEvent({
    header: { event_id: randomUUID(), event_type: "card.action.trigger" },
    action: {
      name: input.action,
      value: {
        action: input.action,
        pilotRecordId: input.pilotRecord,
        revision: input.revision,
        ...(input.valueExtra ?? {}),
      },
      ...(input.form ? { form_value: input.form } : {}),
    },
    operator: { open_id: replay.ownerOpenId },
  });
  if (status !== 200) throw new Error(`inject ${input.action} -> ${status}`);
}

async function sendFile(caseDir: string, fileName: string): Promise<void> {
  const { stdout } = await execFile(
    "lark-cli",
    ["im", "+messages-send", "--chat-id", CHAT_ID, "--file", fileName],
    { cwd: caseDir, maxBuffer: 8 * 1024 * 1024 },
  );
  if (!stdout.includes('"ok": true')) {
    throw new Error(`file send failed: ${fileName}: ${stdout.slice(0, 200)}`);
  }
}

const token = (await getTenantAccessToken()) ?? "";
async function fetchState(recordId: string): Promise<{ revision: number; status: string; draft: Record<string, any> }> {
  return withRetry("fetchState", async () => {
    const response = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${pilotAppToken}/tables/tbl1MYo5Ga4B95Ey/records/${recordId}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const payload = (await response.json()) as any;
    const fields = payload.data?.record?.fields ?? {};
    const stateText = typeof fields["State JSON"] === "string" ? fields["State JSON"] : "{}";
    const draft = JSON.parse(stateText);
    return { revision: draft.task?.revision ?? 0, status: draft.task?.status ?? "", draft };
  });
}

async function listRecords(): Promise<Array<{ recordId: string; pilotId: string; status: string }>> {
  return withRetry("listRecords", async () => {
    const response = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${pilotAppToken}/tables/tbl1MYo5Ga4B95Ey/records?page_size=100`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const payload = (await response.json()) as any;
    return (payload.data?.items ?? []).map((item: any) => {
      const stateText = typeof item.fields?.["State JSON"] === "string" ? item.fields["State JSON"] : "{}";
      try {
        const draft = JSON.parse(stateText);
        return { recordId: item.record_id, pilotId: String(draft.pilotId ?? ""), status: String(draft.task?.status ?? "") };
      } catch {
        return { recordId: item.record_id, pilotId: "", status: "" };
      }
    });
  });
}

async function findNewRecord(known: Set<string>, timeoutMs = 150_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const records = await listRecords();
    const fresh = records.find((item) => !known.has(item.recordId));
    if (fresh) return fresh.recordId;
    await new Promise((done) => setTimeout(done, 3_000));
  }
  throw new Error("等待新草稿超时");
}

async function waitUntil(recordId: string, check: (state: Awaited<ReturnType<typeof fetchState>>) => boolean, timeoutMs: number): Promise<Awaited<ReturnType<typeof fetchState>>> {
  const deadline = Date.now() + timeoutMs;
  let last = await fetchState(recordId);
  while (Date.now() < deadline && !check(last)) {
    await new Promise((done) => setTimeout(done, 4_000));
    last = await fetchState(recordId);
  }
  return last;
}

interface FormField {
  name: string;
  tag: string;
  required?: boolean;
  options?: Array<{ value?: string; text?: { text?: string } }>;
  placeholder?: { content?: string };
}

function renderFormFields(draft: Record<string, any>): FormField[] {
  const card = buildCouponThreeSourceMappingCard(draft as never) as any;
  const found: FormField[] = [];
  const walk = (nodes: any): void => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      if ((node.tag === "input" || node.tag === "select_static") && typeof node.name === "string") {
        found.push({
          name: node.name,
          tag: node.tag,
          required: Boolean(node.required),
          options: node.options,
          placeholder: node.placeholder,
        });
      }
      for (const key of ["elements", "fields", "columns"]) walk(node[key]);
    }
  };
  walk(card.body?.elements);
  return found;
}

function composeForm(fields: FormField[], plan: CasePlan): Record<string, string> {
  const form: Record<string, string> = {};
  for (const field of fields) {
    if (field.name === "supplementText") continue;
    if (field.name.startsWith("coupon_three_source")) continue;
    switch (field.name) {
      case "owner_overDeduction": form[field.name] = "否"; break;
      case "activityPointPercent": form[field.name] = "6"; break;
      case "owner_businessMode": form[field.name] = "pop"; break;
      case "owner_activityName": form[field.name] = `本地自动测试R2-${plan.id}`; break;
      case "owner_activityBackground": form[field.name] = "本地自动测试R2：全流程回归，不创建真实 OA"; break;
      case "owner_activityStartAt": form[field.name] = plan.startAt; break;
      case "owner_activityEndAt": form[field.name] = plan.endAt; break;
      // claimRule/allowGift 不预填：真实用户不会抄标准词，留空交给
      // 软门禁归一表内方言值（2026-10-18 教训：预填标准值等于带着答案
      // 考试，会掩盖真实用户被退回的路径）。
      case "owner_promotionMode": form[field.name] = "公开自动推广"; break;
      case "owner_publicPromotionChannels": form[field.name] = "单品页购物车"; break;
      case "owner_useWindow": form[field.name] = `${plan.startAt} 至 ${plan.endAt}`; break;
      case "owner_dailyClaimLimit": form[field.name] = "1"; break;
      case "owner_thresholdYuan": form[field.name] = "1000"; break;
      case "owner_discountAmountYuan": form[field.name] = "50"; break;
      case "owner_totalQuantity": form[field.name] = "1000"; break;
      case "owner_grantQuantityPerClaim": form[field.name] = "1"; break;
      case "owner_expectedClaimRate": form[field.name] = "50%"; break;
      case "owner_expectedUseRate": form[field.name] = "30%"; break;
      case "owner_platformBearingRatio": form[field.name] = "50%"; break;
      case "owner_estimatedGmvYuan": form[field.name] = "100000"; break;
      case "owner_channels": form[field.name] = "京东商城"; break;
      case "owner_applicantName": form[field.name] = "本地自动测试R2"; break;
      case "owner_claimWindow": form[field.name] = `${plan.startAt} 至 ${plan.endAt}`; break;
      case "blacklistDecision": form[field.name] = "absent_confirmed"; break;
      default:
        if (field.name.endsWith("_confirmAsSku")) form[field.name] = "SKU";
        else if (field.name.endsWith("_dimensionReason")) form[field.name] = "本地自动测试R2：按SKU使用确认";
        else if (field.name.startsWith("owner_") && field.required) {
          const option = field.options?.[0]?.value ?? field.options?.[0]?.text?.text;
          form[field.name] = option ?? "本地自动测试R2";
        }
    }
  }
  return form;
}

async function runCase(plan: CasePlan): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const outDir = join(OUT_ROOT, plan.id);
  await mkdir(outDir, { recursive: true });
  const caseDir = join(CASES_DIR, plan.id);
  const result: Record<string, unknown> = { case: plan.id };

  const known = new Set((await listRecords()).map((item) => item.recordId));
  await sendText("clear");
  await new Promise((done) => setTimeout(done, 6_000));
  await sendText("/OA优惠券提报");
  const recordId = await findNewRecord(known);
  result.recordId = recordId;

  for (const file of plan.files) {
    await sendFile(caseDir, file);
    await new Promise((done) => setTimeout(done, 2_500));
  }

  // 角色队列推进（case9）
  let state = await waitUntil(recordId, (current) => current.draft.task?.sources?.couponTable && current.draft.task?.sources?.whitelist, 90_000);
  for (let guard = 0; guard < 8; guard += 1) {
    state = await fetchState(recordId);
    const pending = state.draft.pendingRecognition;
    if (!pending) break;
    const fileName: string = pending.source?.fileName ?? "";
    const role = plan.rolePlan?.[fileName] ?? "whitelist";
    await injectAction({
      action: "coupon_three_source_role_confirm",
      pilotRecord: recordId,
      revision: state.revision,
      valueExtra: { role },
    });
    await new Promise((done) => setTimeout(done, 9_000));
  }

  if (!plan.skipAi) {
    state = await fetchState(recordId);
    await injectAction({ action: "coupon_three_source_recognition_start", pilotRecord: recordId, revision: state.revision });
    state = await waitUntil(recordId, (current) => {
      const slots = Object.values(current.draft.recognitions ?? {});
      return slots.length > 0 && slots.every((slot: any) => slot?.ai?.status === "succeeded" || slot?.ai?.status === "failed");
    }, 150_000);
    result.ai = Object.fromEntries(
      Object.entries(state.draft.recognitions ?? {}).map(([slot, value]: [string, any]) => [slot, value?.ai?.status ?? null]),
    );
  }

  // 提交带 revision 竞态重试：AI 横幅等后台更新可能插在取状态与处理
  // 确认之间导致守卫弹回；字段级「输入校验」错误属真实结果，不重试。
  let terminal = await fetchState(recordId);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (
      terminal.status === "DraftOnlyConfirmed" ||
      terminal.status === "Canceled"
    ) {
      break;
    }
    const fields = renderFormFields(terminal.draft);
    const form = composeForm(fields, plan);
    await writeFile(
      join(outDir, `form-${attempt}.json`),
      `${JSON.stringify({ revision: terminal.revision, fields, form }, null, 1)}\n`,
    );
    const submittedRevision = terminal.revision;
    await injectAction({
      action: "coupon_three_source_mapping_confirm",
      pilotRecord: recordId,
      revision: submittedRevision,
      form,
    });
    terminal = await waitUntil(
      recordId,
      (current) =>
        current.revision > submittedRevision ||
        current.status === "DraftOnlyConfirmed" ||
        current.status === "Canceled",
      90_000,
    );
    if (terminal.status === "DraftOnlyConfirmed") break;
    // 生成阶段（GeneratingArtifacts）需要再等终态
    terminal = await waitUntil(
      recordId,
      (current) =>
        current.status === "DraftOnlyConfirmed" ||
        current.status === "Canceled" ||
        current.status === "AwaitingSourceConfirmation" ||
        current.status === "Collecting",
      120_000,
    );
  }
  await writeFile(join(outDir, "final-state.json"), `${JSON.stringify(terminal.draft, null, 1)}\n`);
  result.status = terminal.status;
  result.revision = terminal.revision;
  result.validationIssues = terminal.draft.validationIssues ?? [];
  result.failureReason = terminal.draft.failureReason ?? null;
  const artifacts = (terminal.draft.artifacts ?? []) as Array<Record<string, unknown>>;
  result.artifactCount = artifacts.length;
  result.calcImages = artifacts.filter((artifact) => artifact.role === "calcImage").map((artifact) => artifact.fileName);
  result.oaDraftRecordId = terminal.draft.oaDraftRecordId ?? null;
  result.elapsedMs = Date.now() - startedAt;
  return result;
}

const only = (process.env.REPLAY_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const selected = only.length ? plans.filter((plan) => only.includes(plan.id)) : plans;
const results: Array<Record<string, unknown>> = [];
for (const plan of selected) {
  try {
    const outcome = await runCase(plan);
    results.push(outcome);
    console.log(`[DONE] ${JSON.stringify(outcome)}`);
  } catch (error) {
    const failure = { case: plan.id, error: error instanceof Error ? error.message : String(error) };
    results.push(failure);
    console.log(`[FAIL] ${JSON.stringify(failure)}`);
  }
}
await writeFile(join(OUT_ROOT, "summary.json"), `${JSON.stringify(results, null, 1)}\n`);
console.log(`\nSUMMARY ${JSON.stringify(results.map((item) => ({ case: item.case, status: item.status ?? "ERROR", calc: (item.calcImages as string[] | undefined)?.length ?? 0, oa: Boolean(item.oaDraftRecordId) })))}`);
