import { describe, expect, it, vi } from "vitest";
import type { WorkflowJob } from "./contracts";
import {
  type CommandIntakeRepository,
  type CouponCommandIntakeGateProvider,
  classifyCouponThreeSourceCommandDelivery,
  couponCommandIntakeGateProvider,
  type DeliveryOutcome,
  DurableCouponCommandIntakeHandler,
  type PersistedFeishuDelivery,
} from "./durable-command-intake";
import { sha256, stableJson } from "./idempotency";

function delivery(
  overrides: Partial<PersistedFeishuDelivery> = {},
): PersistedFeishuDelivery {
  const payload =
    overrides.payload ??
    ({
      event: {
        message: {
          message_type: "text",
          content: JSON.stringify({ text: " /OA 优惠券 提报 " }),
        },
      },
    } satisfies Record<string, unknown>);
  return {
    receiptId: "receipt-1",
    schemaVersion: "feishu-delivery-v1",
    source: "managed-bridge",
    appId: "cli_test",
    tenantId: "tenant_test",
    stableDeliveryId: "evt-1",
    eventType: "im.message.receive_v1",
    actorOpenId: "ou_owner",
    messageId: "om_message",
    chatType: "p2p",
    chatId: "oc_direct",
    receivedAt: "2030-01-01T00:00:00.000Z",
    payload,
    payloadSha256: sha256(stableJson(payload)),
    correlationId: "corr-1",
    ...overrides,
  };
}

const job: WorkflowJob = {
  id: "job-1",
  kind: "process_feishu_delivery",
  semanticKey: "delivery.process:test",
  payload: { receiptId: "receipt-1" },
  state: "leased",
  attempts: 1,
  availableAt: "2030-01-01T00:00:00.000Z",
  leaseToken: "lease-1",
};

function repository(
  persisted = delivery(),
  previous?: DeliveryOutcome,
): CommandIntakeRepository & {
  recordTerminalOutcome: ReturnType<typeof vi.fn>;
  startOrResume: ReturnType<typeof vi.fn>;
} {
  return {
    getDelivery: vi.fn(async () => persisted),
    getOutcome: vi.fn(async () => previous),
    recordTerminalOutcome: vi.fn(async ({ outcome }) => outcome),
    startOrResume: vi.fn(async () => ({
      kind: "handled" as const,
      taskId: "CTS-1",
      effectId: "effect-1",
    })),
  };
}

const enabledGate: CouponCommandIntakeGateProvider = {
  evaluate: () => ({ enabled: true }),
};

function disabledGate(reason = "disabled"): CouponCommandIntakeGateProvider {
  return {
    evaluate: () => ({
      enabled: false,
      reason: reason as "disabled",
    }),
  };
}

const commandGateEnvironmentNames = [
  "FEISHU_COUPON_THREE_SOURCE_R2_ENABLED",
  "FEISHU_COUPON_THREE_SOURCE_R2_ALLOWED_OPEN_IDS",
  "FEISHU_RUNTIME_STAGE",
  "FEISHU_COUPON_THREE_SOURCE_R2_CHAT_CONTEXT_READY",
] as const;

async function withCleanCommandGateEnvironment(
  action: () => Promise<void>,
): Promise<void> {
  const original = new Map(
    commandGateEnvironmentNames.map((name) => [name, process.env[name]]),
  );
  for (const name of commandGateEnvironmentNames) delete process.env[name];
  try {
    await action();
  } finally {
    for (const name of commandGateEnvironmentNames) {
      const value = original.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

describe("durable coupon command intake", () => {
  it("normalizes only an authenticated exact direct-message command", () => {
    expect(classifyCouponThreeSourceCommandDelivery(delivery())).toEqual({
      kind: "candidate",
      ownerOpenId: "ou_owner",
    });
    expect(
      classifyCouponThreeSourceCommandDelivery(
        delivery({
          payload: {
            event: {
              message: {
                message_type: "text",
                content: JSON.stringify({ text: "我要 OA优惠券提报" }),
              },
            },
          },
          payloadSha256: sha256(
            stableJson({
              event: {
                message: {
                  message_type: "text",
                  content: JSON.stringify({ text: "我要 OA优惠券提报" }),
                },
              },
            }),
          ),
        }),
      ),
    ).toEqual({ kind: "ignored", reason: "unsupported_invocation" });
  });

  it("commits only task/effect intent for an allowlisted direct command", async () => {
    const intake = repository();
    const handler = new DurableCouponCommandIntakeHandler(intake, enabledGate);

    await expect(handler.handle(job)).resolves.toEqual({ kind: "succeeded" });
    expect(intake.startOrResume).toHaveBeenCalledWith({
      receiptId: "receipt-1",
      ownerOpenId: "ou_owner",
    });
    expect(intake.recordTerminalOutcome).not.toHaveBeenCalled();
  });

  it("persists ignored/rejected outcomes without starting a task", async () => {
    const nearMatch = repository(
      delivery({
        payload: {
          event: {
            message: {
              message_type: "text",
              content: JSON.stringify({ text: "OA优惠券提报进度" }),
            },
          },
        },
        payloadSha256: sha256(
          stableJson({
            event: {
              message: {
                message_type: "text",
                content: JSON.stringify({ text: "OA优惠券提报进度" }),
              },
            },
          }),
        ),
      }),
    );
    await expect(
      new DurableCouponCommandIntakeHandler(nearMatch, enabledGate).handle(job),
    ).resolves.toEqual({ kind: "succeeded" });
    expect(nearMatch.recordTerminalOutcome).toHaveBeenCalledWith({
      receiptId: "receipt-1",
      outcome: { kind: "ignored", reason: "unsupported_invocation" },
    });
    expect(nearMatch.startOrResume).not.toHaveBeenCalled();

    const group = repository(delivery({ chatType: "group" }));
    await expect(
      new DurableCouponCommandIntakeHandler(group, enabledGate).handle(job),
    ).resolves.toEqual({ kind: "succeeded" });
    expect(group.recordTerminalOutcome).toHaveBeenCalledWith({
      receiptId: "receipt-1",
      outcome: { kind: "rejected", reason: "direct_chat_required" },
    });
    expect(group.startOrResume).not.toHaveBeenCalled();
  });

  it("rechecks the gate and replays a stored outcome without new work", async () => {
    const gated = repository();
    await new DurableCouponCommandIntakeHandler(gated, disabledGate()).handle(
      job,
    );
    expect(gated.recordTerminalOutcome).toHaveBeenCalledWith({
      receiptId: "receipt-1",
      outcome: { kind: "rejected", reason: "gate_disabled" },
    });
    expect(gated.startOrResume).not.toHaveBeenCalled();

    const replay = repository(delivery(), {
      kind: "handled",
      taskId: "CTS-1",
      effectId: "effect-1",
    });
    await expect(
      new DurableCouponCommandIntakeHandler(replay, enabledGate).handle(job),
    ).resolves.toEqual({ kind: "succeeded" });
    expect(replay.recordTerminalOutcome).not.toHaveBeenCalled();
    expect(replay.startOrResume).not.toHaveBeenCalled();
  });

  it("keeps the actual runtime gate default-closed without creating a task or effect", async () => {
    await withCleanCommandGateEnvironment(async () => {
      const intake = repository();
      await new DurableCouponCommandIntakeHandler(
        intake,
        couponCommandIntakeGateProvider,
      ).handle(job);

      expect(intake.recordTerminalOutcome).toHaveBeenCalledWith({
        receiptId: "receipt-1",
        outcome: { kind: "rejected", reason: "gate_disabled" },
      });
      expect(intake.startOrResume).not.toHaveBeenCalled();

      process.env.FEISHU_COUPON_THREE_SOURCE_R2_ENABLED = "true";
      process.env.FEISHU_COUPON_THREE_SOURCE_R2_ALLOWED_OPEN_IDS = "ou_owner";
      process.env.FEISHU_RUNTIME_STAGE = "invalid-stage";
      process.env.FEISHU_COUPON_THREE_SOURCE_R2_CHAT_CONTEXT_READY = "true";
      const malformedRuntime = repository(delivery({ receiptId: "receipt-2" }));
      await new DurableCouponCommandIntakeHandler(
        malformedRuntime,
        couponCommandIntakeGateProvider,
      ).handle({ ...job, payload: { receiptId: "receipt-2" } });

      expect(malformedRuntime.recordTerminalOutcome).toHaveBeenCalledWith({
        receiptId: "receipt-2",
        outcome: {
          kind: "rejected",
          reason: "gate_runtime-stage-unavailable",
        },
      });
      expect(malformedRuntime.startOrResume).not.toHaveBeenCalled();
    });
  });

  it("rejects tampered receipts and dead-letters malformed worker jobs", async () => {
    const tampered = repository(delivery({ payloadSha256: "a".repeat(64) }));
    await new DurableCouponCommandIntakeHandler(tampered, enabledGate).handle(
      job,
    );
    expect(tampered.recordTerminalOutcome).toHaveBeenCalledWith({
      receiptId: "receipt-1",
      outcome: { kind: "rejected", reason: "invalid_delivery" },
    });
    expect(tampered.startOrResume).not.toHaveBeenCalled();

    await expect(
      new DurableCouponCommandIntakeHandler(repository(), enabledGate).handle({
        ...job,
        payload: {},
      }),
    ).resolves.toMatchObject({
      kind: "dead_letter",
      errorCode: "INVALID_WORKFLOW_JOB",
    });
  });
});
