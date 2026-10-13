import {
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { sha256Bytes } from "./object-store";
import { S3CanonicalObjectStore } from "./s3-canonical-object-store";

const bytes = new Uint8Array([1, 2, 3]);
const object = {
  key: "coupon/run-1/revision-1/source.xlsx",
  bytes,
  sha256: sha256Bytes(bytes),
  contentType:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function body(value: Uint8Array) {
  return { transformToByteArray: async () => value };
}

describe("S3 canonical object store", () => {
  it("creates an immutable object with integrity metadata", async () => {
    const send = vi.fn(async (command: unknown) => {
      expect(command).toBeInstanceOf(PutObjectCommand);
      return {};
    });
    const store = new S3CanonicalObjectStore({
      client: { send } as unknown as S3Client,
      bucket: "coupon-e2e",
    });
    await store.putImmutable(object);
    expect(send).toHaveBeenCalledOnce();
    const input = (send.mock.calls[0]?.[0] as PutObjectCommand).input;
    expect(input).toMatchObject({
      Bucket: "coupon-e2e",
      Key: object.key,
      ContentType: object.contentType,
      IfNoneMatch: "*",
      Metadata: { sha256: object.sha256 },
    });
  });

  it("treats the same existing object as idempotent", async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        throw Object.assign(new Error("precondition"), {
          name: "PreconditionFailed",
          $metadata: { httpStatusCode: 412 },
        });
      }
      if (command instanceof GetObjectCommand) {
        return {
          Body: body(bytes),
          ContentType: object.contentType,
          Metadata: { sha256: object.sha256 },
        };
      }
      throw new Error("unexpected command");
    });
    const store = new S3CanonicalObjectStore({
      client: { send } as unknown as S3Client,
      bucket: "coupon-e2e",
    });
    await expect(store.putImmutable(object)).resolves.toBeUndefined();
  });

  it("rejects a key collision with different bytes", async () => {
    const other = new Uint8Array([9, 9, 9]);
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        throw Object.assign(new Error("precondition"), {
          name: "PreconditionFailed",
          $metadata: { httpStatusCode: 412 },
        });
      }
      return {
        Body: body(other),
        ContentType: object.contentType,
        Metadata: { sha256: sha256Bytes(other) },
      };
    });
    const store = new S3CanonicalObjectStore({
      client: { send } as unknown as S3Client,
      bucket: "coupon-e2e",
    });
    await expect(store.putImmutable(object)).rejects.toThrow(/collision/iu);
  });

  it("rejects read-back metadata or bytes that do not match", async () => {
    const send = vi.fn(async () => ({
      Body: body(bytes),
      ContentType: object.contentType,
      Metadata: { sha256: "0".repeat(64) },
    }));
    const store = new S3CanonicalObjectStore({
      client: { send } as unknown as S3Client,
      bucket: "coupon-e2e",
    });
    await expect(store.get(object.key)).rejects.toThrow(/metadata/iu);
  });
});
