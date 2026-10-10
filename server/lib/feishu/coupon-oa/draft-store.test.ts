import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({ getTenantAccessToken: vi.fn() }));

import { getTenantAccessToken } from "../client";
import { saveCouponOaDraft } from "./draft-store";

const values = {
  applicationType: "优惠券申请" as const,
  businessMode: "严选" as const,
  activityName: "测试活动",
  activityBackground: "测试背景",
  overDeduction: "否" as const,
  overDeductionReason: "",
  channels: ["京东渠道"],
  activityStartAt: "2030-01-01",
  activityEndAt: "2030-01-02",
};

function record(fields: Record<string, unknown>) {
  return {
    record_id: "rec-draft",
    created_time: 1_893_456_000_000,
    last_modified_time: 1_893_456_000_000,
    fields,
  };
}

function fields(
  input = values,
  status: "Draft" | "Confirmed" | "Submitting" | "SubmissionUnknown" = "Draft",
): Record<string, unknown> {
  return {
    "Draft ID": "COA-existing",
    "Owner Open ID": "ou_submitter",
    Status: status,
    "Schema Version": "coupon-oa-submit-schema-v1",
    "Definition Hash": "",
    "Fields JSON": JSON.stringify(input),
    "Attachments JSON": "[]",
    "Validation Issues JSON": "[]",
    "Confirmed At": null,
    "Approval Instance Code": "",
    "Approval Instance Link": "",
    "Failure Reason": "",
  };
}

function success(data: Record<string, unknown>) {
  return { ok: true, json: async () => ({ code: 0, msg: "ok", data }) };
}

describe("saveCouponOaDraft", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    vi.mocked(getTenantAccessToken).mockResolvedValue("tenant-token");
    process.env.FEISHU_BASE_APP_TOKEN = "appCouponDraft";
    process.env.FEISHU_COUPON_DRAFT_TABLE_ID = "tblCouponDraft";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FEISHU_BASE_APP_TOKEN;
    delete process.env.FEISHU_COUPON_DRAFT_TABLE_ID;
  });

  it("creates a Base record when the owner has no active draft", async () => {
    fetchMock
      .mockResolvedValueOnce(success({ items: [] }))
      .mockResolvedValueOnce(success({ record: record(fields()) }));

    const draft = await saveCouponOaDraft({
      ownerOpenId: "ou_submitter",
      schemaVersion: "coupon-oa-submit-schema-v1",
      values,
    });

    expect(draft.draftId).toBe("COA-existing");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
  });

  it("updates the active draft instead of creating a duplicate record", async () => {
    fetchMock
      .mockResolvedValueOnce(success({ items: [record(fields())] }))
      .mockResolvedValueOnce(success({ record: record(fields()) }));

    await saveCouponOaDraft({
      ownerOpenId: "ou_submitter",
      schemaVersion: "coupon-oa-submit-schema-v1",
      values: { ...values, activityName: "更新后的活动" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/records/rec-draft");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PUT" });
    expect(fetchMock.mock.calls[1]?.[1]?.body).toContain("更新后的活动");
    expect(fetchMock.mock.calls[1]?.[1]?.body).toContain(
      '"Attachments JSON":"[]"',
    );
  });

  it.each(["Confirmed", "Submitting", "SubmissionUnknown"] as const)(
    "does not overwrite an active %s draft",
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        success({ items: [record(fields(values, status))] }),
      );

      await expect(
        saveCouponOaDraft({
          ownerOpenId: "ou_submitter",
          schemaVersion: "coupon-oa-submit-schema-v1",
          values: { ...values, activityName: "不应覆盖" },
        }),
      ).rejects.toThrow("awaiting confirmation or reconciliation");

      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});
