import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({ getTenantAccessToken: vi.fn() }));

import { getTenantAccessToken } from "../client";
import {
  createCouponApprovalInstance,
  getCouponApprovalDefinition,
  getCouponApprovalInstance,
  getFeishuMessageBody,
  uploadCouponApprovalFile,
} from "./approval-client";

function response(data: object) {
  return new Response(JSON.stringify({ code: 0, msg: "ok", data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("coupon OA approval client", () => {
  beforeEach(() => {
    vi.mocked(getTenantAccessToken).mockResolvedValue("tenant-token");
  });

  it("reads the native approval definition with a tenant token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        response({ form: "[]", node_list: [{ node_id: "submit" }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCouponApprovalDefinition("approval-code")).resolves.toEqual(
      {
        approvalCode: "approval-code",
        form: "[]",
        nodeList: [{ node_id: "submit" }],
      },
    );
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/approval/v4/approvals/approval-code?locale=zh-CN",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer tenant-token" },
    });
  });

  it("creates an instance without node approver or cc overrides", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        instance_code: "instance-code",
        instance_link: "https://example.test/instance",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createCouponApprovalInstance({
        approvalCode: "approval-code",
        submitterOpenId: "ou_submitter",
        form: [{ id: "activity", type: "input", value: "测试" }],
        uuid: "123e4567-e89b-12d3-a456-426614174000",
      }),
    ).resolves.toEqual({
      instanceCode: "instance-code",
      instanceLink: "https://example.test/instance",
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      approval_code: "approval-code",
      open_id: "ou_submitter",
      uuid: "123e4567-e89b-12d3-a456-426614174000",
      with_link: true,
    });
    expect(body).not.toHaveProperty("node_approver_open_id_list");
    expect(body).not.toHaveProperty("node_cc_open_id_list");
  });

  it("reads a created instance with a tenant token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        response({ approval_code: "approval-code", status: "PENDING" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getCouponApprovalInstance("instance-code"),
    ).resolves.toMatchObject({
      approval_code: "approval-code",
      status: "PENDING",
    });
  });

  it("reads the original message body before downloading its resource", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        items: [
          {
            msg_type: "file",
            body: {
              content: '{"file_key":"file-key","file_name":"配券信息表.xlsx"}',
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getFeishuMessageBody({ messageId: "om_file-message" }),
    ).resolves.toEqual({
      messageType: "file",
      content: '{"file_key":"file-key","file_name":"配券信息表.xlsx"}',
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/im/v1/messages/om_file-message",
    );
  });

  it("reads the current approval upload file code response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        urls_detail: [
          {
            code: "current-file-code",
            message: "",
            origin_url: "",
            url: "https://example.test/file",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadCouponApprovalFile({
        name: "配券信息表.xlsx",
        type: "attachment",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).resolves.toBe("current-file-code");
  });

  it("keeps compatibility with the legacy approval upload response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ file_code: "legacy-file-code" })),
    );

    await expect(
      uploadCouponApprovalFile({
        name: "满减测算.png",
        type: "image",
        contentType: "image/png",
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).resolves.toBe("legacy-file-code");
  });
});
