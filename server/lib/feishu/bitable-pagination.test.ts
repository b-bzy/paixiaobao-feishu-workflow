import { describe, expect, it } from "vitest";
import {
  bitableRecordsPath,
  listAllBitableRecords,
} from "./bitable-pagination";

describe("bitable pagination", () => {
  it("aggregates every page following page_token until has_more is false", async () => {
    const requestedTokens: Array<string | undefined> = [];
    const items = await listAllBitableRecords<{ id: string }>(
      async (pageToken) => {
        requestedTokens.push(pageToken);
        if (!pageToken) {
          return {
            items: [{ id: "a" }],
            page_token: "tok-2",
            has_more: true,
          };
        }
        return { items: [{ id: "b" }], has_more: false };
      },
    );
    expect(items).toEqual([{ id: "a" }, { id: "b" }]);
    expect(requestedTokens).toEqual([undefined, "tok-2"]);
  });

  it("returns the first page untouched when has_more is absent", async () => {
    const items = await listAllBitableRecords<{ id: string }>(async () => ({
      items: [{ id: "only" }],
    }));
    expect(items).toEqual([{ id: "only" }]);
  });

  it("keeps going when a page is empty but has_more is true", async () => {
    const items = await listAllBitableRecords<{ id: string }>(
      async (pageToken) => {
        if (!pageToken)
          return { items: [], page_token: "tok-2", has_more: true };
        return { items: [{ id: "late" }], has_more: false };
      },
    );
    expect(items).toEqual([{ id: "late" }]);
  });

  it("fails loudly when has_more is true but page_token is missing", async () => {
    await expect(
      listAllBitableRecords(async () => ({
        items: [{ id: "a" }],
        has_more: true,
      })),
    ).rejects.toThrow(/page_token is missing/);
  });

  it("fails loudly when the endpoint repeats a page_token", async () => {
    await expect(
      listAllBitableRecords<{ id: string }>(async () => ({
        items: [{ id: "a" }],
        page_token: "same",
        has_more: true,
      })),
    ).rejects.toThrow(/page_token repeated/);
  });

  it("gives up after the page budget instead of looping forever", async () => {
    let calls = 0;
    await expect(
      listAllBitableRecords<{ id: string }>(async () => {
        calls += 1;
        return {
          items: [{ id: String(calls) }],
          page_token: `tok-${calls}`,
          has_more: true,
        };
      }),
    ).rejects.toThrow(/exceeded 100 pages/);
    expect(calls).toBe(100);
  });

  it("builds record list paths with a fixed page size and optional token", () => {
    expect(bitableRecordsPath({ appToken: "app", tableId: "tbl" })).toBe(
      "/bitable/v1/apps/app/tables/tbl/records?page_size=100",
    );
    expect(
      bitableRecordsPath({
        appToken: "app",
        tableId: "tbl",
        pageToken: "a/b c",
      }),
    ).toBe(
      "/bitable/v1/apps/app/tables/tbl/records?page_size=100&page_token=a%2Fb+c",
    );
  });
});
