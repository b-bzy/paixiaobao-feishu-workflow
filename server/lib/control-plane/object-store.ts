import { createHash } from "node:crypto";

export interface CanonicalObject {
  key: string;
  bytes: Uint8Array;
  sha256: string;
  contentType: string;
}

export interface CanonicalObjectStore {
  putImmutable(object: CanonicalObject): Promise<void>;
  get(key: string): Promise<CanonicalObject>;
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function assertCanonicalObject(object: CanonicalObject): void {
  if (!object.key || object.key.startsWith("/") || object.key.includes("..")) {
    throw new Error("Canonical object key is invalid");
  }
  if (!object.contentType || !object.bytes.byteLength) {
    throw new Error("Canonical object metadata is incomplete");
  }
  if (object.sha256 !== sha256Bytes(object.bytes)) {
    throw new Error("Canonical object hash does not match its bytes");
  }
}

/**
 * A projection may point at Drive or Base, but canonical artifact bytes must be
 * recovered from this store and hash-checked before any approval promotion.
 */
export async function readVerifiedCanonicalObject(
  store: CanonicalObjectStore,
  expected: Pick<CanonicalObject, "key" | "sha256">,
): Promise<CanonicalObject> {
  const object = await store.get(expected.key);
  assertCanonicalObject(object);
  if (object.key !== expected.key || object.sha256 !== expected.sha256) {
    throw new Error("Canonical object no longer matches its frozen manifest");
  }
  return object;
}
