import { getTenantAccessToken } from "./client";

interface FeishuResponse<T> {
  code: number;
  msg: string;
  data?: T;
}

interface FeishuMessageDetail {
  items?: Array<{
    body?: { content?: string };
    msg_type?: string;
  }>;
}

async function request<T>(path: string): Promise<T> {
  const token = await getTenantAccessToken();
  const response = await fetch(`https://open.feishu.cn/open-apis${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const result = (await response.json()) as FeishuResponse<T>;
  if (!response.ok || result.code !== 0 || !result.data) {
    throw new Error(`Feishu message request failed: ${result.msg}`);
  }
  return result.data;
}

export async function getFeishuMessageBody(input: {
  messageId: string;
}): Promise<{ messageType: string; content: string }> {
  const data = await request<FeishuMessageDetail>(
    `/im/v1/messages/${encodeURIComponent(input.messageId)}`,
  );
  const message = data.items?.[0];
  if (!message?.msg_type || !message.body?.content) {
    throw new Error("Feishu message did not include its original body");
  }
  return { messageType: message.msg_type, content: message.body.content };
}

export async function downloadFeishuMessageResource(input: {
  messageId: string;
  fileKey: string;
  type: "file" | "image";
}): Promise<Uint8Array> {
  const token = await getTenantAccessToken();
  const response = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(input.messageId)}/resources/${encodeURIComponent(input.fileKey)}?type=${input.type}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(
      `Feishu message resource download failed: ${response.status}`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}
