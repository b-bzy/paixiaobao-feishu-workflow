import type { WorkflowJob, WorkflowJobRepository } from "./contracts";

export type WorkflowJobResult =
  | { kind: "succeeded" }
  | { kind: "retry"; retryAt: string; errorCode: string; errorMessage: string }
  | { kind: "dead_letter"; errorCode: string; errorMessage: string };

export type WorkflowJobHandler = (
  job: WorkflowJob,
) => Promise<WorkflowJobResult>;

export class DurableWorker {
  constructor(
    private readonly repository: WorkflowJobRepository,
    private readonly handlers: Readonly<Record<string, WorkflowJobHandler>>,
    private readonly options: {
      now?: () => Date;
      retryDelayMs?: number;
      maxAttempts?: number;
    } = {},
  ) {}

  async runOnce(input: {
    workerId: string;
    limit: number;
    leaseMs: number;
  }): Promise<{
    claimed: number;
    succeeded: number;
    retried: number;
    deadLettered: number;
  }> {
    const jobs = await this.repository.claim(input);
    const outcomes = await Promise.all(jobs.map((job) => this.process(job)));
    return outcomes.reduce(
      (summary, outcome) => ({
        claimed: summary.claimed + 1,
        succeeded: summary.succeeded + Number(outcome === "succeeded"),
        retried: summary.retried + Number(outcome === "retry"),
        deadLettered: summary.deadLettered + Number(outcome === "dead_letter"),
      }),
      { claimed: 0, succeeded: 0, retried: 0, deadLettered: 0 },
    );
  }

  private async process(
    job: WorkflowJob,
  ): Promise<"succeeded" | "retry" | "dead_letter"> {
    if (!job.leaseToken) {
      throw new Error("Claimed workflow job is missing its lease token");
    }
    const handler = this.handlers[job.kind];
    if (!handler) {
      await this.repository.retryOrDeadLetter({
        jobId: job.id,
        leaseToken: job.leaseToken,
        errorCode: "JOB_HANDLER_UNAVAILABLE",
        errorMessage: `No durable worker handler is registered for ${job.kind}`,
      });
      return "dead_letter";
    }

    try {
      const result = await handler(job);
      if (result.kind === "succeeded") {
        await this.repository.complete({
          jobId: job.id,
          leaseToken: job.leaseToken,
        });
        return "succeeded";
      }
      const outcome = this.enforceAttemptLimit(job, result);
      await this.repository.retryOrDeadLetter({
        jobId: job.id,
        leaseToken: job.leaseToken,
        retryAt: outcome.kind === "retry" ? outcome.retryAt : undefined,
        errorCode: outcome.errorCode,
        errorMessage: outcome.errorMessage,
      });
      return outcome.kind;
    } catch {
      const outcome = this.enforceAttemptLimit(job, {
        kind: "retry",
        retryAt: this.defaultRetryAt(),
        errorCode: "UNHANDLED_WORKER_ERROR",
        errorMessage: "The durable worker handler failed before completing",
      });
      await this.repository.retryOrDeadLetter({
        jobId: job.id,
        leaseToken: job.leaseToken,
        retryAt: outcome.kind === "retry" ? outcome.retryAt : undefined,
        errorCode: outcome.errorCode,
        errorMessage: outcome.errorMessage,
      });
      return outcome.kind;
    }
  }

  private enforceAttemptLimit(
    job: WorkflowJob,
    outcome: Exclude<WorkflowJobResult, { kind: "succeeded" }>,
  ): Exclude<WorkflowJobResult, { kind: "succeeded" }> {
    const maxAttempts = this.options.maxAttempts ?? 5;
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error("Durable worker max attempts must be at least one");
    }
    if (outcome.kind === "retry" && job.attempts >= maxAttempts) {
      return {
        kind: "dead_letter",
        errorCode: "MAX_ATTEMPTS_EXCEEDED",
        errorMessage: "The durable worker exceeded its retry attempt limit",
      };
    }
    return outcome;
  }

  private defaultRetryAt(): string {
    const retryDelayMs = this.options.retryDelayMs ?? 60_000;
    if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 1_000) {
      throw new Error("Durable worker retry delay must be at least one second");
    }
    const now = (this.options.now ?? (() => new Date()))();
    return new Date(now.getTime() + retryDelayMs).toISOString();
  }
}
