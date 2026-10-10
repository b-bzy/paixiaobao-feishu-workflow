import { createHash } from "node:crypto";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }
  return value;
}

/** Produces a deterministic representation suitable for durable effect keys. */
export function stableJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function semanticKey(input: {
  namespace: string;
  value: unknown;
}): string {
  if (!/^[a-z][a-z0-9._-]{0,63}$/i.test(input.namespace)) {
    throw new Error("Control-plane semantic key namespace is invalid");
  }
  return `${input.namespace}:${sha256(stableJson(input.value))}`;
}

export function assertStableDeliveryId(value: string): void {
  if (!/^[\w.-]{1,256}$/u.test(value)) {
    throw new Error("Feishu delivery is missing a valid stable ID");
  }
}
