import { describe, expect, it } from "vitest";
import {
  assertCanonicalObject,
  type CanonicalObjectStore,
  readVerifiedCanonicalObject,
  sha256Bytes,
} from "./object-store";

const bytes = new Uint8Array([1, 2, 3]);
const sha256 = sha256Bytes(bytes);

describe("canonical object integrity", () => {
  it("accepts and re-reads bytes matching the frozen manifest", async () => {
    const store: CanonicalObjectStore = {
      async putImmutable() {},
      async get(key) {
        return {
          key,
          bytes,
          sha256,
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        };
      },
    };
    await expect(
      readVerifiedCanonicalObject(store, {
        key: "coupon/CT-1/file.xlsx",
        sha256,
      }),
    ).resolves.toMatchObject({ sha256, bytes });
  });

  it("rejects path traversal, empty bytes, and hash mismatch", () => {
    expect(() =>
      assertCanonicalObject({
        key: "../unsafe.xlsx",
        bytes,
        sha256,
        contentType: "application/octet-stream",
      }),
    ).toThrow("key is invalid");
    expect(() =>
      assertCanonicalObject({
        key: "coupon/empty.xlsx",
        bytes: new Uint8Array(),
        sha256,
        contentType: "application/octet-stream",
      }),
    ).toThrow("metadata is incomplete");
    expect(() =>
      assertCanonicalObject({
        key: "coupon/tampered.xlsx",
        bytes,
        sha256: "0".repeat(64),
        contentType: "application/octet-stream",
      }),
    ).toThrow("hash does not match");
  });
});
