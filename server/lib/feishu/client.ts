import type { FeishuCard } from "./expense-poc";

interface TenantTokenResponse {
  code: number;
  msg: string;
  tenant_access_token?: string;
}

interface FeishuApiResponse {
  code: number;
  msg: string;
  data?: { message_id?: string };
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
  await sendFeishuCardWithReceipt(openId, card, idempotencyKey);
}

export async function sendFeishuCardWithReceipt(
  openId: string,
  card: FeishuCard,
  idempotencyKey?: string,
): Promise<{ messageId: string }> {
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
  const messageId = result.data?.message_id?.trim();
  if (!messageId) {
    throw new Error("Failed to send Feishu card: missing message_id");
  }
  return { messageId };
}

export async function updateFeishuCard(
  messageId: string,
  card: FeishuCard,
): Promise<void> {
  if (!messageId.trim()) throw new Error("Feishu card message ID is required");
  if (card.config.update_multi !== true) {
    throw new Error("Feishu updateable card must enable update_multi");
  }
  const token = await getTenantAccessToken();
  const response = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ content: JSON.stringify(card) }),
    },
  );
  const result = (await response.json()) as FeishuApiResponse;
  if (!response.ok || result.code !== 0) {
    throw new Error(`Failed to update Feishu card: ${result.msg}`);
  }
}

interface FeishuUploadResponse {
  code: number;
  msg: string;
  data?: { file_key?: string; image_key?: string };
}

/**
 * Uploads one file for an im file message. The im media API is independent of
 * Drive: a Drive fileToken cannot be sent directly, so frozen artifacts must
 * be re-uploaded here before delivery.
 */
export async function uploadFeishuMessageFile(input: {
  fileName: string;
  bytes: Uint8Array;
}): Promise<string> {
  const token = await getTenantAccessToken();
  const form = new FormData();
  form.append("file_type", "stream");
  form.append("file_name", input.fileName);
  form.append(
    "file",
    new Blob([input.bytes.slice().buffer as ArrayBuffer], {
      type: "application/octet-stream",
    }),
    input.fileName,
  );
  const response = await fetch("https://open.feishu.cn/open-apis/im/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const result = (await response.json()) as FeishuUploadResponse;
  if (!response.ok || result.code !== 0 || !result.data?.file_key) {
    throw new Error(`Failed to upload Feishu message file: ${result.msg}`);
  }
  return result.data.file_key;
}

export async function uploadFeishuMessageImage(input: {
  bytes: Uint8Array;
}): Promise<string> {
  const token = await getTenantAccessToken();
  const form = new FormData();
  form.append("image_type", "message");
  form.append(
    "image",
    new Blob([input.bytes.slice().buffer as ArrayBuffer], {
      type: "image/png",
    }),
    "image.png",
  );
  const response = await fetch(
    "https://open.feishu.cn/open-apis/im/v1/images",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  const result = (await response.json()) as FeishuUploadResponse;
  if (!response.ok || result.code !== 0 || !result.data?.image_key) {
    throw new Error(`Failed to upload Feishu message image: ${result.msg}`);
  }
  return result.data.image_key;
}

async function sendFeishuResourceMessage(input: {
  openId: string;
  msgType: "file" | "image";
  content: Record<string, unknown>;
  idempotencyKey?: string;
}): Promise<void> {
  const token = await getTenantAccessToken();
  const endpoint = new URL("https://open.feishu.cn/open-apis/im/v1/messages");
  endpoint.searchParams.set("receive_id_type", "open_id");
  if (input.idempotencyKey)
    endpoint.searchParams.set("uuid", input.idempotencyKey);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      receive_id: input.openId,
      msg_type: input.msgType,
      content: JSON.stringify(input.content),
    }),
  });
  const result = (await response.json()) as FeishuApiResponse;
  if (!response.ok || result.code !== 0) {
    throw new Error(
      `Failed to send Feishu ${input.msgType} message: ${result.msg}`,
    );
  }
}

export async function sendFeishuFileMessage(
  openId: string,
  fileKey: string,
  idempotencyKey?: string,
): Promise<void> {
  await sendFeishuResourceMessage({
    openId,
    msgType: "file",
    content: { file_key: fileKey },
    idempotencyKey,
  });
}

export async function sendFeishuImageMessage(
  openId: string,
  imageKey: string,
  idempotencyKey?: string,
): Promise<void> {
  await sendFeishuResourceMessage({
    openId,
    msgType: "image",
    content: { image_key: imageKey },
    idempotencyKey,
  });
}
