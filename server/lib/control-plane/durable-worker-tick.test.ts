import { afterEach, describe, expect, it } from "vitest";
import {
  assertControlPlaneTickAuthorized,
  ControlPlaneTickAuthorizationError,
  getDurableCouponWorkerRunOptions,
} from "./durable-worker-tick";

const names = [
  "FEISHU_WORKER_ID",
  "CONTROL_PLANE_TICK_TOKEN",
  "CONTROL_PLANE_WORKER_JOB_LIMIT",
  "CONTROL_PLANE_WORKER_EFFECT_LIMIT",
  "CONTROL_PLANE_WORKER_JOB_LEASE_MS",
  "CONTROL_PLANE_WORKER_EFFECT_LEASE_MS",
  "CONTROL_PLANE_WORKER_SCHEDULER_LEASE_MS",
] as const;

afterEach(() => {
  for (const name of names) delete process.env[name];
});

describe("durable worker tick configuration", () => {
  it("requires a stable worker ID and returns bounded defaults", () => {
    expect(() => getDurableCouponWorkerRunOptions()).toThrow(
      "FEISHU_WORKER_ID must be configured",
    );

    process.env.FEISHU_WORKER_ID = "coupon-worker-1";
    expect(getDurableCouponWorkerRunOptions()).toEqual({
      workerId: "coupon-worker-1",
      jobLimit: 10,
      effectLimit: 10,
      jobLeaseMs: 60_000,
      effectLeaseMs: 150_000,
      schedulerLeaseMs: 180_000,
    });
  });

  it("rejects unsafe scheduler settings before a database worker starts", () => {
    process.env.FEISHU_WORKER_ID = "coupon-worker-1";
    process.env.CONTROL_PLANE_WORKER_JOB_LEASE_MS = "120000";
    process.env.CONTROL_PLANE_WORKER_SCHEDULER_LEASE_MS = "60000";

    expect(() => getDurableCouponWorkerRunOptions()).toThrow(
      "must cover job and effect leases",
    );
  });

  it("fails closed until an adequately sized tick secret matches", () => {
    let unavailable: unknown;
    try {
      assertControlPlaneTickAuthorized("Bearer anything");
    } catch (error) {
      unavailable = error;
    }
    expect(unavailable).toBeInstanceOf(ControlPlaneTickAuthorizationError);
    expect(unavailable).toMatchObject({ statusCode: 503 });

    process.env.CONTROL_PLANE_TICK_TOKEN = "x".repeat(32);
    let unauthorized: unknown;
    try {
      assertControlPlaneTickAuthorized("Bearer wrong");
    } catch (error) {
      unauthorized = error;
    }
    expect(unauthorized).toMatchObject({ statusCode: 401 });
    expect(() =>
      assertControlPlaneTickAuthorized(`Bearer ${"x".repeat(32)}`),
    ).not.toThrow();
  });
});
