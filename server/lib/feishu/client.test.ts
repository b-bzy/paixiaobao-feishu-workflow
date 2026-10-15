import { afterEach, describe, expect, it, vi } from "vitest";
import { sendFeishuCardWithReceipt, updateFeishuCard } from "./client";
import type { FeishuCard } from "./expense-poc";

const card: FeishuCard = {
  schema: "2.0",
  config: { update_multi: true, width_mode: "default" },
  header: {},
  body: {
    direction: "vertical",
    padding: "0",
    vertical_spacing: "0",
    elements: [],
  },
};

describe("Feishu card messages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns the created card message ID", async () => {
    vi.stubEnv("FEISHU_APP_ID", "app-id");
    vi.stubEnv("FEISHU_APP_SECRET", "app-secret");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          msg: "ok",
          tenant_access_token: "token",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          msg: "ok",
          data: { message_id: "om-card" },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendFeishuCardWithReceipt("ou-owner", card, "semantic-key"),
    ).resolves.toEqual({ messageId: "om-card" });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("uuid=semantic-key");
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("patches an existing updateable card", async () => {
    vi.stubEnv("FEISHU_APP_ID", "app-id");
    vi.stubEnv("FEISHU_APP_SECRET", "app-secret");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          msg: "ok",
          tenant_access_token: "token",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, msg: "ok" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await updateFeishuCard("om card", card);

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://open.feishu.cn/open-apis/im/v1/messages/om%20card",
    );
    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(init.method).toBe("PATCH");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init.body))).toEqual({
      content: JSON.stringify(card),
    });
  });
});
