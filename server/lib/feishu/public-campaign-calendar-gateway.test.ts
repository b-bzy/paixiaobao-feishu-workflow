import { describe, expect, it, vi } from "vitest";
import { createPublicCampaignCalendarGateway } from "./public-campaign-calendar-gateway";

const config = {
  enabled: true,
  endpoint: "https://calendar.example/v1/campaigns",
  timeoutMs: 1_000,
  maxResponseBytes: 262_144,
} as const;

describe("public campaign calendar gateway", () => {
  it("sends only the bounded date query", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect([...url.searchParams.keys()].sort()).toEqual([
        "end_month_day",
        "locale",
        "query_version",
        "start_month_day",
      ]);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              name: "双十一大促",
              startDate: "2026-11-01",
              endDate: "2026-11-11",
              sourceUrl: "https://calendar.example/evidence/1",
              fetchedAt: "2026-10-12T00:00:00.000Z",
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    const result = await createPublicCampaignCalendarGateway(
      config,
      fetchImpl as typeof fetch,
    ).lookup({
      startMonthDay: "11-01",
      endMonthDay: "11-11",
      locale: "zh-CN",
      queryVersion: "v1",
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("rejects local endpoints and invalid provider payloads", async () => {
    expect(() =>
      createPublicCampaignCalendarGateway({
        ...config,
        endpoint: "https://localhost/calendar",
      }),
    ).toThrow("host is not allowed");
    const result = await createPublicCampaignCalendarGateway(
      config,
      (async () =>
        new Response("<html></html>", {
          headers: { "content-type": "text/html" },
        })) as typeof fetch,
    ).lookup({
      startMonthDay: "11-01",
      endMonthDay: "11-11",
      locale: "zh-CN",
      queryVersion: "v1",
    });
    expect(result).toEqual({ ok: false, code: "invalid_json" });
  });
});
