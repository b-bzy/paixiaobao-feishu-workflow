import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  assertCanonicalObject,
  type CanonicalObject,
  type CanonicalObjectStore,
  sha256Bytes,
} from "./object-store";

export interface CanonicalObjectStoreConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

function required(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key]?.trim();
  if (!value)
    throw new Error(`${key} is required for canonical object storage`);
  return value;
}

function boolean(value: string | undefined, key: string): boolean {
  if (!value || value === "false") return false;
  if (value === "true") return true;
  throw new Error(`${key} must be true or false`);
}

export function getCanonicalObjectStoreConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CanonicalObjectStoreConfig {
  return {
    endpoint: required(environment, "OBJECT_STORE_ENDPOINT"),
    region: environment.OBJECT_STORE_REGION?.trim() || "us-east-1",
    bucket: required(environment, "OBJECT_STORE_BUCKET"),
    accessKeyId: required(environment, "OBJECT_STORE_ACCESS_KEY_ID"),
    secretAccessKey: required(environment, "OBJECT_STORE_SECRET_ACCESS_KEY"),
    forcePathStyle: boolean(
      environment.OBJECT_STORE_FORCE_PATH_STYLE,
      "OBJECT_STORE_FORCE_PATH_STYLE",
    ),
  };
}

export function createCanonicalObjectStoreClient(
  config: CanonicalObjectStoreConfig,
): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function preconditionFailed(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    value.name === "PreconditionFailed" ||
    value.$metadata?.httpStatusCode === 412
  );
}

async function bodyBytes(body: unknown): Promise<Uint8Array> {
  if (
    !body ||
    typeof body !== "object" ||
    !("transformToByteArray" in body) ||
    typeof body.transformToByteArray !== "function"
  ) {
    throw new Error("canonical object response body is unavailable");
  }
  return new Uint8Array(await body.transformToByteArray());
}

export class S3CanonicalObjectStore implements CanonicalObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(input: { client: S3Client; bucket: string }) {
    if (!input.bucket.trim())
      throw new Error("canonical object bucket is required");
    this.client = input.client;
    this.bucket = input.bucket;
  }

  async putImmutable(object: CanonicalObject): Promise<void> {
    assertCanonicalObject(object);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: object.key,
          Body: object.bytes,
          ContentType: object.contentType,
          Metadata: { sha256: object.sha256 },
          IfNoneMatch: "*",
        }),
      );
    } catch (error) {
      if (!preconditionFailed(error)) throw error;
      const existing = await this.get(object.key);
      if (
        existing.sha256 === object.sha256 &&
        existing.contentType === object.contentType
      ) {
        return;
      }
      throw new Error(`canonical object key collision: ${object.key}`);
    }
  }

  async get(key: string): Promise<CanonicalObject> {
    if (!key || key.startsWith("/") || key.includes("..")) {
      throw new Error("Canonical object key is invalid");
    }
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const bytes = await bodyBytes(response.Body);
    const sha256 = sha256Bytes(bytes);
    const metadataHash = response.Metadata?.sha256;
    if (!metadataHash || metadataHash !== sha256) {
      throw new Error("canonical object metadata hash does not match bytes");
    }
    const object: CanonicalObject = {
      key,
      bytes,
      sha256,
      contentType: response.ContentType ?? "",
    };
    assertCanonicalObject(object);
    return object;
  }
}

export async function ensureLocalE2eBucket(
  client: S3Client,
  bucket: string,
): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    const status =
      error && typeof error === "object" && "$metadata" in error
        ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode
        : undefined;
    if (status !== 404) throw error;
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}
