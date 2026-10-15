import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { CouponOaAttachment } from "../draft-store";
import {
  deliverFrozenArtifactsAsMessages,
  type FrozenArtifactMessageDependencies,
} from "./frozen-artifact-delivery";

function bytes(payload: string): Uint8Array {
  return new TextEncoder().encode(payload);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function attachment(input: {
  role: CouponOaAttachment["role"];
  fileName: string;
  payload: string;
  order?: number;
}): CouponOaAttachment {
  return {
    artifactId: `${input.role}-id`,
    order: input.order ?? 0,
    role: input.role,
    fileName: input.fileName,
    fileCode: `code-${input.fileName}`,
    fileToken: `token-${input.fileName}`,
    sha256: sha256(bytes(input.payload)),
    bytes: bytes(input.payload).byteLength,
  };
}

describe("deliverFrozenArtifactsAsMessages", () => {
  it("sends workbooks as file messages and calc images as image messages in order", async () => {
    const couponBytes = bytes("coupon-xlsx");
    const imageBytes = bytes("png-bytes");
    const sentFiles: string[] = [];
    const sentImages: string[] = [];
    const deps = {
      downloadFile: async (fileToken: string) =>
        fileToken === "token-coupon.xlsx" ? couponBytes : imageBytes,
      uploadFile: vi.fn(async () => "file-key-1"),
      uploadImage: vi.fn(async () => "image-key-1"),
      sendFile: vi.fn(async (_openId: string, fileKey: string) => {
        sentFiles.push(fileKey);
      }),
      sendImage: vi.fn(async (_openId: string, imageKey: string) => {
        sentImages.push(imageKey);
      }),
    } as unknown as FrozenArtifactMessageDependencies;

    const result = await deliverFrozenArtifactsAsMessages(
      {
        openId: "ou_owner",
        attachments: [
          attachment({
            role: "calcImage",
            fileName: "测算图1.png",
            payload: "png-bytes",
            order: 1,
          }),
          attachment({
            role: "couponTable",
            fileName: "coupon.xlsx",
            payload: "coupon-xlsx",
            order: 0,
          }),
        ],
      },
      deps,
    );

    expect(result.delivered).toEqual(["coupon.xlsx", "测算图1.png"]);
    expect(result.failed).toEqual([]);
    expect(sentFiles).toEqual(["file-key-1"]);
    expect(sentImages).toEqual(["image-key-1"]);
  });

  it("refuses to send bytes whose hash drifted from the frozen snapshot", async () => {
    const deps = {
      downloadFile: async () => bytes("tampered"),
      uploadFile: vi.fn(async () => "file-key-1"),
      uploadImage: vi.fn(async () => "image-key-1"),
      sendFile: vi.fn(),
      sendImage: vi.fn(),
    } as unknown as FrozenArtifactMessageDependencies;

    const result = await deliverFrozenArtifactsAsMessages(
      {
        openId: "ou_owner",
        attachments: [
          attachment({
            role: "couponTable",
            fileName: "coupon.xlsx",
            payload: "frozen-bytes",
          }),
        ],
      },
      deps,
    );

    expect(result.delivered).toEqual([]);
    expect(result.failed[0]).toContain("冻结校验不一致");
    expect(deps.sendFile).not.toHaveBeenCalled();
  });

  it("keeps delivering the remaining artifacts when one fails", async () => {
    const goodBytes = bytes("white-list");
    const deps = {
      downloadFile: async (fileToken: string) => {
        if (fileToken === "token-broken.xlsx") throw new Error("drive 403");
        return goodBytes;
      },
      uploadFile: vi.fn(async () => "file-key-ok"),
      uploadImage: vi.fn(async () => "image-key-ok"),
      sendFile: vi.fn(),
      sendImage: vi.fn(),
    } as unknown as FrozenArtifactMessageDependencies;

    const result = await deliverFrozenArtifactsAsMessages(
      {
        openId: "ou_owner",
        attachments: [
          attachment({
            role: "couponTable",
            fileName: "broken.xlsx",
            payload: "never-downloaded",
            order: 0,
          }),
          attachment({
            role: "productWhitelist",
            fileName: "white.xlsx",
            payload: "white-list",
            order: 1,
          }),
        ],
      },
      deps,
    );

    expect(result.delivered).toEqual(["white.xlsx"]);
    expect(result.failed[0]).toContain("drive 403");
  });
});
