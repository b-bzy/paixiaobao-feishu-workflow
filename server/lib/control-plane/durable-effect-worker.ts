import type {
  DurableEffect,
  DurableEffectRepository,
} from "./postgres-durable-effect-repository";

export type DurableEffectResult =
  | { kind: "succeeded"; externalReference?: string }
  | { kind: "retry"; retryAt: string; errorCode: string; errorMessage: string }
  | { kind: "dead_letter"; errorCode: string; errorMessage: string }
  | { kind: "outcome_unknown"; errorCode: string; errorMessage: string };

export type DurableEffectHandler = (
  effect: DurableEffect,
) => Promise<DurableEffectResult>;

/** Executes only persisted effect intents after they have been leased. */
export class DurableEffectWorker {
  constructor(
    private readonly repository: DurableEffectRepository,
    private readonly handlers: Readonly<Record<string, DurableEffectHandler>>,
    private readonly options: { maxAttempts?: number } = {},
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
    outcomeUnknown: number;
  }> {
    const effects = await this.repository.claim(input);
    const outcomes = await Promise.all(
      effects.map((effect) => this.process(effect)),
    );
    return outcomes.reduce(
      (summary, outcome) => ({
        claimed: summary.claimed + 1,
        succeeded: summary.succeeded + Number(outcome === "succeeded"),
        retried: summary.retried + Number(outcome === "retry"),
        deadLettered: summary.deadLettered + Number(outcome === "dead_letter"),
        outcomeUnknown:
          summary.outcomeUnknown + Number(outcome === "outcome_unknown"),
      }),
      {
        claimed: 0,
        succeeded: 0,
        retried: 0,
        deadLettered: 0,
        outcomeUnknown: 0,
      },
    );
  }

  private async process(
    effect: DurableEffect,
  ): Promise<DurableEffectResult["kind"]> {
    if (!effect.leaseToken) {
      throw new Error("Claimed effect is missing its lease token");
    }
    const handler = this.handlers[effect.kind];
    if (!handler) {
      await this.repository.retryOrDeadLetter({
        effectId: effect.id,
        leaseToken: effect.leaseToken,
        errorCode: "EFFECT_HANDLER_UNAVAILABLE",
        errorMessage: `No durable effect handler is registered for ${effect.kind}`,
      });
      return "dead_letter";
    }

    try {
      const result = await handler(effect);
      if (result.kind === "succeeded") {
        await this.repository.complete({
          effectId: effect.id,
          leaseToken: effect.leaseToken,
          externalReference: result.externalReference,
        });
        return "succeeded";
      }
      if (result.kind === "outcome_unknown") {
        await this.repository.markOutcomeUnknown({
          effectId: effect.id,
          leaseToken: effect.leaseToken,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
        });
        return "outcome_unknown";
      }
      const outcome = this.enforceAttemptLimit(effect, result);
      await this.repository.retryOrDeadLetter({
        effectId: effect.id,
        leaseToken: effect.leaseToken,
        retryAt: outcome.kind === "retry" ? outcome.retryAt : undefined,
        errorCode: outcome.errorCode,
        errorMessage: outcome.errorMessage,
      });
      return outcome.kind;
    } catch {
      // An unclassified remote failure may have happened after Feishu accepted a
      // card. Preserve it for reconciliation instead of blindly sending again.
      await this.repository.markOutcomeUnknown({
        effectId: effect.id,
        leaseToken: effect.leaseToken,
        errorCode: "UNHANDLED_EFFECT_ERROR",
        errorMessage:
          "Durable effect handler failed without a classified outcome",
      });
      return "outcome_unknown";
    }
  }

  private enforceAttemptLimit(
    effect: DurableEffect,
    outcome: Extract<DurableEffectResult, { kind: "retry" | "dead_letter" }>,
  ): Extract<DurableEffectResult, { kind: "retry" | "dead_letter" }> {
    const maxAttempts = this.options.maxAttempts ?? 5;
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error("Durable effect max attempts must be at least one");
    }
    if (outcome.kind === "retry" && effect.attempts >= maxAttempts) {
      return {
        kind: "dead_letter",
        errorCode: "MAX_ATTEMPTS_EXCEEDED",
        errorMessage: "The durable effect exceeded its retry attempt limit",
      };
    }
    return outcome;
  }
}
