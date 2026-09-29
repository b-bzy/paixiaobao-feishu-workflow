import type {
  AdminOverview,
  InstanceStatus,
  InstanceView,
  TemplateDraft,
  TemplateView,
} from "./types";

const baseUrl = import.meta.env.VITE_ADMIN_API_BASE_URL ?? "";
const developmentOpenId = import.meta.env.VITE_ADMIN_DEV_OPEN_ID;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (developmentOpenId) headers.set("X-Admin-Open-Id", developmentOpenId);

  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      statusMessage?: string;
      message?: string;
    } | null;
    throw new Error(
      payload?.statusMessage ?? payload?.message ?? "管理员接口请求失败",
    );
  }
  return response.json() as Promise<T>;
}

export const adminApi = {
  getOverview: () => request<AdminOverview>("/api/admin/overview"),
  listTemplates: () => request<TemplateView[]>("/api/admin/templates"),
  saveTemplate: (draft: TemplateDraft) =>
    request<TemplateView>("/api/admin/templates", {
      method: "POST",
      body: JSON.stringify(draft),
    }),
  publishTemplate: (recordId: string) =>
    request<TemplateView>(`/api/admin/templates/${recordId}/publish`, {
      method: "POST",
      body: "{}",
    }),
  listInstances: (status?: InstanceStatus) => {
    const query = status ? `?status=${status}` : "";
    return request<InstanceView[]>(`/api/admin/instances${query}`);
  },
};
