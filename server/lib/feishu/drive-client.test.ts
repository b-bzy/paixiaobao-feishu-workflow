import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({ getTenantAccessToken: vi.fn() }));

import { getTenantAccessToken } from "./client";
import {
  downloadFeishuDriveFile,
  uploadFeishuBitableAttachment,
  uploadFeishuDriveFile,
} from "./drive-client";

const bytes = new Uint8Array([1, 2, 3]);

describe("Feishu Drive upload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uploads a workbook to the configured folder", async () => {
    vi.mocked(getTenantAccessToken).mockResolvedValue("tenant-token");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        msg: "success",
        data: { file_token: "file-token" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadFeishuDriveFile({
        name: "优惠券.xlsx",
        folderToken: "fld-pilot",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes,
      }),
    ).resolves.toEqual({
      fileToken: "file-token",
      name: "优惠券.xlsx",
      size: 3,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({ Authorization: "Bearer tenant-token" });
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("file_name")).toBe("优惠券.xlsx");
    expect(form.get("parent_type")).toBe("explorer");
    expect(form.get("parent_node")).toBe("fld-pilot");
    expect(form.get("size")).toBe("3");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("returns the Feishu error instead of accepting a missing file token", async () => {
    vi.mocked(getTenantAccessToken).mockResolvedValue("tenant-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ code: 999, msg: "Drive permission denied" }),
      }),
    );

    await expect(
      uploadFeishuDriveFile({
        name: "优惠券.xlsx",
        folderToken: "fld-pilot",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes,
      }),
    ).rejects.toThrow(
      "Feishu Drive file upload failed: Drive permission denied",
    );
  });

  it("downloads a frozen Drive artifact with the tenant token", async () => {
    vi.mocked(getTenantAccessToken).mockResolvedValue("tenant-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(new Uint8Array([4, 5, 6]), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(downloadFeishuDriveFile("file token")).resolves.toEqual(
      new Uint8Array([4, 5, 6]),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/drive/v1/medias/file%20token/download",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({
      headers: { Authorization: "Bearer tenant-token" },
    });
  });

  it("reports a Drive artifact download failure", async () => {
    vi.mocked(getTenantAccessToken).mockResolvedValue("tenant-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
    );

    await expect(downloadFeishuDriveFile("file-token")).rejects.toThrow(
      "Feishu Drive file download failed: 403",
    );
  });

  it("includes Feishu details when a Drive artifact download is denied", async () => {
    vi.mocked(getTenantAccessToken).mockResolvedValue("tenant-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 1061004, msg: "no permission" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(downloadFeishuDriveFile("file-token")).rejects.toThrow(
      "Feishu Drive file download failed: 403 code 1061004: no permission",
    );
  });

  it("uploads a Base-owned file before appending it to a Bitable attachment", async () => {
    vi.mocked(getTenantAccessToken).mockResolvedValue("tenant-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          msg: "success",
          data: { file_token: "base-file-token" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, msg: "success", data: {} }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadFeishuBitableAttachment({
        baseAppToken: "app-base",
        tableId: "tbl-pilot",
        recordId: "rec-pilot",
        fieldName: "Generated Coupon File",
        name: "配券信息表.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes,
      }),
    ).resolves.toBe("base-file-token");

    const [, uploadInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const uploadForm = uploadInit.body as FormData;
    expect(uploadForm.get("parent_type")).toBe("bitable_file");
    expect(uploadForm.get("parent_node")).toBe("app-base");
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      "/base/v3/bases/app-base/tables/tbl-pilot/append_attachments",
    );
    expect(
      JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)),
    ).toEqual({
      attachments: {
        "rec-pilot": {
          "Generated Coupon File": [{ file_token: "base-file-token" }],
        },
      },
    });
  });

  it("does not append an attachment when Base media upload fails", async () => {
    vi.mocked(getTenantAccessToken).mockResolvedValue("tenant-token");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ code: 999, msg: "Base upload denied" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadFeishuBitableAttachment({
        baseAppToken: "app-base",
        tableId: "tbl-pilot",
        recordId: "rec-pilot",
        fieldName: "Generated Coupon File",
        name: "配券信息表.xlsx",
        contentType: "application/octet-stream",
        bytes,
      }),
    ).rejects.toThrow(
      "Feishu Base attachment upload failed: Base upload denied",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
