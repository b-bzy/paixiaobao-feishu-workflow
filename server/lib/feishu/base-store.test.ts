import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({ getTenantAccessToken: vi.fn() }));

import { listExpenseTemplates, saveExpenseTemplateDraft } from "./base-store";
import { getTenantAccessToken } from "./client";

const existingTemplate = {
  record_id: "rec-v3",
  created_time: 1_700_000_000_000,
  last_modified_time: 1_700_000_100_000,
  fields: {
    "Template ID": "expense",
    Name: "员工报销",
    Status: "Published",
    Version: 3,
    "Default Approver Open ID": "ou_approver",
    "Fields JSON": JSON.stringify([
      {
        key: "title",
        label: "事由",
        type: "text",
        required: true,
        multiline: false,
      },
      { key: "amount", label: "金额", type: "number", required: true },
      {
        key: "category",
        label: "类别",
        type: "select",
        required: true,
        options: ["交通"],
      },
      {
        key: "description",
        label: "说明",
        type: "text",
        required: true,
        multiline: true,
      },
    ]),
  },
};

function baseResponse(data: object) {
  return new Response(JSON.stringify({ code: 0, msg: "ok", data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Feishu Base administrator template store", () => {
  beforeEach(() => {
    vi.stubEnv("FEISHU_BASE_APP_TOKEN", "app-token");
    vi.stubEnv("FEISHU_TEMPLATE_TABLE_ID", "tbl-template");
    vi.stubEnv("FEISHU_INSTANCE_TABLE_ID", "tbl-instance");
    vi.mocked(getTenantAccessToken).mockResolvedValue("tenant-token");
  });

  it("maps only the expense templates used by the administrator console", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        baseResponse({
          items: [
            existingTemplate,
            {
              ...existingTemplate,
              record_id: "rec-other",
              fields: { ...existingTemplate.fields, "Template ID": "other" },
            },
          ],
        }),
      ),
    );

    await expect(listExpenseTemplates()).resolves.toMatchObject([
      { recordId: "rec-v3", version: 3, status: "Published" },
    ]);
  });

  it("creates the next template version as a draft", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(baseResponse({ items: [existingTemplate] }))
      .mockResolvedValueOnce(
        baseResponse({
          record: {
            ...existingTemplate,
            record_id: "rec-v4",
            fields: { ...existingTemplate.fields, Status: "Draft", Version: 4 },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const saved = await saveExpenseTemplateDraft({
      name: "员工报销新版",
      defaultApproverOpenId: "ou_approver",
      fields: JSON.parse(existingTemplate.fields["Fields JSON"] as string),
    });

    expect(saved).toMatchObject({
      recordId: "rec-v4",
      version: 4,
      status: "Draft",
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
  });
});
