import type { CouponThreeSourceTask } from "../coupon-oa/three-source/task";
import {
  type CouponThreeSourceCommandIntakeGate,
  getCouponThreeSourceCommandIntakeGate,
  isCouponThreeSourceInvocation,
} from "../feishu/coupon-oa/three-source/config";
import type { InboundDeliveryV1, WorkflowJob } from "./contracts";
import type { WorkflowJobResult } from "./durable-worker";
import { sha256, stableJson } from "./idempotency";

export const processFeishuDeliveryJobKind = "process_feishu_delivery";

export interface PersistedFeishuDelivery extends InboundDeliveryV1 {
  receiptId: string;
}

export type DeliveryOutcome =
  | { kind: "handled"; taskId: string; effectId: string }
  | { kind: "ignored"; reason: string }
  | { kind: "rejected"; reason: string };

export interface CommandIntakeRepository {
  getDelivery(receiptId: string): Promise<PersistedFeishuDelivery | undefined>;
  getOutcome(receiptId: string): Promise<DeliveryOutcome | undefined>;
  recordTerminalOutcome(input: {
    receiptId: string;
    outcome: Extract<DeliveryOutcome, { kind: "ignored" | "rejected" }>;
  }): Promise<DeliveryOutcome>;
  startOrResume(input: {
    receiptId: string;
    ownerOpenId: string;
  }): Promise<Extract<DeliveryOutcome, { kind: "handled" }>>;
}

export interface CouponCommandIntakeGateProvider {
  evaluate(openId: string): CouponThreeSourceCommandIntakeGate;
}

export const couponCommandIntakeGateProvider: CouponCommandIntakeGateProvider =
  {
    evaluate: getCouponThreeSourceCommandIntakeGate,
  };

type DeliveryClassification =
  | { kind: "candidate"; ownerOpenId: string }
  | Extract<DeliveryOutcome, { kind: "ignored" | "rejected" }>;

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textContent(value: unknown): string | undefined {
  if (typeof value === "string") {
    try {
      return textContent(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return objectValue(value)?.text as string | undefined;
}

function validOpenId(value: unknown): value is string {
  return typeof value === "string" && /^ou_[a-zA-Z0-9]+$/.test(value);
}

function validDeliveryMetadata(
  delivery: PersistedFeishuDelivery,
): delivery is PersistedFeishuDelivery & {
  actorOpenId: string;
  messageId: string;
} {
  return (
    delivery.schemaVersion === "feishu-delivery-v1" &&
    /^[\w.-]{1,256}$/u.test(delivery.stableDeliveryId) &&
    validOpenId(delivery.actorOpenId) &&
    typeof delivery.messageId === "string" &&
    delivery.messageId.trim().length > 0 &&
    typeof delivery.chatId === "string" &&
    delivery.chatId.trim().length > 0 &&
    typeof delivery.correlationId === "string" &&
    delivery.correlationId.trim().length > 0 &&
    !Number.isNaN(Date.parse(delivery.receivedAt)) &&
    /^[a-f0-9]{64}$/iu.test(delivery.payloadSha256) &&
    delivery.payloadSha256 === sha256(stableJson(delivery.payload))
  );
}

/**
 * This parser deliberately only accepts the receipt's persisted, authenticated
 * representation. It does not reuse the legacy synchronous dispatcher, which
 * performs unrelated workflow reads and sends cards before command routing.
 */
export function classifyCouponThreeSourceCommandDelivery(
  delivery: PersistedFeishuDelivery,
): DeliveryClassification {
  if (!validDeliveryMetadata(delivery)) {
    return { kind: "rejected", reason: "invalid_delivery" };
  }
  if (delivery.eventType !== "im.message.receive_v1") {
    return { kind: "ignored", reason: "unsupported_event" };
  }

  const event = objectValue(delivery.payload.event);
  const message = objectValue(event?.message);
  if (message?.message_type !== "text") {
    return { kind: "ignored", reason: "unsupported_message_type" };
  }
  const text = textContent(message.content);
  if (typeof text !== "string") {
    return { kind: "rejected", reason: "malformed_text_payload" };
  }
  if (delivery.chatType !== "p2p") {
    return { kind: "rejected", reason: "direct_chat_required" };
  }
  if (!isCouponThreeSourceInvocation(text)) {
    return { kind: "ignored", reason: "unsupported_invocation" };
  }
  return { kind: "candidate", ownerOpenId: delivery.actorOpenId };
}

function receiptIdFrom(job: WorkflowJob): string | undefined {
  const receiptId = job.payload.receiptId;
  return typeof receiptId === "string" && receiptId.trim()
    ? receiptId
    : undefined;
}

/**
 * Implements the command-only half of the durable route. It never imports a
 * Feishu client or material-processing adapter: a successful outcome is only a
 * committed task plus intake-card effect intent.
 */
export class DurableCouponCommandIntakeHandler {
  constructor(
    private readonly repository: CommandIntakeRepository,
    private readonly gate: CouponCommandIntakeGateProvider = couponCommandIntakeGateProvider,
  ) {}

  async handle(job: WorkflowJob): Promise<WorkflowJobResult> {
    try {
      return await this.handleInternal(job);
    } catch {
      return {
        kind: "retry",
        retryAt: new Date(Date.now() + 1_000).toISOString(),
        errorCode: "COMMAND_INTAKE_STORAGE_FAILURE",
        errorMessage: "Durable command intake storage operation failed",
      };
    }
  }

  private async handleInternal(job: WorkflowJob): Promise<WorkflowJobResult> {
    const receiptId = receiptIdFrom(job);
    if (!receiptId) {
      return {
        kind: "dead_letter",
        errorCode: "INVALID_WORKFLOW_JOB",
        errorMessage: "process_feishu_delivery requires a receipt ID",
      };
    }

    const delivery = await this.repository.getDelivery(receiptId);
    if (!delivery) {
      return {
        kind: "dead_letter",
        errorCode: "DELIVERY_NOT_FOUND",
        errorMessage: "The durable delivery receipt no longer exists",
      };
    }
    if (await this.repository.getOutcome(receiptId)) {
      return { kind: "succeeded" };
    }

    const classification = classifyCouponThreeSourceCommandDelivery(delivery);
    if (classification.kind !== "candidate") {
      await this.repository.recordTerminalOutcome({
        receiptId,
        outcome: classification,
      });
      return { kind: "succeeded" };
    }

    const gate = this.gate.evaluate(classification.ownerOpenId);
    if (!gate.enabled) {
      await this.repository.recordTerminalOutcome({
        receiptId,
        outcome: { kind: "rejected", reason: `gate_${gate.reason}` },
      });
      return { kind: "succeeded" };
    }

    await this.repository.startOrResume({
      receiptId,
      ownerOpenId: classification.ownerOpenId,
    });
    return { kind: "succeeded" };
  }
}

export function createProcessFeishuDeliveryHandler(input: {
  repository: CommandIntakeRepository;
  gate?: CouponCommandIntakeGateProvider;
}): (job: WorkflowJob) => Promise<WorkflowJobResult> {
  const handler = new DurableCouponCommandIntakeHandler(
    input.repository,
    input.gate,
  );
  return (job) => handler.handle(job);
}

export interface CouponCommandIntakeCommit {
  task: CouponThreeSourceTask;
  effectId: string;
}
