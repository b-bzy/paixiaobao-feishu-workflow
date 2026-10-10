import { randomUUID } from "node:crypto";
import type { InboundDeliveryV1, IngressReceiver } from "./contracts";
import {
  assertStableDeliveryId,
  semanticKey,
  sha256,
  stableJson,
} from "./idempotency";
import type { TransactionalSqlDatabase } from "./sql";

const nonceTtlMs = 5 * 60 * 1_000;

function assertInboundDelivery(input: InboundDeliveryV1): void {
  if (input.schemaVersion !== "feishu-delivery-v1") {
    throw new Error("Unsupported durable delivery schema version");
  }
  if (!input.appId.trim() || !input.eventType.trim()) {
    throw new Error("Feishu delivery is missing app or event metadata");
  }
  if (!["managed-bridge", "https-callback"].includes(input.source)) {
    throw new Error("Feishu delivery source is invalid");
  }
  if (!["p2p", "group", "unknown"].includes(input.chatType)) {
    throw new Error("Feishu delivery chat type is invalid");
  }
  if (Number.isNaN(Date.parse(input.receivedAt))) {
    throw new Error("Feishu delivery received time is invalid");
  }
  if (!/^[a-f0-9]{64}$/iu.test(input.payloadSha256)) {
    throw new Error("Feishu delivery payload hash is invalid");
  }
  if (input.payloadSha256 !== sha256(stableJson(input.payload))) {
    throw new Error("Feishu delivery payload hash does not match its payload");
  }
}

export class PostgresIngressReceiver implements IngressReceiver {
  constructor(
    private readonly database: TransactionalSqlDatabase,
    private readonly options: {
      now?: () => Date;
      id?: () => string;
    } = {},
  ) {}

  async accept(
    input: InboundDeliveryV1 & { keyId: string; nonce: string },
  ): Promise<{
    receiptId: string;
    duplicate: boolean;
  }> {
    assertInboundDelivery(input);
    assertStableDeliveryId(input.stableDeliveryId);
    if (!input.keyId || !input.nonce) {
      throw new Error("Bridge delivery is missing an authenticated nonce");
    }
    const now = (this.options.now ?? (() => new Date()))();
    const expiresAt = new Date(now.getTime() + nonceTtlMs);
    const makeId = this.options.id ?? randomUUID;

    return this.database.transaction(async (transaction) => {
      await transaction.query(
        "DELETE FROM ingress_nonces WHERE expires_at <= $1",
        [now.toISOString()],
      );
      const nonce = await transaction.query<{ nonce: string }>(
        `INSERT INTO ingress_nonces (key_id, nonce, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING nonce`,
        [input.keyId, input.nonce, expiresAt.toISOString()],
      );
      if (!nonce.rowCount) {
        throw new Error("Feishu bridge nonce has already been used");
      }

      const receiptId = makeId();
      const inserted = await transaction.query<{ id: string }>(
        `INSERT INTO feishu_deliveries (
           id, schema_version, app_id, tenant_id, stable_delivery_id, event_type,
           source, actor_open_id, message_id, callback_id, chat_type, chat_id,
           payload, payload_sha256, correlation_id, received_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16
         ) ON CONFLICT (app_id, tenant_id, stable_delivery_id) DO NOTHING
         RETURNING id`,
        [
          receiptId,
          input.schemaVersion,
          input.appId,
          input.tenantId ?? "",
          input.stableDeliveryId,
          input.eventType,
          input.source,
          input.actorOpenId ?? null,
          input.messageId ?? null,
          input.callbackId ?? null,
          input.chatType,
          input.chatId ?? null,
          JSON.stringify(input.payload),
          input.payloadSha256,
          input.correlationId,
          input.receivedAt,
        ],
      );
      if (!inserted.rowCount) {
        const existing = await transaction.query<{ id: string }>(
          `SELECT id FROM feishu_deliveries
           WHERE app_id = $1 AND tenant_id = $2 AND stable_delivery_id = $3`,
          [input.appId, input.tenantId ?? "", input.stableDeliveryId],
        );
        const existingId = existing.rows[0]?.id;
        if (!existingId) {
          throw new Error("Duplicate Feishu delivery cannot be resolved");
        }
        return { receiptId: existingId, duplicate: true };
      }

      const jobId = makeId();
      await transaction.query(
        `INSERT INTO workflow_outbox (
           id, delivery_id, kind, semantic_key, payload
         ) VALUES ($1, $2, 'process_feishu_delivery', $3, $4::jsonb)`,
        [
          jobId,
          receiptId,
          semanticKey({
            namespace: "delivery.process",
            value: {
              appId: input.appId,
              tenantId: input.tenantId ?? "",
              stableDeliveryId: input.stableDeliveryId,
            },
          }),
          JSON.stringify({ receiptId }),
        ],
      );
      return { receiptId, duplicate: false };
    });
  }
}
