import { describe, expect, it } from "vitest";
import {
  type InboundDeliveryV1,
  inboundDeliverySchemaVersion,
} from "./contracts";
import { sha256, stableJson } from "./idempotency";
import { PostgresIngressReceiver } from "./postgres-ingress-receiver";
import type { SqlExecutor, TransactionalSqlDatabase } from "./sql";

class ScriptedDatabase implements TransactionalSqlDatabase {
  readonly calls: Array<{
    statement: string;
    parameters?: readonly unknown[];
  }> = [];

  constructor(
    private readonly results: Array<{
      rows?: Record<string, unknown>[];
      rowCount?: number | null;
    }>,
  ) {}

  async transaction<T>(
    callback: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    return callback(this);
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    parameters?: readonly unknown[],
  ) {
    this.calls.push({ statement, parameters });
    const result = this.results.shift();
    if (!result) throw new Error("Unexpected SQL query");
    return {
      rows: (result.rows ?? []) as Row[],
      rowCount: result.rowCount ?? result.rows?.length ?? 0,
    };
  }
}

const deliveryPayload = { header: { event_id: "evt-001" } };

const delivery: InboundDeliveryV1 & { keyId: string; nonce: string } = {
  schemaVersion: inboundDeliverySchemaVersion,
  source: "managed-bridge",
  appId: "cli_test",
  tenantId: "tenant-test",
  stableDeliveryId: "evt-001",
  eventType: "im.message.receive_v1",
  actorOpenId: "ou_test",
  messageId: "om_test",
  chatType: "p2p",
  receivedAt: "2030-01-01T00:00:00.000Z",
  payload: deliveryPayload,
  payloadSha256: sha256(stableJson(deliveryPayload)),
  correlationId: "corr-001",
  keyId: "bridge-v1",
  nonce: "nonce_abcdefghijklmnopqrstuvwxyz",
};

describe("PostgresIngressReceiver", () => {
  it("atomically accepts a new delivery and schedules one job", async () => {
    const database = new ScriptedDatabase([
      { rowCount: 1 },
      { rows: [{ nonce: delivery.nonce }], rowCount: 1 },
      { rows: [{ id: "receipt-1" }], rowCount: 1 },
      { rowCount: 1 },
    ]);
    const receiver = new PostgresIngressReceiver(database, {
      now: () => new Date("2030-01-01T00:00:00.000Z"),
      id: (() => {
        const ids = ["receipt-1", "job-1"];
        return () => ids.shift() ?? "unexpected";
      })(),
    });

    await expect(receiver.accept(delivery)).resolves.toEqual({
      receiptId: "receipt-1",
      duplicate: false,
    });
    expect(database.calls).toHaveLength(4);
    expect(database.calls[2]?.statement).toContain("feishu_deliveries");
    expect(database.calls[3]?.statement).toContain("workflow_outbox");
    expect(database.calls[3]?.parameters?.[2]).toContain("delivery.process:");
  });

  it("returns the existing receipt without a second job for duplicate delivery", async () => {
    const database = new ScriptedDatabase([
      { rowCount: 1 },
      { rows: [{ nonce: delivery.nonce }], rowCount: 1 },
      { rowCount: 0 },
      { rows: [{ id: "receipt-old" }], rowCount: 1 },
    ]);
    const receiver = new PostgresIngressReceiver(database, {
      id: () => "unused",
    });

    await expect(
      receiver.accept({
        ...delivery,
        nonce: "nonce_abcdefghijklmnopqrstuvwxyz2",
      }),
    ).resolves.toEqual({
      receiptId: "receipt-old",
      duplicate: true,
    });
    expect(database.calls).toHaveLength(4);
  });

  it("fails before receipt insertion when a signed nonce is replayed", async () => {
    const database = new ScriptedDatabase([{ rowCount: 1 }, { rowCount: 0 }]);
    const receiver = new PostgresIngressReceiver(database);

    await expect(receiver.accept(delivery)).rejects.toThrow(
      "nonce has already been used",
    );
    expect(database.calls).toHaveLength(2);
  });

  it("rejects a delivery whose persisted payload hash does not match", async () => {
    const database = new ScriptedDatabase([]);
    const receiver = new PostgresIngressReceiver(database);

    await expect(
      receiver.accept({
        ...delivery,
        payloadSha256: "b".repeat(64),
      }),
    ).rejects.toThrow("payload hash does not match");
    expect(database.calls).toHaveLength(0);
  });
});
