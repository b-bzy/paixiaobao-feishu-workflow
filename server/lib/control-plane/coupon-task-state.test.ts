import { describe, expect, it } from "vitest";
import type { CouponTaskSnapshot } from "./contracts";
import {
  assertCouponTaskTransition,
  isCouponTaskTerminal,
} from "./coupon-task-state";

const task: CouponTaskSnapshot = {
  taskId: "CT-1",
  ownerOpenId: "ou_test",
  route: "three_source",
  state: "AwaitingFinalConfirmation",
  revision: 3,
  version: 7,
};

describe("coupon task state machine", () => {
  it("advances a current final confirmation once", () => {
    expect(
      assertCouponTaskTransition({
        task,
        expectedVersion: 7,
        expectedRevision: 3,
        nextState: "DraftOnlyConfirmed",
      }),
    ).toMatchObject({ state: "DraftOnlyConfirmed", version: 8 });
  });

  it("rejects stale cards and invalid terminal transitions", () => {
    expect(() =>
      assertCouponTaskTransition({
        task,
        expectedVersion: 6,
        expectedRevision: 3,
        nextState: "DraftOnlyConfirmed",
      }),
    ).toThrow("version changed");
    expect(() =>
      assertCouponTaskTransition({
        task,
        expectedVersion: 7,
        expectedRevision: 2,
        nextState: "DraftOnlyConfirmed",
      }),
    ).toThrow("revision changed");
    expect(() =>
      assertCouponTaskTransition({
        task: { ...task, state: "Submitted" },
        expectedVersion: 7,
        expectedRevision: 3,
        nextState: "Submitting",
      }),
    ).toThrow("cannot transition");
    expect(isCouponTaskTerminal("SubmissionUnknown")).toBe(true);
    expect(isCouponTaskTerminal("Submitting")).toBe(false);
  });
});
