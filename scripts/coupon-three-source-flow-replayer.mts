#!/usr/bin/env node

/**
 * 三源卡片链路自动重放器（测试工具，不属产品代码）。
 *
 * 把"真人点击卡片"构造成与 bridge 输出同构的 card.action.trigger 信封，
 * 经 HMAC 签名 POST 到 Preview /api/feishu/poc-bridge，走完整耐久链
 * （收件箱去重 → worker → dispatcher → 真实发卡）。文件上传无法伪造，
 * 每 case 起点仍由用户真实发送 /OA优惠券提报 + 文件。
 *
 * 命令：
 *   inject --action <name> --pilot-record <recXXX> --revision <n>
 *          [--form '{"owner_key":"值",...}' | --form-file x.json]
 *          [--value-extra '{"k":"v"}'] [--label caseN]
 *   watch  [--label caseN] [--seconds 600] [--interval 3]
 *   render-form --record <recXXX>
 *
 * 凭据源（均不打印值）：
 *   .local/p0-preview.env   FEISHU_BRIDGE_KEY_ID / FEISHU_BRIDGE_SHARED_SECRET /
 *                           VERCEL_AUTOMATION_BYPASS_SECRET
 *   .local/p0-preview-state.json  deploymentUrl
 *   .env.local              FEISHU_APP_ID/SECRET、FEISHU_BASE_APP_TOKEN、
 *                           FEISHU_COUPON_DRAFT_TABLE_ID（经 --env-file 加载）
 *   .local/flow-replay.json ownerOpenId
 *
 * 纪律：event_id 一律全新 UUID（绝不重放）；日志只记动作名/记录 id/revision，
 * 不记 open_id、不记 payload 全文；纯测试授权范围内使用。
 */

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, appendFile, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { getTenantAccessToken } from "../server/lib/feishu/client.ts";
import { buildCouponThreeSourceMappingCard } from "../server/lib/feishu/coupon-oa/three-source/cards.ts";

if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    values[trimmed.slice(0, separator).trim()] = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return values;
}

async function loadConfig() {
  const previewEnv = parseEnvFile(
    await readFile(".local/p0-preview.env", "utf8"),
  );
  const diagEnv = parseEnvFile(
    await readFile(".local/preview-diag.env", "utf8"),
  );
  const state = JSON.parse(
    await readFile(".local/p0-preview-state.json", "utf8"),
  );
  const replay = JSON.parse(await readFile(".local/flow-replay.json", "utf8"));
  const keyId = previewEnv.FEISHU_BRIDGE_KEY_ID;
  const sharedSecret = previewEnv.FEISHU_BRIDGE_SHARED_SECRET;
  const bypass = previewEnv.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!keyId || !sharedSecret) {
    throw new Error(".local/p0-preview.env 缺少 bridge 签名凭据");
  }
  if (!state.deploymentUrl) throw new Error("state 缺少 deploymentUrl");
  if (!replay.ownerOpenId) throw new Error("flow-replay.json 缺少 ownerOpenId");
  return {
    keyId,
    sharedSecret,
    bypass,
    target: new URL(`${state.deploymentUrl}/api/feishu/poc-bridge`),
    deploymentUrl: String(state.deploymentUrl),
    ownerOpenId: String(replay.ownerOpenId),
    // 三源试点草稿在独立的 Pilot Base 表（State JSON 列为权威）。
    // 实测（2026-10-16）：.env.local 应用可访问的 pilot Base = .local/diag-base-app-token
    // （「优惠券三源提报试点」表）；preview-diag.env 里的 token 是改绑前旧值（91402）。
    appToken: (await readFile(".local/diag-base-app-token", "utf8")).trim(),
    tableId: "",
  };
}

function signedHeaders(input: {
  body: string;
  target: URL;
  keyId: string;
  sharedSecret: string;
}): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const nonce = randomBytes(24).toString("base64url");
  const bodySha256 = createHash("sha256").update(input.body).digest("hex");
  const signingInput = [
    "POST",
    input.target.pathname,
    input.keyId,
    timestamp,
    nonce,
    bodySha256,
  ].join("\n");
  return {
    "content-type": "application/json",
    "x-feishu-bridge-key-id": input.keyId,
    "x-feishu-bridge-timestamp": timestamp,
    "x-feishu-bridge-nonce": nonce,
    "x-feishu-bridge-body-sha256": bodySha256,
    "x-feishu-bridge-signature": createHmac("sha256", input.sharedSecret)
      .update(signingInput)
      .digest("hex"),
  };
}

async function timelineDir(label: string): Promise<string> {
  const dir = resolve(`.local/flow-replay/${label}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function appendTimeline(
  label: string,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  const dir = await timelineDir(label);
  await appendFile(
    `${dir}/timeline.jsonl`,
    `${JSON.stringify({ ts: new Date().toISOString(), event, ...data })}\n`,
  );
}

async function injectCommand(): Promise<void> {
  const config = await loadConfig();
  const action = argument("--action");
  const pilotRecord = argument("--pilot-record");
  const revision = argument("--revision");
  const formInline = argument("--form");
  const formFile = argument("--form-file");
  const valueExtra = argument("--value-extra");
  const label = argument("--label") ?? "adhoc";
  if (!action) throw new Error("inject 需要 --action");
  if (!pilotRecord || !revision) {
    throw new Error("inject 需要 --pilot-record 与 --revision（从 watch/render-form 获取）");
  }
  const form = formFile
    ? JSON.parse(await readFile(formFile, "utf8"))
    : formInline
      ? JSON.parse(formInline)
      : undefined;
  const value = {
    action,
    pilotRecordId: pilotRecord,
    revision: Number(revision),
    ...(valueExtra ? JSON.parse(valueExtra) : {}),
  };
  // 表单值一律转字符串：真人表单提交里数字同样是字符串，保持路径真实。
  const normalizedForm = form
    ? Object.fromEntries(
        Object.entries(form).map(([key, val]) => [
          key,
          Array.isArray(val) ? val.map(String) : String(val),
        ]),
      )
    : undefined;
  const eventId = randomUUID();
  const body = JSON.stringify({
    header: { event_id: eventId, event_type: "card.action.trigger" },
    action: {
      name: action,
      value,
      ...(normalizedForm ? { form_value: normalizedForm } : {}),
    },
    operator: { open_id: config.ownerOpenId },
  });
  const response = await fetch(config.target, {
    method: "POST",
    headers: {
      ...signedHeaders({
        body,
        target: config.target,
        keyId: config.keyId,
        sharedSecret: config.sharedSecret,
      }),
      ...(config.bypass
        ? { "x-vercel-protection-bypass": config.bypass }
        : {}),
    },
    body,
  });
  const result = {
    action,
    pilotRecord: `${pilotRecord.slice(0, 6)}…`,
    revision: Number(revision),
    eventId,
    httpStatus: response.status,
    hasForm: Boolean(normalizedForm),
  };
  console.log(JSON.stringify(result));
  await appendTimeline(label, "inject", result);
}

async function sendTextCommand(): Promise<void> {
  const config = await loadConfig();
  const text = argument("--text");
  const label = argument("--label") ?? "adhoc";
  if (!text) throw new Error("send-text 需要 --text");
  const messageId = `om_replay_${randomUUID().replaceAll("-", "")}`;
  const body = JSON.stringify({
    header: { event_id: messageId, event_type: "im.message.receive_v1" },
    event: {
      sender: { sender_id: { open_id: config.ownerOpenId } },
      message: {
        message_id: messageId,
        message_type: "text",
        chat_type: "p2p",
        chat_id: "oc_replay_injected",
        content: JSON.stringify({ text }),
      },
    },
  });
  const response = await fetch(config.target, {
    method: "POST",
    headers: {
      ...signedHeaders({
        body,
        target: config.target,
        keyId: config.keyId,
        sharedSecret: config.sharedSecret,
      }),
      ...(config.bypass
        ? { "x-vercel-protection-bypass": config.bypass }
        : {}),
    },
    body,
  });
  const result = { text, messageId, httpStatus: response.status };
  console.log(JSON.stringify(result));
  await appendTimeline(label, "send_text", result);
}

async function sendTextCommandWrapper(): Promise<void> {
  await sendTextCommand();
}

interface BaseRecord {
  record_id?: string;
  fields?: Record<string, unknown>;
}

async function tenantToken(): Promise<string> {
  const token = await getTenantAccessToken();
  if (!token) throw new Error("获取 tenant_access_token 失败（检查 .env.local）");
  return token;
}

async function listRecords(config: {
  appToken: string;
  tableId: string;
  token: string;
  pageToken?: string;
}): Promise<{ items: BaseRecord[]; page_token?: string; has_more: boolean }> {
  const url = new URL(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records`,
  );
  url.searchParams.set("page_size", "100");
  if (config.pageToken) url.searchParams.set("page_token", config.pageToken);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${config.token}` },
  });
  const payload = (await response.json()) as {
    code: number;
    msg: string;
    data?: { items?: BaseRecord[]; page_token?: string; has_more?: boolean };
  };
  if (payload.code !== 0) {
    throw new Error(`Base 读取失败 code=${payload.code}: ${payload.msg}`);
  }
  return {
    items: payload.data?.items ?? [],
    page_token: payload.data?.page_token,
    has_more: Boolean(payload.data?.has_more),
  };
}

async function allRecords(): Promise<BaseRecord[]> {
  const config = await loadConfig();
  const token = await tenantToken();
  if (!config.tableId) {
    const tablesResponse = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.appToken}/tables?page_size=50`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const tables = (await tablesResponse.json()) as {
      code: number;
      data?: { items?: { table_id: string; name: string }[] };
    };
    if (tables.code !== 0) {
      throw new Error(`Base 表列表读取失败 code=${tables.code}`);
    }
    const pilotTable = (tables.data?.items ?? []).find((item) =>
      item.name.includes("三源提报试点"),
    );
    if (!pilotTable) throw new Error("pilot Base 中找不到「三源提报试点」表");
    config.tableId = pilotTable.table_id;
  }
  const items: BaseRecord[] = [];
  let pageToken: string | undefined;
  do {
    const page = await listRecords({
      appToken: config.appToken,
      tableId: config.tableId,
      token,
      pageToken,
    });
    items.push(...page.items);
    pageToken = page.has_more ? page.page_token : undefined;
  } while (pageToken);
  return items;
}

function short(value: unknown, max = 160): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function watchCommand(): Promise<void> {
  const seconds = Number(argument("--seconds") ?? "600");
  const interval = Number(argument("--interval") ?? "3");
  const label = argument("--label") ?? "adhoc";
  const dir = await timelineDir(label);
  await appendTimeline(label, "watch_start", { seconds, interval });
  const deadline = Date.now() + seconds * 1_000;
  const seen = new Map<string, string>();
  let fieldNamesPrinted = false;
  while (Date.now() < deadline) {
    try {
      const records = await allRecords();
      for (const record of records) {
        const fields = record.fields ?? {};
        if (!fieldNamesPrinted) {
          console.log(`[fields] ${Object.keys(fields).join(" | ")}`);
          fieldNamesPrinted = true;
        }
        const stateJson = short(fields["State JSON"], 4000);
        const status = short(fields["Status"], 60);
        const fingerprint = JSON.stringify({
          s: status,
          j: stateJson,
        });
        const key = record.record_id ?? "?";
        if (seen.get(key) !== fingerprint) {
          const diff = {
            recordId: key,
            status,
            stateChanged: seen.has(key),
            statePreview: stateJson,
            textFields: Object.fromEntries(
              Object.entries(fields)
                .filter(
                  ([name, value]) =>
                    name !== "State JSON" &&
                    (typeof value === "string" || typeof value === "number"),
                )
                .map(([name, value]) => [name, short(value, 200)]),
            ),
          };
          console.log(`[change] ${JSON.stringify(diff)}`);
          await appendTimeline(label, "record_change", diff);
          seen.set(key, fingerprint);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[watch-error] ${message}`);
      await appendTimeline(label, "watch_error", { message });
    }
    await new Promise((done) => setTimeout(done, interval * 1_000));
  }
  await appendTimeline(label, "watch_end", {});
}

async function renderFormCommand(): Promise<void> {
  const recordId = argument("--record");
  if (!recordId) throw new Error("render-form 需要 --record");
  const records = await allRecords();
  const record = records.find((item) => item.record_id === recordId);
  if (!record) throw new Error(`找不到记录 ${recordId}`);
  const stateField = record.fields?.["State JSON"];
  const stateText =
    typeof stateField === "string"
      ? stateField
      : JSON.stringify(stateField ?? "");
  const draft = JSON.parse(stateText) as Record<string, unknown> & {
    task?: { revision?: number };
    recordId?: string;
  };
  const card = buildCouponThreeSourceMappingCard(
    draft as never,
  ) as { elements?: unknown[] };
  const walk = (nodes: unknown[], out: Record<string, unknown>[] ): void => {
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const item = node as Record<string, unknown>;
      if (
        (item.tag === "input" || item.tag === "select_static") &&
        typeof item.name === "string"
      ) {
        out.push({
          name: item.name,
          tag: item.tag,
          label:
            typeof item.label === "object" && item.label
              ? (item.label as Record<string, unknown>).text
              : item.label,
          required: Boolean(item.required),
          options: Array.isArray(item.options)
            ? (
                item.options as { text?: { text?: string }; value?: string }[]
              ).map((option) => option.value ?? option.text?.text)
            : undefined,
        });
      }
      for (const key of ["elements", "fields", "columns"]) {
        if (Array.isArray(item[key])) walk(item[key] as unknown[], out);
      }
    }
  };
  const found: Record<string, unknown>[] = [];
  const body = (card as { body?: { elements?: unknown[] } }).body;
  if (Array.isArray(body?.elements)) walk(body.elements, found);
  console.log(
    JSON.stringify(
      {
        recordId,
        revision: draft.task?.revision,
        formFields: found,
      },
      null,
      2,
    ),
  );
}

const command = process.argv[2];
if (command === "inject") await injectCommand();
else if (command === "send-text") await sendTextCommand();
else if (command === "watch") await watchCommand();
else if (command === "render-form") await renderFormCommand();
else
  throw new Error("用法：inject | watch | render-form（见文件头注释）");
