import { describe, expect, it } from "vitest";
import {
  assertStableDeliveryId,
  semanticKey,
  sha256,
  stableJson,
} from "./idempotency";

describe("control-plane idempotency", () => {
  it("normalizes object order before producing a semantic key", () => {
    expect(stableJson({ b: [2, { z: true, a: 1 }], a: "value" })).toBe(
      '{"a":"value","b":[2,{"a":1,"z":true}]}',
    );
    expect(
      semanticKey({
        namespace: "card.send",
        value: { task: "T-1", revision: 2 },
      }),
    ).toBe(
      semanticKey({
        namespace: "card.send",
        value: { revision: 2, task: "T-1" },
      }),
    );
  });

  it("keeps hashes deterministic and rejects invalid identifiers", () => {
    expect(sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(() =>
      semanticKey({ namespace: "bad namespace", value: {} }),
    ).toThrow("namespace is invalid");
    expect(() => assertStableDeliveryId("delivery/unsafe")).toThrow(
      "stable ID",
    );
    expect(() => assertStableDeliveryId("evt.001-card_action")).not.toThrow();
  });
});
