import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractCouponPilotFields } from "./deepseek-client";

describe("DeepSeek coupon extraction", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    process.env.DEEPSEEK_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("parses the JSON-only field candidate", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                fields: { activityName: "测试活动", channels: ["JD"] },
                missingFields: ["thresholdYuan"],
                ambiguousFields: [],
                unparsedText: "",
              }),
            },
          },
        ],
      }),
    });

    await expect(
      extractCouponPilotFields("活动名称：测试活动"),
    ).resolves.toEqual(
      expect.objectContaining({
        fields: { activityName: "测试活动", channels: ["JD"] },
        missingFields: ["thresholdYuan"],
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepseek.com/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects malformed model JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "not json" } }] }),
    });

    await expect(extractCouponPilotFields("测试")).rejects.toThrow("有效 JSON");
  });
});
