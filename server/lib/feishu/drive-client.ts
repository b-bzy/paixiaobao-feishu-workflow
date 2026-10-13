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

/**
 * Downloads an explorer-parent Drive file (云空间资源文件) by its file token.
 * Frozen pilot artifacts are uploaded with parent_type=explorer, so they must
 * use the file download endpoint; the /medias/{token}/download endpoint only
 * serves 云文档素材 and returns 403 for explorer files.
 */
export async function downloadFeishuDriveFile(
  fileToken: string,
): Promise<Uint8Array> {
  const token = await getTenantAccessToken();
  const response = await fetch(
    `https://open.feishu.cn/open-apis/drive/v1/files/${encodeURIComponent(fileToken)}/download`,
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

const drivePermissionTimeoutMs = 10_000;

interface FeishuDrivePermissionMember {
  member_type?: string;
  member_id?: string;
  perm?: string;
}

function drivePermissionUrl(fileToken: string): string {
  return `https://open.feishu.cn/open-apis/drive/v1/permissions/${encodeURIComponent(fileToken)}/members?type=file`;
}

async function readBackFeishuDriveFileViewPermission(input: {
  fileToken: string;
  memberOpenId: string;
  token: string;
}): Promise<boolean> {
  const response = await fetch(drivePermissionUrl(input.fileToken), {
    headers: { Authorization: `Bearer ${input.token}` },
    signal: AbortSignal.timeout(drivePermissionTimeoutMs),
  });
  const result = (await response.json().catch(() => undefined)) as
    | FeishuResponse<{ members?: FeishuDrivePermissionMember[] }>
    | undefined;
  if (!response.ok || !result || Number(result.code) !== 0) return false;
  return (result.data?.members ?? []).some(
    (member) =>
      member.member_type === "openid" &&
      member.member_id === input.memberOpenId &&
      (member.perm === "view" ||
        member.perm === "edit" ||
        member.perm === "full_access"),
  );
}

/**
 * Grants one user view permission on a Drive-uploaded file so the Feishu
 * client can open its native preview. Feishu reports code 1063003 both for
 * members that already hold permission and for genuinely forbidden grants,
 * so that case is confirmed by reading the member list back.
 */
export async function grantFeishuDriveFileViewPermission(input: {
  fileToken: string;
  memberOpenId: string;
}): Promise<void> {
  const token = await getTenantAccessToken();
  const response = await fetch(drivePermissionUrl(input.fileToken), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      perm: "view",
      member_type: "openid",
      member_id: input.memberOpenId,
    }),
    signal: AbortSignal.timeout(drivePermissionTimeoutMs),
  });
  const result = (await response.json().catch(() => undefined)) as
    | FeishuResponse<unknown>
    | undefined;
  if (response.ok && Number(result?.code) === 0) return;
  if (Number(result?.code) === 1063003) {
    const granted = await readBackFeishuDriveFileViewPermission({
      fileToken: input.fileToken,
      memberOpenId: input.memberOpenId,
      token,
    });
    if (granted) return;
  }
  const detail = result ? ` code ${String(result.code)}: ${result.msg}` : "";
  throw new Error(
    `Feishu Drive file permission grant failed: ${response.status}${detail}`,
  );
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
