import type { CouponTaskSnapshot, CouponTaskState } from "./contracts";

const transitions: Record<CouponTaskState, ReadonlySet<CouponTaskState>> = {
  Collecting: new Set(["Recognizing", "NeedsClarification", "Canceled"]),
  Recognizing: new Set([
    "NeedsClarification",
    "AwaitingSourceConfirmation",
    "RetryableFailure",
    "Canceled",
  ]),
  NeedsClarification: new Set(["Recognizing", "Canceled"]),
  AwaitingSourceConfirmation: new Set([
    "GeneratingArtifacts",
    "NeedsClarification",
    "Canceled",
  ]),
  GeneratingArtifacts: new Set([
    "AwaitingFinalConfirmation",
    "RetryableFailure",
    "Canceled",
  ]),
  AwaitingFinalConfirmation: new Set([
    "DraftOnlyConfirmed",
    "Submitting",
    "NeedsClarification",
    "Canceled",
  ]),
  DraftOnlyConfirmed: new Set(["Canceled"]),
  Submitting: new Set(["Submitted", "CreatedNeedsReview", "SubmissionUnknown"]),
  Submitted: new Set(),
  CreatedNeedsReview: new Set(),
  SubmissionUnknown: new Set(),
  RetryableFailure: new Set(["Recognizing", "GeneratingArtifacts", "Canceled"]),
  Canceled: new Set(),
};

export function assertCouponTaskTransition(input: {
  task: CouponTaskSnapshot;
  expectedVersion: number;
  expectedRevision: number;
  nextState: CouponTaskState;
}): CouponTaskSnapshot {
  if (input.task.version !== input.expectedVersion) {
    throw new Error("Coupon task version changed; reopen the latest card");
  }
  if (input.task.revision !== input.expectedRevision) {
    throw new Error("Coupon task revision changed; reopen the latest card");
  }
  if (!transitions[input.task.state].has(input.nextState)) {
    throw new Error(
      `Coupon task cannot transition from ${input.task.state} to ${input.nextState}`,
    );
  }
  return {
    ...input.task,
    state: input.nextState,
    version: input.task.version + 1,
  };
}

export function isCouponTaskTerminal(state: CouponTaskState): boolean {
  return [
    "DraftOnlyConfirmed",
    "Submitted",
    "CreatedNeedsReview",
    "SubmissionUnknown",
    "Canceled",
  ].includes(state);
}
