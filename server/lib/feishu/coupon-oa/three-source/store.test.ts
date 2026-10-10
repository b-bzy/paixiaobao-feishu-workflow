import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../client", () => ({ getTenantAccessToken: vi.fn() }));
vi.mock("./pilot-config", () => ({
  getCouponThreeSourcePilotBaseAppToken: vi.fn(() => "app-three-source"),
  getCouponThreeSourcePilotTableId: vi.fn(() => "tblThreeSource"),
}));

import { createCouponThreeSourceTask } from "../../../coupon-oa/three-source/task";
import { getTenantAccessToken } from "../../client";
import {
  createCouponThreeSourcePilotDraft,
  toStoredWorkbookRecognition,
  updateCouponThreeSourcePilotDraft,
} from "./store";

function respondingFetch(recordId = "rec-three-source") {
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

describe("three-source pilot Base store", () => {
  beforeEach(() => {
    vi.mocked(getTenantAccessToken).mockResolvedValue("tenant-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("persists one task state without source bytes", async () => {
    const fetchMock = respondingFetch("rec-created");
    vi.stubGlobal("fetch", fetchMock);
    const task = createCouponThreeSourceTask({
      taskId: "CTS-test",
      ownerOpenId: "ou_test",
    });

    const created = await createCouponThreeSourcePilotDraft({
      ownerOpenId: "ou_test",
      task,
    });

    expect(created).toMatchObject({
      recordId: "rec-created",
      ownerOpenId: "ou_test",
      task: { taskId: "CTS-test", revision: 1, status: "Collecting" },
      recognitions: {},
      artifacts: [],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/apps/app-three-source/tables/tblThreeSource/");
    const fields = JSON.parse(String(init.body)).fields;
    expect(fields["Task ID"]).toBe("CTS-test");
    expect(fields["State JSON"]).not.toContain("source bytes");
  });

  it("rejects a stale expected revision before a Base write", async () => {
    const fetchMock = respondingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const draft = await createCouponThreeSourcePilotDraft({
      ownerOpenId: "ou_test",
      task: createCouponThreeSourceTask({
        taskId: "CTS-test",
        ownerOpenId: "ou_test",
      }),
    });

    await expect(
      updateCouponThreeSourcePilotDraft(draft, {}, draft.task.revision + 1),
    ).rejects.toThrow("version changed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("drops workbook bytes when it stores a recognition result", () => {
    const stored = toStoredWorkbookRecognition({
      source: {
        messageId: "om_test",
        fileKey: "file_test",
        fileName: "source.xlsx",
        bytes: 3,
        sha256: "a".repeat(64),
      },
      recognition: {
        source: { fileName: "source.xlsx", bytes: new Uint8Array([1, 2, 3]) },
        sourceHash: "a".repeat(64),
        roleCandidates: [],
        couponFieldCandidates: {},
        listCandidates: [],
        issues: [],
      },
    });
    expect(JSON.stringify(stored)).not.toContain("1,2,3");
  });
});
