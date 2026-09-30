import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({ getTenantAccessToken: vi.fn() }));
vi.mock("./excel-pilot-config", () => ({
  getCouponExcelPilotTableId: vi.fn(() => "tblPilot"),
}));

import { getTenantAccessToken } from "../client";
import {
  type CouponExcelPilotDraft,
  createCouponExcelPilotDraft,
  sourceFileMetadata,
  updateCouponExcelPilotDraft,
} from "./excel-pilot-store";

const originalBaseAppToken = process.env.FEISHU_BASE_APP_TOKEN;

function respondingFetch(recordId = "rec-pilot") {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      fields: Record<string, unknown>;
    };
    return {
      ok: true,
      json: async () => ({
        code: 0,
        msg: "success",
        data: { record: { record_id: recordId, fields: body.fields } },
      }),
    };
  });
}

const draft = {
  recordId: "rec-pilot",
  pilotId: "CEP-test",
  ownerOpenId: "ou_test",
  status: "AwaitingOutputConfirmation",
  revision: 2,
  schemaVersion: "coupon-excel-pilot-v1",
  artifacts: [
    {
      role: "couponTable",
      fileName: "配券.xlsx",
      fileToken: "file-coupon",
      baseFileToken: "base-file-coupon",
      bytes: 100,
      sha256: "a".repeat(64),
      templateId: "coupon-regular-full-reduction-v1",
      templateVersion: "v1",
    },
    {
      role: "productWhitelist",
      fileName: "白名单.xlsx",
      fileToken: "file-whitelist",
      baseFileToken: "base-file-whitelist",
      bytes: 200,
      sha256: "b".repeat(64),
      templateId: "coupon-sku-whitelist-pilot-v1",
      templateVersion: "v1",
    },
  ],
  validationIssues: [],
  processedMessageIds: ["om-source"],
} as CouponExcelPilotDraft;

describe("coupon Excel pilot Base store", () => {
  beforeEach(() => {
    process.env.FEISHU_BASE_APP_TOKEN = "app-pilot";
  });

  afterEach(() => {
    if (originalBaseAppToken === undefined) {
      delete process.env.FEISHU_BASE_APP_TOKEN;
    } else {
      process.env.FEISHU_BASE_APP_TOKEN = originalBaseAppToken;
    }
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("creates a dedicated pilot draft with its initial revision", async () => {
    vi.mocked(getTenantAccessToken).mockResolvedValue("tenant-token");
    const fetchMock = respondingFetch("rec-created");
    vi.stubGlobal("fetch", fetchMock);

    const created = await createCouponExcelPilotDraft({
      ownerOpenId: "ou_test",
      schemaVersion: "coupon-excel-pilot-v1",
    });

    expect(created).toMatchObject({
      recordId: "rec-created",
      ownerOpenId: "ou_test",
      status: "Collecting",
      revision: 1,
      artifacts: [],
      processedMessageIds: [],
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const fields = JSON.parse(String(init.body)).fields;
    expect(fields["Generated Coupon File"]).toEqual([]);
    expect(fields["Generated Whitelist File"]).toEqual([]);
    expect(fields["OA Handoff JSON"]).toBe("null");
  });

  it("increments revisions and writes Base-owned files to attachment fields", async () => {
    vi.mocked(getTenantAccessToken).mockResolvedValue("tenant-token");
    const fetchMock = respondingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const updated = await updateCouponExcelPilotDraft(draft, {
      status: "GeneratedConfirmed",
    });

    expect(updated).toMatchObject({
      status: "GeneratedConfirmed",
      revision: 3,
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const fields = JSON.parse(String(init.body)).fields;
    expect(fields.Revision).toBe(3);
    expect(fields["Generated Coupon File"]).toEqual([
      { file_token: "base-file-coupon", name: "配券.xlsx", size: 100 },
    ]);
    expect(fields["Generated Whitelist File"]).toEqual([
      { file_token: "base-file-whitelist", name: "白名单.xlsx", size: 200 },
    ]);
  });

  it("does not write normal Drive tokens into Base attachment fields", async () => {
    vi.mocked(getTenantAccessToken).mockResolvedValue("tenant-token");
    const fetchMock = respondingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const driveOnlyDraft = {
      ...draft,
      artifacts: draft.artifacts.map(
        ({ baseFileToken: _, ...artifact }) => artifact,
      ),
    } as CouponExcelPilotDraft;

    await updateCouponExcelPilotDraft(driveOnlyDraft, {
      status: "Generating",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const fields = JSON.parse(String(init.body)).fields;
    expect(fields["Generated Coupon File"]).toEqual([]);
    expect(fields["Generated Whitelist File"]).toEqual([]);
  });

  it("does not change a confirmed pilot draft", async () => {
    await expect(
      updateCouponExcelPilotDraft(
        { ...draft, status: "GeneratedConfirmed" },
        { failureReason: "should not write" },
      ),
    ).rejects.toThrow(
      "Confirmed or canceled Excel pilot drafts cannot be changed",
    );
  });

  it("records source-file size and hash without retaining its bytes", () => {
    expect(
      sourceFileMetadata({
        messageId: "om-source",
        fileKey: "file-key",
        fileName: "source.xlsx",
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).toEqual({
      messageId: "om-source",
      fileKey: "file-key",
      fileName: "source.xlsx",
      bytes: 3,
      sha256:
        "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      candidates: undefined,
    });
  });
});
