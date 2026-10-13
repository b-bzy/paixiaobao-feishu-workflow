import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({ getTenantAccessToken: vi.fn() }));

import { getTenantAccessToken } from "./client";
import {
  downloadFeishuDriveFile,
  grantFeishuDriveFileViewPermission,
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

describe("Feishu Drive preview permission grant", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("grants view permission to the pilot owner with a timeout", async () => {
    vi.mocked(getTenantAccessToken).mockResolvedValue("tenant-token");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, msg: "success", data: {} }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      grantFeishuDriveFileViewPermission({
        fileToken: "file-token",
        memberOpenId: "ou_owner",
      }),
    ).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://open.feishu.cn/open-apis/drive/v1/permissions/file-token/members?type=file",
    );
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer tenant-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      perm: "view",
      member_type: "openid",
      member_id: "ou_owner",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports Feishu error details when the grant is denied", async () => {
    vi.mocked(getTenantAccessToken).mockResolvedValue("tenant-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ code: 1061004, msg: "no permission" }),
      }),
    );

    await expect(
      grantFeishuDriveFileViewPermission({
        fileToken: "file-token",
        memberOpenId: "ou_owner",
      }),
    ).rejects.toThrow(
      "Feishu Drive file permission grant failed: 403 code 1061004: no permission",
    );
  });

  it("keeps failing on a non-JSON error response without details", async () => {
    vi.mocked(getTenantAccessToken).mockResolvedValue("tenant-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
    );

    await expect(
      grantFeishuDriveFileViewPermission({
        fileToken: "file-token",
        memberOpenId: "ou_owner",
      }),
    ).rejects.toThrow("Feishu Drive file permission grant failed: 500");
  });

  it("treats code 1063003 as success only when the read-back confirms the member", async () => {
    vi.mocked(getTenantAccessToken).mockResolvedValue("tenant-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ code: 1063003, msg: "forbidden operation" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          msg: "success",
          data: {
            members: [
              { member_type: "openid", member_id: "ou_owner", perm: "view" },
            ],
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      grantFeishuDriveFileViewPermission({
        fileToken: "file-token",
        memberOpenId: "ou_owner",
      }),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [readBackUrl, readBackInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(readBackUrl).toBe(
      "https://open.feishu.cn/open-apis/drive/v1/permissions/file-token/members?type=file",
    );
    expect(readBackInit.method).toBeUndefined();
  });

  it("rejects code 1063003 when the member is missing from the read-back", async () => {
    vi.mocked(getTenantAccessToken).mockResolvedValue("tenant-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ code: 1063003, msg: "forbidden operation" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ code: 0, msg: "success", data: { members: [] } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      grantFeishuDriveFileViewPermission({
        fileToken: "file-token",
        memberOpenId: "ou_owner",
      }),
    ).rejects.toThrow(
      "Feishu Drive file permission grant failed: 200 code 1063003: forbidden operation",
    );
  });
});
