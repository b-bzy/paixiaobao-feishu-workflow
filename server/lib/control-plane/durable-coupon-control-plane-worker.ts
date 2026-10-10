import {
  getCouponThreeSourceAiConfig,
  isCouponThreeSourceAiRecognitionEnabled,
} from "../feishu/coupon-oa/three-source/ai-config";
import {
  createCouponThreeSourceAiProjector,
  feishuCouponAiSourceLoader,
} from "../feishu/coupon-oa/three-source/ai-projection";
import type { CouponThreeSourceAiGateway } from "../feishu/deepseek-chat-gateway";
import { createDeepSeekChatGateway } from "../feishu/deepseek-chat-gateway";
import {
  type CouponAiRecognitionProjector,
  type CouponAiSourceLoader,
  createCouponAiRecognitionEffectHandler,
} from "./coupon-ai-recognition-effect";
import {
  type CouponIntakeCardGateway,
  createCouponIntakeCardEffectHandler,
} from "./coupon-intake-card-effect";
import {
  type CouponCommandIntakeGateProvider,
  createProcessFeishuDeliveryHandler,
} from "./durable-command-intake";
import {
  type DurableEffectHandler,
  DurableEffectWorker,
} from "./durable-effect-worker";
import { DurableWorker } from "./durable-worker";
import {
  couponAiRecognitionEffectKind,
  PostgresCouponAiRecognitionRepository,
} from "./postgres-coupon-ai-recognition-repository";
import { PostgresCouponCommandIntakeRepository } from "./postgres-coupon-command-intake-repository";
import { PostgresDurableEffectRepository } from "./postgres-durable-effect-repository";
import { getControlPlaneDatabase } from "./postgres-sql-database";
import { PostgresWorkflowJobRepository } from "./postgres-workflow-job-repository";
import { assertDurableRuntimeConfiguration } from "./runtime-config";
import {
  PostgresRuntimeLeaseRepository,
  type RuntimeLeaseRepository,
} from "./runtime-lease";
import type { TransactionalSqlDatabase } from "./sql";

const schedulerLeaseName = "coupon-control-plane-tick";

export interface DurableCouponWorkerRunOptions {
  workerId: string;
  jobLimit: number;
  effectLimit: number;
  jobLeaseMs: number;
  effectLeaseMs: number;
  schedulerLeaseMs: number;
}

export interface DurableCouponWorkerRunResult {
  skipped: boolean;
  jobs: {
    claimed: number;
    succeeded: number;
    retried: number;
    deadLettered: number;
  };
  effects: {
    claimed: number;
    succeeded: number;
    retried: number;
    deadLettered: number;
    outcomeUnknown: number;
  };
}

const noJobs: DurableCouponWorkerRunResult["jobs"] = {
  claimed: 0,
  succeeded: 0,
  retried: 0,
  deadLettered: 0,
};
const noEffects: DurableCouponWorkerRunResult["effects"] = {
  ...noJobs,
  outcomeUnknown: 0,
};

/**
 * Small composition root for the R1/R2 command-only path. It registers no
 * file, Base/Drive, renderer, or Approval handlers: only receipt processing
 * and the one task-intake card effect are executable.
 */
export class DurableCouponControlPlaneWorker {
  constructor(
    private readonly workflowWorker: DurableWorker,
    private readonly effectWorker: DurableEffectWorker,
    private readonly schedulerLease: RuntimeLeaseRepository,
  ) {}

  async runOnce(
    input: DurableCouponWorkerRunOptions,
  ): Promise<DurableCouponWorkerRunResult> {
    const acquired = await this.schedulerLease.tryAcquire({
      name: schedulerLeaseName,
      holderId: input.workerId,
      leaseMs: input.schedulerLeaseMs,
    });
    if (!acquired) return { skipped: true, jobs: noJobs, effects: noEffects };

    try {
      const jobs = await this.workflowWorker.runOnce({
        workerId: input.workerId,
        limit: input.jobLimit,
        leaseMs: input.jobLeaseMs,
      });
      const effects = await this.effectWorker.runOnce({
        workerId: input.workerId,
        limit: input.effectLimit,
        leaseMs: input.effectLeaseMs,
      });
      return { skipped: false, jobs, effects };
    } finally {
      await this.schedulerLease.release({
        name: schedulerLeaseName,
        holderId: input.workerId,
      });
    }
  }
}

export function createDurableCouponControlPlaneWorker(input: {
  database: TransactionalSqlDatabase;
  gate?: CouponCommandIntakeGateProvider;
  cardGateway?: CouponIntakeCardGateway;
  schedulerLease?: RuntimeLeaseRepository;
  aiRecognition?: {
    gateway: CouponThreeSourceAiGateway;
    sourceLoader: CouponAiSourceLoader;
    projector: CouponAiRecognitionProjector;
  };
}): DurableCouponControlPlaneWorker {
  const commandRepository = new PostgresCouponCommandIntakeRepository(
    input.database,
  );
  const workflowWorker = new DurableWorker(
    new PostgresWorkflowJobRepository(input.database),
    {
      process_feishu_delivery: createProcessFeishuDeliveryHandler({
        repository: commandRepository,
        gate: input.gate,
      }),
    },
  );
  const handlers: Record<string, DurableEffectHandler> = {
    coupon_three_source_intake_card: createCouponIntakeCardEffectHandler(
      input.cardGateway,
    ),
  };
  if (input.aiRecognition) {
    handlers[couponAiRecognitionEffectKind] =
      createCouponAiRecognitionEffectHandler({
        repository: new PostgresCouponAiRecognitionRepository(input.database),
        ...input.aiRecognition,
      });
  }
  const effectWorker = new DurableEffectWorker(
    new PostgresDurableEffectRepository(input.database),
    handlers,
    {
      serializationKey(effect) {
        if (effect.kind !== couponAiRecognitionEffectKind) return undefined;
        const businessTaskId = effect.requestPayload.businessTaskId;
        return typeof businessTaskId === "string" && businessTaskId
          ? `coupon-ai:${businessTaskId}`
          : undefined;
      },
    },
  );
  return new DurableCouponControlPlaneWorker(
    workflowWorker,
    effectWorker,
    input.schedulerLease ?? new PostgresRuntimeLeaseRepository(input.database),
  );
}

/** Creates the server-side composition only after durable configuration gates pass. */
export function createConfiguredDurableCouponControlPlaneWorker(): DurableCouponControlPlaneWorker {
  assertDurableRuntimeConfiguration();
  const aiRecognition = isCouponThreeSourceAiRecognitionEnabled()
    ? {
        gateway: createDeepSeekChatGateway(getCouponThreeSourceAiConfig()),
        sourceLoader: feishuCouponAiSourceLoader,
        projector: createCouponThreeSourceAiProjector(),
      }
    : undefined;
  return createDurableCouponControlPlaneWorker({
    database: getControlPlaneDatabase(),
    aiRecognition,
  });
}
