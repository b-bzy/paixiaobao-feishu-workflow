import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Bytes } from "./object-store";
import {
  ensureLocalE2eBucket,
  S3CanonicalObjectStore,
} from "./s3-canonical-object-store";

const config = process.env.OBJECT_STORE_TEST_ENDPOINT
  ? {
      endpoint: process.env.OBJECT_STORE_TEST_ENDPOINT,
      region: process.env.OBJECT_STORE_TEST_REGION ?? "us-east-1",
      bucket: process.env.OBJECT_STORE_TEST_BUCKET ?? "coupon-e2e-local",
      accessKeyId: process.env.OBJECT_STORE_TEST_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.OBJECT_STORE_TEST_SECRET_ACCESS_KEY ?? "",
      forcePathStyle:
        process.env.OBJECT_STORE_TEST_FORCE_PATH_STYLE?.trim() === "true",
    }
  : undefined;
const integrationDescribe = config ? describe : describe.skip;

integrationDescribe("S3 canonical object store integration", () => {
  const keys: string[] = [];
  let client: S3Client;
  let store: S3CanonicalObjectStore;

  beforeAll(async () => {
    if (!config) return;
    if (!config.accessKeyId || !config.secretAccessKey) {
      throw new Error("object-store integration credentials are incomplete");
    }
    client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    await ensureLocalE2eBucket(client, config.bucket);
    store = new S3CanonicalObjectStore({ client, bucket: config.bucket });
  });

  afterAll(async () => {
    if (!config || !client) return;
    await Promise.all(
      keys.map((Key) =>
        client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key })),
      ),
    );
    client.destroy();
  });

  it("writes, replays and reads an immutable object", async () => {
    const bytes = new TextEncoder().encode("synthetic-coupon-artifact");
    const key = `local-e2e/${randomUUID()}/revision-1/coupon.xlsx`;
    keys.push(key);
    const object = {
      key,
      bytes,
      sha256: sha256Bytes(bytes),
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
    await store.putImmutable(object);
    await store.putImmutable(object);
    await expect(store.get(key)).resolves.toEqual(object);
  });

  it("allows only one value for concurrent writes to one key", async () => {
    const key = `local-e2e/${randomUUID()}/revision-1/whitelist.xlsx`;
    keys.push(key);
    const leftBytes = new TextEncoder().encode("left");
    const rightBytes = new TextEncoder().encode("right");
    const results = await Promise.allSettled([
      store.putImmutable({
        key,
        bytes: leftBytes,
        sha256: sha256Bytes(leftBytes),
        contentType: "application/octet-stream",
      }),
      store.putImmutable({
        key,
        bytes: rightBytes,
        sha256: sha256Bytes(rightBytes),
        contentType: "application/octet-stream",
      }),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(
      1,
    );
  });
});
