import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({ getTenantAccessToken: vi.fn() }));

import { getTenantAccessToken } from "../client";
import {
  type CouponOaDraft,
  type CouponOaDraftStatus,
  listActiveCouponOaDrafts,
  persistCouponOaSubmissionOutcome,
  saveCouponOaDraft,
  updateCouponOaDraft,
} from "./draft-store";

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
  status: CouponOaDraftStatus = "Draft",
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
      .mockResolvedValueOnce(success({ record: record(fields()) }))
      .mockResolvedValueOnce(
        success({
          record: record(fields({ ...values, activityName: "更新后的活动" })),
        }),
      );

    await saveCouponOaDraft({
      ownerOpenId: "ou_submitter",
      schemaVersion: "coupon-oa-submit-schema-v1",
      values: { ...values, activityName: "更新后的活动" },
    });

    // list (GET) + storage guard (GET) + update (PUT)
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/records/rec-draft");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "PUT" });
    expect(fetchMock.mock.calls[2]?.[1]?.body).toContain("更新后的活动");
    expect(fetchMock.mock.calls[2]?.[1]?.body).toContain(
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

function draftSnapshot(
  status: "Confirmed" | "Submitting" | "Submitted" = "Confirmed",
): CouponOaDraft {
  const parsed = JSON.parse(fields(values, status)["Fields JSON"] as string);
  return {
    recordId: "rec-draft",
    draftId: "COA-existing",
    ownerOpenId: "ou_submitter",
    status,
    schemaVersion: "coupon-three-source-pilot-v1",
    values: parsed,
    attachments: [],
    validationIssues: [],
  };
}

describe("updateCouponOaDraft storage guard", () => {
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

  it("rejects a stale snapshot when the stored status drifted", async () => {
    fetchMock.mockResolvedValueOnce(
      success({ record: record(fields(values, "Submitting")) }),
    );

    await expect(
      updateCouponOaDraft(draftSnapshot("Confirmed"), { status: "Submitting" }),
    ).rejects.toThrow("status changed concurrently");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a write when the stored draft already reached a terminal state", async () => {
    fetchMock.mockResolvedValueOnce(
      success({ record: record(fields(values, "Submitted")) }),
    );

    await expect(
      updateCouponOaDraft(draftSnapshot("Submitting"), {
        status: "SubmissionUnknown",
      }),
    ).rejects.toThrow("already Submitted");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("verifies the intended status was persisted and returns it", async () => {
    fetchMock
      .mockResolvedValueOnce(
        success({ record: record(fields(values, "Confirmed")) }),
      )
      .mockResolvedValueOnce(
        success({ record: record(fields(values, "Confirmed")) }),
      );

    await expect(
      updateCouponOaDraft(draftSnapshot(), { status: "Confirmed" }),
    ).resolves.toMatchObject({ status: "Confirmed" });

    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PUT" });
  });
});

describe("persistCouponOaSubmissionOutcome", () => {
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

  it("never overwrites an outcome a concurrent attempt already settled", async () => {
    fetchMock.mockResolvedValueOnce(
      success({ record: record(fields(values, "Submitted")) }),
    );

    await expect(
      persistCouponOaSubmissionOutcome(draftSnapshot("Submitting"), {
        status: "SubmissionUnknown",
      }),
    ).resolves.toMatchObject({ status: "Submitted" });

    // Only the re-read GET happened; no PUT may follow.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("writes the outcome from the fresh stored snapshot otherwise", async () => {
    fetchMock
      .mockResolvedValueOnce(
        success({ record: record(fields(values, "Submitting")) }),
      )
      .mockResolvedValueOnce(
        success({ record: record(fields(values, "Submitting")) }),
      )
      .mockResolvedValueOnce(
        success({ record: record(fields(values, "CreatedNeedsReview")) }),
      );

    await expect(
      persistCouponOaSubmissionOutcome(draftSnapshot("Submitting"), {
        status: "CreatedNeedsReview",
      }),
    ).resolves.toMatchObject({ status: "CreatedNeedsReview" });

    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "PUT" });
  });
});

describe("listActiveCouponOaDrafts pagination", () => {
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

  function pagedResponse(index: number, pageCount: number) {
    const hasMore = index + 1 < pageCount;
    return {
      ok: true,
      json: async () => ({
        code: 0,
        msg: "ok",
        data: {
          items: hasMore || index === 1 ? [record(fields())] : [],
          has_more: hasMore,
          ...(hasMore ? { page_token: String(index + 1) } : {}),
        },
      }),
    };
  }

  // 2026-10-19 事故回归：OA 草稿表过百条后，互斥检查不能对第 2 页失明。
  it("sees an active draft on page 2 when the table exceeds one page", async () => {
    const urls: string[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      urls.push(String(url));
      const token = new URL(url).searchParams.get("page_token");
      return pagedResponse(token ? Number(token) : 0, 2);
    });

    const drafts = await listActiveCouponOaDrafts("ou_submitter");

    expect(drafts).toHaveLength(2);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("page_size=100");
    expect(urls[0]).not.toContain("page_token");
    expect(urls[1]).toContain("page_token=1");
  });
});
