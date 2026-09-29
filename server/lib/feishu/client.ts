import type { FeishuCard } from "./expense-poc";

interface TenantTokenResponse {
  code: number;
  msg: string;
  tenant_access_token?: string;
}

interface FeishuApiResponse {
  code: number;
  msg: string;
}

function getCredentials(): { appId: string; appSecret: string } {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("FEISHU_APP_ID and FEISHU_APP_SECRET must be configured");
  }
  return { appId, appSecret };
}

export async function getTenantAccessToken(): Promise<string> {
  const { appId, appSecret } = getCredentials();
  const response = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    },
  );
  const result = (await response.json()) as TenantTokenResponse;
  if (!response.ok || result.code !== 0 || !result.tenant_access_token) {
    throw new Error(`Failed to get Feishu tenant token: ${result.msg}`);
  }
  return result.tenant_access_token;
}

export async function sendFeishuCard(
  openId: string,
  card: FeishuCard,
  idempotencyKey?: string,
): Promise<void> {
  const token = await getTenantAccessToken();
  const endpoint = new URL("https://open.feishu.cn/open-apis/im/v1/messages");
  endpoint.searchParams.set("receive_id_type", "open_id");
  if (idempotencyKey) endpoint.searchParams.set("uuid", idempotencyKey);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      receive_id: openId,
      msg_type: "interactive",
      content: JSON.stringify(card),
    }),
  });
  const result = (await response.json()) as FeishuApiResponse;
  if (!response.ok || result.code !== 0) {
    throw new Error(`Failed to send Feishu card: ${result.msg}`);
  }
}
