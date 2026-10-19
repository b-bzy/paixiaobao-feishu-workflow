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
  listActiveCouponThreeSourcePilotDrafts,
  normalizeCouponThreeSourcePilotDraftState,
  toStoredWorkbookRecognition,
  updateCouponThreeSourcePilotDraft,
} from "./store";

type BaseFields = Record<string, unknown>;

function okRecord(recordId: string, fields: BaseFields) {
  return {
    ok: true,
    json: async () => ({
      code: 0,
      msg: "success",
      data: { record: { record_id: recordId, fields } },
    }),
  };
}

/**
 * Method-aware Base fake: POST creates, GET returns the currently stored
 * record, PUT overwrites it. `storedFields` simulates concurrent writers so
 * tests can move the stored revision behind the caller's back.
 */
function baseFake(recordId = "rec-three-source") {
  let storedFields: BaseFields = {};
  const calls: Array<{ method: string; bodyFields?: BaseFields }> = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const method = (init.method ?? "GET").toUpperCase();
    const bodyFields = init.body
      ? (JSON.parse(String(init.body)).fields as BaseFields)
      : undefined;
    calls.push({ method, bodyFields });
    if (method === "GET") return okRecord(recordId, storedFields);
    storedFields = { ...bodyFields };
    return okRecord(recordId, storedFields);
  });
  return {
    fetchMock,
    calls,
    setStored: (fields: BaseFields) => {
      storedFields = fields;
    },
    putCount: () => calls.filter((call) => call.method === "PUT").length,
  };
}

function callFields(call: unknown[]): BaseFields {
  const init = call[1] as RequestInit;
  return JSON.parse(String(init.body)).fields as BaseFields;
}

/**
 * The authoritative revision/status live inside the State JSON blob; the
 * Revision/Status columns are display-only. Concurrent writers therefore
 * patch the stored task through this helper.
 */
function withStoredTask(
  fields: BaseFields,
  patch: {
    revision?: number;
    status?: string;
  },
): BaseFields {
  const stored = JSON.parse(String(fields["State JSON"]));
  return {
    ...fields,
    "State JSON": JSON.stringify({
      ...stored,
      task: { ...stored.task, ...patch },
    }),
  };
}

async function seedDraft() {
  return createCouponThreeSourcePilotDraft({
    ownerOpenId: "ou_test",
    task: createCouponThreeSourceTask({
      taskId: "CTS-test",
      ownerOpenId: "ou_test",
    }),
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
    const { fetchMock } = baseFake("rec-created");
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
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const fields = JSON.parse(String(init.body)).fields;
    expect(fields["Task ID"]).toBe("CTS-test");
    expect(fields["State JSON"]).not.toContain("source bytes");
  });

  it("rejects a stale expected revision before a Base write", async () => {
    const { fetchMock } = baseFake();
    vi.stubGlobal("fetch", fetchMock);
    const draft = await seedDraft();

    await expect(
      updateCouponThreeSourcePilotDraft(draft, {}, draft.task.revision + 1),
    ).rejects.toThrow("version changed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to overwrite a newer stored revision with a stale snapshot", async () => {
    const fake = baseFake();
    vi.stubGlobal("fetch", fake.fetchMock);
    const draft = await seedDraft();

    const createdFields = callFields(fake.fetchMock.mock.calls[0]);
    fake.setStored(
      withStoredTask(createdFields, {
        revision: draft.task.revision + 1,
        status: "AwaitingSourceConfirmation",
      }),
    );

    await expect(
      updateCouponThreeSourcePilotDraft(draft, {}, draft.task.revision),
    ).rejects.toThrow("version changed");
    expect(fake.putCount()).toBe(0);
  });

  it("writes on top of the freshly stored state when the revision matches", async () => {
    const fake = baseFake();
    vi.stubGlobal("fetch", fake.fetchMock);
    const draft = await seedDraft();

    const updated = await updateCouponThreeSourcePilotDraft(
      draft,
      { validationIssues: ["测试标记"] },
      draft.task.revision,
    );

    expect(fake.putCount()).toBe(1);
    const putFields = fake.calls.find((call) => call.method === "PUT")
      ?.bodyFields as BaseFields;
    expect(putFields.Revision).toBe(draft.task.revision);
    expect(String(putFields["State JSON"])).toContain("测试标记");
    expect(updated.validationIssues).toEqual(["测试标记"]);
    expect(updated.task.revision).toBe(draft.task.revision);
  });

  it("refuses to write when the stored draft was concurrently canceled", async () => {
    const fake = baseFake();
    vi.stubGlobal("fetch", fake.fetchMock);
    const draft = await seedDraft();
    const createdFields = callFields(fake.fetchMock.mock.calls[0]);
    fake.setStored(withStoredTask(createdFields, { status: "Canceled" }));

    await expect(
      updateCouponThreeSourcePilotDraft(draft, {}, draft.task.revision),
    ).rejects.toThrow("cannot be changed");
    expect(fake.putCount()).toBe(0);
  });

  it("fails closed when the write-back echoes a different revision", async () => {
    const fake = baseFake();
    vi.stubGlobal("fetch", fake.fetchMock);
    const draft = await seedDraft();
    const createdFields = callFields(fake.fetchMock.mock.calls[0]);
    // Realistic read-after-write anomaly: the PUT echoes the new state but a
    // fresh GET still shows the pre-write record.
    fake.fetchMock.mockImplementation(
      async (_url: string, init: RequestInit) => {
        const method = (init.method ?? "GET").toUpperCase();
        const bodyFields = init.body
          ? (JSON.parse(String(init.body)).fields as BaseFields)
          : undefined;
        if (method === "GET" || method === "PUT") {
          if (method === "PUT" && bodyFields) {
            return okRecord("rec-three-source", bodyFields);
          }
          return okRecord("rec-three-source", createdFields);
        }
        return okRecord("rec-three-source", createdFields);
      },
    );

    await expect(
      updateCouponThreeSourcePilotDraft(
        draft,
        {
          task: {
            ...draft.task,
            revision: draft.task.revision + 1,
            status: "AwaitingFinalConfirmation",
          },
        },
        draft.task.revision,
      ),
    ).rejects.toThrow("persistence verification failed");
  });

  it("refuses to write a state that exceeds the Base storage budget", async () => {
    const fake = baseFake();
    vi.stubGlobal("fetch", fake.fetchMock);
    const draft = await seedDraft();
    const huge = {
      entries: Array.from(
        { length: 4_000 },
        (_, index) => `SKU-diag-${index}-商品占位名称文本`,
      ),
    };

    await expect(
      updateCouponThreeSourcePilotDraft(
        draft,
        { whitelist: huge } as never,
        draft.task.revision,
      ),
    ).rejects.toThrow("超出 Base 存储预算");
    expect(fake.putCount()).toBe(0);
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

  it("normalizes compatible legacy state with missing nested collections", () => {
    const task = createCouponThreeSourceTask({
      taskId: "CTS-legacy",
      ownerOpenId: "ou_test",
    });
    const source = {
      messageId: "om-legacy",
      fileKey: "file-legacy",
      fileName: "legacy.xlsx",
      bytes: 3,
      sha256: "a".repeat(64),
    };
    const legacy = {
      task: {
        ...task,
        artifacts: undefined,
        confirmedCalcImages: undefined,
        pendingCalcImages: undefined,
        processedCalcImageOperationIds: undefined,
      },
      recognitions: {
        whitelist: {
          source,
          sourceHash: source.sha256,
          roleCandidates: undefined,
          couponFieldCandidates: undefined,
          listCandidates: undefined,
          issues: undefined,
          ai: {
            runId: "run-legacy",
            revision: 1,
            sourceSha256: source.sha256,
            status: "succeeded",
            result: {
              sourceHash: source.sha256,
              roleCandidates: undefined,
              couponCandidates: undefined,
              fieldCandidates: undefined,
              listCandidates: undefined,
              issues: undefined,
            },
          },
        },
      },
      selections: undefined,
      artifacts: undefined,
      processedMessageIds: undefined,
      validationIssues: undefined,
      failureReason: "Cannot read properties of undefined (reading 'sheets')",
    } as unknown as Parameters<
      typeof normalizeCouponThreeSourcePilotDraftState
    >[0];

    const normalized = normalizeCouponThreeSourcePilotDraftState(legacy);
    const recognition = normalized.recognitions.whitelist;
    expect(normalized.task.artifacts).toEqual([]);
    expect(normalized.task.confirmedCalcImages).toEqual([]);
    expect(normalized.selections).toEqual({});
    expect(normalized.processedMessageIds).toEqual([]);
    expect(normalized.failureReason).toBe(
      "系统未完成本次处理，已保留当前材料，请稍后重试或联系处理。",
    );
    expect(recognition?.roleCandidates).toEqual([]);
    expect(recognition?.couponFieldCandidates).toEqual({});
    expect(recognition?.ai?.result?.fieldCandidates).toEqual([]);
    expect(recognition?.ai?.result?.skuRegionCandidates).toEqual([]);
    expect(normalizeCouponThreeSourcePilotDraftState(normalized)).toEqual(
      normalized,
    );
  });
});

describe("listActiveCouponThreeSourcePilotDrafts pagination", () => {
  beforeEach(() => {
    vi.mocked(getTenantAccessToken).mockResolvedValue("tenant-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function storedFields(recordId: string, ownerOpenId: string): BaseFields {
    const task = createCouponThreeSourceTask({
      taskId: `CTS-${recordId}`,
      ownerOpenId,
    });
    return {
      "Pilot ID": `CTS-${recordId}`,
      "Owner Open ID": ownerOpenId,
      Status: task.status,
      Revision: task.revision,
      "Schema Version": "coupon-three-source-r2-v2",
      "Task ID": task.taskId,
      "State JSON": JSON.stringify({
        task,
        recognitions: {},
        pendingSources: [],
        selections: {},
        artifacts: [],
        processedMessageIds: [],
        validationIssues: [],
      }),
    };
  }

  type ListRecord = { record_id: string; fields: BaseFields };

  function pagedFake(pages: Array<{ items: ListRecord[] }>) {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(String(url));
      const token = new URL(url).searchParams.get("page_token");
      const index = token ? Number(token) : 0;
      const page = pages[index] ?? { items: [] };
      const hasMore = index + 1 < pages.length;
      return {
        ok: true,
        json: async () => ({
          code: 0,
          msg: "success",
          data: {
            items: page.items,
            has_more: hasMore,
            ...(hasMore ? { page_token: String(index + 1) } : {}),
          },
        }),
      };
    });
    return { fetchMock, urls };
  }

  // 2026-10-19 事故回归：表超过 100 条后，活跃草稿落在第 2 页，
  // 旧实现只读第一页导致文件被静默丢弃、/clear 误报没有未完成提报。
  it("finds an active draft hiding on page 2 of a >100-record table", async () => {
    const fillers = Array.from({ length: 100 }, (_, index) => ({
      record_id: `rec-filler-${index}`,
      fields: storedFields(`filler-${index}`, "ou_someone_else"),
    }));
    const active = {
      record_id: "rec-page2",
      fields: storedFields("page2", "ou_test"),
    };
    const { fetchMock, urls } = pagedFake([
      { items: fillers },
      { items: [active] },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const activeDrafts =
      await listActiveCouponThreeSourcePilotDrafts("ou_test");

    expect(activeDrafts.map((draft) => draft.recordId)).toEqual(["rec-page2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urls[0]).toContain("page_size=100");
    expect(urls[0]).not.toContain("page_token");
    expect(urls[1]).toContain("page_token=1");
  });
});
