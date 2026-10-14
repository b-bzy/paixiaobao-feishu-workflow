import { getTenantAccessToken } from "../client";
import type {
  ApprovalFormValue,
  CouponApprovalDefinition,
} from "./approval-schema";

interface FeishuResponse<T> {
  code: number | string;
  msg: string;
  data?: T;
}

interface RawApprovalDefinition {
  approval_name?: string;
  form?: string;
  node_list?: CouponApprovalDefinition["nodeList"];
}

export interface CreatedApprovalInstance {
  instanceCode: string;
  instanceLink?: string;
}

export interface ApprovalInstanceDetail {
  approval_code?: string;
  form?: string;
  current_nodes?: unknown[];
  task_list?: unknown[];
  timeline?: unknown[];
  status?: string;
  open_id?: string;
  department_id?: string;
  [key: string]: unknown;
}

interface RawFeishuUser {
  user_id?: string;
  open_id?: string;
  name?: string;
  department_ids?: string[];
  primary_department_id?: string;
}

export interface CouponOaApplicantProfile {
  openId: string;
  /** Absent when the app lacks contact read scopes (degraded identity). */
  userId?: string;
  displayName?: string;
  departmentOpenIds: string[];
  primaryDepartmentOpenId?: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getTenantAccessToken();
  const response = await fetch(`https://open.feishu.cn/open-apis${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  const result = (await response.json()) as FeishuResponse<T>;
  if (!response.ok || Number(result.code) !== 0 || !result.data) {
    // The HTTP status lets callers distinguish a synchronous parameter
    // rejection (nothing was created, safe to surface and fix) from a
    // transport/unknown failure that requires reconciliation.
    throw Object.assign(
      new Error(`Feishu approval request failed: ${result.msg}`),
      { status: response.status },
    );
  }
  return result.data;
}

export async function getCouponOaApplicantProfile(
  openId: string,
): Promise<CouponOaApplicantProfile> {
  if (!openId.trim())
    throw new Error("Coupon OA applicant open ID is required");
  const data = await request<{ user?: RawFeishuUser }>(
    `/contact/v3/users/${encodeURIComponent(openId)}?user_id_type=open_id&department_id_type=open_department_id`,
  );
  const user = data.user;
  if (!user?.open_id) {
    throw new Error("Feishu user profile did not include the confirmer");
  }
  if (user.open_id !== openId) {
    throw new Error(
      "Feishu user profile did not match the coupon OA confirmer",
    );
  }
  // Without the contact read scopes the API returns a hollow profile that
  // only echoes the open ID. The instance applicant is already bound by the
  // create-request open_id and the native form auto-fills department and
  // applicant, so an open-ID-only profile is a valid degraded identity.
  const departmentOpenIds = [...new Set(user.department_ids ?? [])].filter(
    Boolean,
  );
  return {
    openId: user.open_id,
    ...(user.user_id ? { userId: user.user_id } : {}),
    ...(user.name ? { displayName: user.name } : {}),
    departmentOpenIds,
    ...(user.primary_department_id
      ? { primaryDepartmentOpenId: user.primary_department_id }
      : {}),
  };
}

export async function getCouponApprovalDefinition(
  approvalCode: string,
): Promise<CouponApprovalDefinition> {
  const data = await request<RawApprovalDefinition>(
    `/approval/v4/approvals/${encodeURIComponent(approvalCode)}?locale=zh-CN`,
  );
  if (!data.form) {
    throw new Error("Feishu approval definition did not include form controls");
  }
  return {
    approvalCode,
    form: data.form,
    nodeList: data.node_list,
  };
}

export async function createCouponApprovalInstance(input: {
  approvalCode: string;
  submitterOpenId: string;
  submitterDepartmentId?: string;
  form: ApprovalFormValue[];
  uuid: string;
}): Promise<CreatedApprovalInstance> {
  const data = await request<{
    instance_code?: string;
    instance_link?: string;
  }>("/approval/v4/instances", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      approval_code: input.approvalCode,
      open_id: input.submitterOpenId,
      ...(input.submitterDepartmentId
        ? { department_id: input.submitterDepartmentId }
        : {}),
      form: JSON.stringify(input.form),
      uuid: input.uuid,
      with_link: true,
    }),
  });
  if (!data.instance_code) {
    throw new Error("Feishu did not return an approval instance code");
  }
  return {
    instanceCode: data.instance_code,
    instanceLink: data.instance_link,
  };
}

export async function getCouponApprovalInstance(
  instanceCode: string,
): Promise<ApprovalInstanceDetail> {
  return request<ApprovalInstanceDetail>(
    `/approval/v4/instances/${encodeURIComponent(instanceCode)}?locale=zh-CN`,
  );
}

interface FeishuMessageDetail {
  items?: Array<{
    body?: { content?: string };
    msg_type?: string;
  }>;
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
  return {
    messageType: message.msg_type,
    content: message.body.content,
  };
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

/**
 * Approval attachments use the documented v4 endpoint. It returns a file code
 * that must be assigned to image/attachmentV2 form controls.
 */
export async function uploadCouponApprovalFile(input: {
  name: string;
  type: "image" | "attachment";
  contentType: string;
  bytes: Uint8Array;
}): Promise<string> {
  const token = await getTenantAccessToken();
  const form = new FormData();
  form.set("name", input.name);
  form.set("type", input.type);
  const content = Uint8Array.from(input.bytes);
  form.set(
    "content",
    new Blob([content.buffer], { type: input.contentType }),
    input.name,
  );
  const response = await fetch(
    "https://open.feishu.cn/open-apis/approval/v4/files/upload",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  const result = (await response.json()) as FeishuResponse<{
    file_code?: string;
    urls_detail?: Array<{
      code?: string;
      message?: string;
      origin_url?: string;
      url?: string;
    }>;
  }>;
  const fileCode =
    result.data?.file_code ?? result.data?.urls_detail?.[0]?.code;
  if (!response.ok || Number(result.code) !== 0) {
    throw new Error(`Feishu approval file upload failed: ${result.msg}`);
  }
  if (!fileCode) {
    throw new Error(
      "Feishu approval file upload succeeded but did not return a file code",
    );
  }
  return fileCode;
}
