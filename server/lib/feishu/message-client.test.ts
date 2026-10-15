import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  getTenantAccessToken: vi.fn(async () => "tenant-token"),
}));

import { downloadFeishuMessageResource } from "./message-client";

describe("Feishu message resources", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("bounds source downloads with an abort signal", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(4),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadFeishuMessageResource({
        messageId: "om-source",
        fileKey: "file-source",
        type: "file",
      }),
    ).resolves.toHaveLength(4);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
