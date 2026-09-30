import { getTenantAccessToken } from "./client";

interface FeishuResponse<T> {
  code: number | string;
  msg: string;
  data?: T;
}

export interface FeishuDriveFile {
  fileToken: string;
  name: string;
  size: number;
}

/** Uploads a pilot artifact to the configured Feishu Drive folder. */
export async function uploadFeishuDriveFile(input: {
  name: string;
  folderToken: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<FeishuDriveFile> {
  const token = await getTenantAccessToken();
  const form = new FormData();
  form.set("file_name", input.name);
  form.set("parent_type", "explorer");
  form.set("parent_node", input.folderToken);
  form.set("size", String(input.bytes.byteLength));
  form.set(
    "file",
    new Blob([Uint8Array.from(input.bytes)], { type: input.contentType }),
    input.name,
  );
  const response = await fetch(
    "https://open.feishu.cn/open-apis/drive/v1/medias/upload_all",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  const result = (await response.json()) as FeishuResponse<{
    file_token?: string;
  }>;
  if (!response.ok || Number(result.code) !== 0 || !result.data?.file_token) {
    throw new Error(`Feishu Drive file upload failed: ${result.msg}`);
  }
  return {
    fileToken: result.data.file_token,
    name: input.name,
    size: input.bytes.byteLength,
  };
}

/** Downloads a previously uploaded Drive media file by its file token. */
export async function downloadFeishuDriveFile(
  fileToken: string,
): Promise<Uint8Array> {
  const token = await getTenantAccessToken();
  const response = await fetch(
    `https://open.feishu.cn/open-apis/drive/v1/medias/${encodeURIComponent(fileToken)}/download`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    let detail = "";
    try {
      const result = (await response.json()) as FeishuResponse<unknown>;
      const code =
        result.code === undefined || result.code === null
          ? ""
          : ` code ${String(result.code)}`;
      const message = result.msg ? `: ${result.msg}` : "";
      detail = `${code}${message}`;
    } catch {
      // Download errors are not guaranteed to use Feishu's JSON envelope.
    }
    throw new Error(
      `Feishu Drive file download failed: ${response.status}${detail}`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Uploads bytes as a Base-owned attachment and appends them to one attachment
 * cell. Normal Drive media tokens cannot be assigned to a Bitable record.
 */
export async function uploadFeishuBitableAttachment(input: {
  baseAppToken: string;
  tableId: string;
  recordId: string;
  fieldName: string;
  name: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<string> {
  const token = await getTenantAccessToken();
  const form = new FormData();
  form.set("file_name", input.name);
  form.set("parent_type", "bitable_file");
  form.set("parent_node", input.baseAppToken);
  form.set("size", String(input.bytes.byteLength));
  form.set(
    "file",
    new Blob([Uint8Array.from(input.bytes)], { type: input.contentType }),
    input.name,
  );
  const uploadResponse = await fetch(
    "https://open.feishu.cn/open-apis/drive/v1/medias/upload_all",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  const uploadResult = (await uploadResponse.json()) as FeishuResponse<{
    file_token?: string;
  }>;
  const fileToken = uploadResult.data?.file_token;
  if (!uploadResponse.ok || Number(uploadResult.code) !== 0 || !fileToken) {
    throw new Error(
      `Feishu Base attachment upload failed: ${uploadResult.msg}`,
    );
  }

  const appendResponse = await fetch(
    `https://open.feishu.cn/open-apis/base/v3/bases/${encodeURIComponent(input.baseAppToken)}/tables/${encodeURIComponent(input.tableId)}/append_attachments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        attachments: {
          [input.recordId]: {
            [input.fieldName]: [{ file_token: fileToken }],
          },
        },
      }),
    },
  );
  const appendResult = (await appendResponse.json()) as FeishuResponse<unknown>;
  if (!appendResponse.ok || Number(appendResult.code) !== 0) {
    throw new Error(
      `Feishu Base attachment append failed: ${appendResult.msg}`,
    );
  }
  return fileToken;
}
