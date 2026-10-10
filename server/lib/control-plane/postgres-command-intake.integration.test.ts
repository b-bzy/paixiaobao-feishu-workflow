import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { InboundDeliveryV1 } from "./contracts";
import type { CouponIntakeCardGateway } from "./coupon-intake-card-effect";
import {
  type CouponCommandIntakeGateProvider,
  createProcessFeishuDeliveryHandler,
} from "./durable-command-intake";
import {
  createDurableCouponControlPlaneWorker,
  type DurableCouponWorkerRunOptions,
} from "./durable-coupon-control-plane-worker";
import { DurableWorker } from "./durable-worker";
import { sha256, stableJson } from "./idempotency";
import { PostgresCouponCommandIntakeRepository } from "./postgres-coupon-command-intake-repository";
import { PostgresIngressReceiver } from "./postgres-ingress-receiver";
import { PostgresSqlDatabase } from "./postgres-sql-database";
import { PostgresWorkflowJobRepository } from "./postgres-workflow-job-repository";

const integrationDatabaseUrl = process.env.CONTROL_PLANE_TEST_DATABASE_URL;
const databaseDescribe = integrationDatabaseUrl ? describe : describe.skip;

let adminPool: Pool | undefined;
let controlPlaneDatabase: PostgresSqlDatabase | undefined;
let schemaName: string | undefined;

function requiredDatabase(): PostgresSqlDatabase {
  if (!controlPlaneDatabase) {
    throw new Error("PostgreSQL integration database is not initialized");
  }
  return controlPlaneDatabase;
}

function delivery(input: {
  stableDeliveryId: string;
  nonce: string;
  ownerOpenId: string;
}): InboundDeliveryV1 & { keyId: string; nonce: string } {
  const payload = {
    header: {
      event_id: input.stableDeliveryId,
      event_type: "im.message.receive_v1",
    },
    event: {
      sender: { sender_id: { open_id: input.ownerOpenId } },
      message: {
        message_id: `om-${input.stableDeliveryId}`,
        chat_id: `oc-${input.stableDeliveryId}`,
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "/OA优惠券提报" }),
      },
    },
  };
  return {
    schemaVersion: "feishu-delivery-v1",
    source: "managed-bridge",
    appId: "cli_control_plane_test",
    tenantId: "tenant_control_plane_test",
    stableDeliveryId: input.stableDeliveryId,
    eventType: "im.message.receive_v1",
    actorOpenId: input.ownerOpenId,
    messageId: `om-${input.stableDeliveryId}`,
    chatType: "p2p",
    chatId: `oc-${input.stableDeliveryId}`,
    receivedAt: "2030-01-01T00:00:00.000Z",
    payload,
    payloadSha256: sha256(stableJson(payload)),
    correlationId: `corr-${input.stableDeliveryId}`,
    keyId: "integration-test",
    nonce: input.nonce,
  };
}

const enabledGate: CouponCommandIntakeGateProvider = {
  evaluate: () => ({ enabled: true }),
};

const controlPlaneRunOptions: DurableCouponWorkerRunOptions = {
  workerId: "integration-control-plane-worker",
  jobLimit: 10,
  effectLimit: 10,
  jobLeaseMs: 60_000,
  effectLeaseMs: 60_000,
  schedulerLeaseMs: 90_000,
};

async function count(table: string, where?: string): Promise<number> {
  const result = await requiredDatabase().query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table}${where ? ` WHERE ${where}` : ""}`,
  );
  return Number(result.rows[0]?.count ?? "0");
}

databaseDescribe("durable command intake PostgreSQL integration", () => {
  beforeAll(async () => {
    if (!integrationDatabaseUrl) return;
    schemaName = `control_plane_test_${randomUUID().replaceAll("-", "")}`;
    adminPool = new Pool({ connectionString: integrationDatabaseUrl, max: 2 });
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);

    const migrationClient = await adminPool.connect();
    try {
      await migrationClient.query(`SET search_path TO "${schemaName}"`);
      const directory = resolve(process.cwd(), "infra/postgres/migrations");
      const migrations = (await readdir(directory))
        .filter((file) => /^\d+_.+\.sql$/u.test(file))
        .sort();
      for (const migration of migrations) {
        await migrationClient.query(
          await readFile(resolve(directory, migration), "utf8"),
        );
      }
      // The migration files use idempotent DDL; a second pass proves that the
      // disposable schema can be prepared repeatedly.
      for (const migration of migrations) {
        await migrationClient.query(
          await readFile(resolve(directory, migration), "utf8"),
        );
      }
    } finally {
      migrationClient.release();
    }

    controlPlaneDatabase = new PostgresSqlDatabase(
      new Pool({
        connectionString: integrationDatabaseUrl,
        max: 4,
        options: `-c search_path=${schemaName}`,
      }),
    );
  }, 30_000);

  afterAll(async () => {
    await controlPlaneDatabase?.close();
    if (adminPool && schemaName) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    }
    await adminPool?.end();
  });

  it("deduplicates a delivery and commits its task, audit, effect, and outcome", async () => {
    const database = requiredDatabase();
    const ingress = new PostgresIngressReceiver(database);
    const original = delivery({
      stableDeliveryId: "evt-intake-1",
      nonce: "nonce-intake-1",
      ownerOpenId: "ou_integrated",
    });
    const accepted = await ingress.accept(original);
    const duplicate = await ingress.accept({
      ...original,
      nonce: "nonce-intake-2",
    });

    expect(accepted.duplicate).toBe(false);
    expect(duplicate).toEqual({
      receiptId: accepted.receiptId,
      duplicate: true,
    });
    expect(await count("workflow_outbox")).toBe(1);

    const worker = new DurableWorker(
      new PostgresWorkflowJobRepository(database),
      {
        process_feishu_delivery: createProcessFeishuDeliveryHandler({
          repository: new PostgresCouponCommandIntakeRepository(database),
          gate: enabledGate,
        }),
      },
    );
    await expect(
      worker.runOnce({
        workerId: "integration-worker",
        limit: 10,
        leaseMs: 60_000,
      }),
    ).resolves.toMatchObject({ claimed: 1, succeeded: 1 });

    expect(await count("coupon_tasks", "owner_open_id = 'ou_integrated'")).toBe(
      1,
    );
    expect(await count("workflow_audit_events")).toBe(1);
    expect(await count("effect_receipts")).toBe(1);
    expect(await count("feishu_delivery_outcomes")).toBe(1);
    expect(await count("workflow_outbox", "state = 'succeeded'")).toBe(1);
  });

  it("serializes two different receipts from one owner into one active task and effect", async () => {
    const database = requiredDatabase();
    const ingress = new PostgresIngressReceiver(database);
    await Promise.all([
      ingress.accept(
        delivery({
          stableDeliveryId: "evt-concurrent-a",
          nonce: "nonce-concurrent-a",
          ownerOpenId: "ou_concurrent",
        }),
      ),
      ingress.accept(
        delivery({
          stableDeliveryId: "evt-concurrent-b",
          nonce: "nonce-concurrent-b",
          ownerOpenId: "ou_concurrent",
        }),
      ),
    ]);

    const makeWorker = (workerId: string) =>
      new DurableWorker(new PostgresWorkflowJobRepository(database), {
        process_feishu_delivery: createProcessFeishuDeliveryHandler({
          repository: new PostgresCouponCommandIntakeRepository(database),
          gate: enabledGate,
        }),
      }).runOnce({ workerId, limit: 1, leaseMs: 60_000 });
    const [left, right] = await Promise.all([
      makeWorker("integration-worker-a"),
      makeWorker("integration-worker-b"),
    ]);

    expect(left.succeeded + right.succeeded).toBe(2);
    expect(await count("coupon_tasks", "owner_open_id = 'ou_concurrent'")).toBe(
      1,
    );
    expect(
      await count(
        "effect_receipts",
        "semantic_key LIKE 'coupon-intake-card:%'",
      ),
    ).toBe(2);
    expect(await count("feishu_delivery_outcomes", "kind = 'handled'")).toBe(3);
  });

  it("runs an accepted command through the real worker and a fake card gateway", async () => {
    const database = requiredDatabase();
    // Earlier cases deliberately leave their effect intents queued. Freeze those
    // historical intents so this acceptance case proves exactly one new card
    // effect without contacting Feishu.
    await database.query(
      "UPDATE effect_receipts SET state = 'succeeded', completed_at = now() WHERE state = 'queued'",
    );
    const ingress = new PostgresIngressReceiver(database);
    await ingress.accept(
      delivery({
        stableDeliveryId: "evt-effect-e2e",
        nonce: "nonce-effect-e2e",
        ownerOpenId: "ou_effecte2e",
      }),
    );

    const send = vi.fn(
      async (input: { ownerOpenId: string; idempotencyKey: string }) => ({
        kind: "succeeded" as const,
        externalReference: `fake-feishu-card:${input.idempotencyKey}`,
      }),
    );
    const cardGateway: CouponIntakeCardGateway = { send };
    const worker = createDurableCouponControlPlaneWorker({
      database,
      gate: enabledGate,
      cardGateway,
    });

    await expect(worker.runOnce(controlPlaneRunOptions)).resolves.toMatchObject(
      {
        skipped: false,
        jobs: { claimed: 1, succeeded: 1 },
        effects: { claimed: 1, succeeded: 1, outcomeUnknown: 0 },
      },
    );
    expect(send).toHaveBeenCalledWith({
      ownerOpenId: "ou_effecte2e",
      idempotencyKey: expect.stringMatching(/^coupon-intake-card:CTS-/u),
    });

    const effects = await database.query<{
      state: string;
      external_reference: string | null;
    }>(
      `SELECT effect.state, effect.external_reference
       FROM effect_receipts effect
       JOIN coupon_tasks task ON task.id = effect.task_id
       WHERE task.owner_open_id = $1`,
      ["ou_effecte2e"],
    );
    expect(effects.rows).toEqual([
      expect.objectContaining({
        state: "succeeded",
        external_reference: expect.stringMatching(/^fake-feishu-card:/u),
      }),
    ]);
  });

  it("does not resend a card with an unknown outcome after a worker restart", async () => {
    const database = requiredDatabase();
    await database.query(
      "UPDATE effect_receipts SET state = 'succeeded', completed_at = now() WHERE state = 'queued'",
    );
    const ingress = new PostgresIngressReceiver(database);
    await ingress.accept(
      delivery({
        stableDeliveryId: "evt-effect-unknown",
        nonce: "nonce-effect-unknown",
        ownerOpenId: "ou_effectunknown",
      }),
    );

    const uncertainSend = vi.fn(async () => ({
      kind: "outcome_unknown" as const,
      errorCode: "TEST_REMOTE_OUTCOME_UNKNOWN",
    }));
    const uncertainWorker = createDurableCouponControlPlaneWorker({
      database,
      gate: enabledGate,
      cardGateway: { send: uncertainSend },
    });
    await expect(
      uncertainWorker.runOnce({
        ...controlPlaneRunOptions,
        workerId: "integration-unknown-outcome-worker",
      }),
    ).resolves.toMatchObject({
      jobs: { claimed: 1, succeeded: 1 },
      effects: { claimed: 1, outcomeUnknown: 1, succeeded: 0 },
    });
    expect(uncertainSend).toHaveBeenCalledOnce();
    expect(
      await count(
        "effect_receipts effect JOIN coupon_tasks task ON task.id = effect.task_id",
        "task.owner_open_id = 'ou_effectunknown' AND effect.state = 'outcome_unknown'",
      ),
    ).toBe(1);

    if (!integrationDatabaseUrl || !schemaName) {
      throw new Error("PostgreSQL integration schema is not initialized");
    }
    const restartedDatabase = new PostgresSqlDatabase(
      new Pool({
        connectionString: integrationDatabaseUrl,
        max: 2,
        options: `-c search_path=${schemaName}`,
      }),
    );
    const resendAfterRestart = vi.fn(async () => ({
      kind: "succeeded" as const,
      externalReference: "must-not-send",
    }));
    try {
      const restartedWorker = createDurableCouponControlPlaneWorker({
        database: restartedDatabase,
        gate: enabledGate,
        cardGateway: { send: resendAfterRestart },
      });
      await expect(
        restartedWorker.runOnce({
          ...controlPlaneRunOptions,
          workerId: "integration-restarted-worker",
        }),
      ).resolves.toMatchObject({
        skipped: false,
        jobs: { claimed: 0 },
        effects: { claimed: 0, outcomeUnknown: 0 },
      });
    } finally {
      await restartedDatabase.close();
    }
    expect(resendAfterRestart).not.toHaveBeenCalled();
  });

  it("uses PostgreSQL locks to prevent double claim and reclaim an expired lease", async () => {
    const database = requiredDatabase();
    const ingress = new PostgresIngressReceiver(database);
    const claimNow = new Date("2030-01-01T00:00:00.000Z");
    await ingress.accept(
      delivery({
        stableDeliveryId: "evt-claim-race",
        nonce: "nonce-claim-race",
        ownerOpenId: "ou_claimrace",
      }),
    );

    const left = new PostgresWorkflowJobRepository(database, {
      now: () => claimNow,
      token: () => "lease-race-left",
    });
    const right = new PostgresWorkflowJobRepository(database, {
      now: () => claimNow,
      token: () => "lease-race-right",
    });
    const [leftClaim, rightClaim] = await Promise.all([
      left.claim({ workerId: "claim-race-left", limit: 1, leaseMs: 60_000 }),
      right.claim({ workerId: "claim-race-right", limit: 1, leaseMs: 60_000 }),
    ]);
    expect(leftClaim.length + rightClaim.length).toBe(1);
    const raceClaim = leftClaim[0] ?? rightClaim[0];
    const raceRepository = leftClaim[0] ? left : right;
    await raceRepository.complete({
      jobId: raceClaim?.id ?? "missing",
      leaseToken: raceClaim?.leaseToken ?? "missing",
    });

    await ingress.accept(
      delivery({
        stableDeliveryId: "evt-lease-reclaim",
        nonce: "nonce-lease-reclaim",
        ownerOpenId: "ou_leasereclaim",
      }),
    );
    const oldLease = new PostgresWorkflowJobRepository(database, {
      now: () => claimNow,
      token: () => "lease-old",
    });
    const [claimed] = await oldLease.claim({
      workerId: "lease-old",
      limit: 1,
      leaseMs: 60_000,
    });
    expect(claimed).toMatchObject({ leaseToken: "lease-old", attempts: 1 });

    const recoveryNow = new Date("2030-01-01T00:02:00.000Z");
    const recoveredRepository = new PostgresWorkflowJobRepository(database, {
      now: () => recoveryNow,
      token: () => "lease-recovered",
    });
    const [recovered] = await recoveredRepository.claim({
      workerId: "lease-recovery",
      limit: 1,
      leaseMs: 60_000,
    });
    expect(recovered).toMatchObject({
      id: claimed?.id,
      leaseToken: "lease-recovered",
      attempts: 2,
    });
    await expect(
      oldLease.complete({
        jobId: claimed?.id ?? "missing",
        leaseToken: "lease-old",
      }),
    ).rejects.toThrow("lease was lost");
    await expect(
      oldLease.retryOrDeadLetter({
        jobId: claimed?.id ?? "missing",
        leaseToken: "lease-old",
        errorCode: "TRANSIENT",
        errorMessage: "stale worker must not write",
        retryAt: "2030-01-01T00:03:00.000Z",
      }),
    ).rejects.toThrow("lease was lost");
  });
});
