import { timingSafeEqual } from "node:crypto";
import type { DurableCouponWorkerRunOptions } from "./durable-coupon-control-plane-worker";

export class ControlPlaneTickAuthorizationError extends Error {
  constructor(
    message: string,
    readonly statusCode: 401 | 503,
  ) {
    super(message);
    this.name = "ControlPlaneTickAuthorizationError";
  }
}

function requiredSetting(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

function boundedInteger(input: {
  name: string;
  fallback: number;
  minimum: number;
  maximum: number;
}): number {
  const raw = process.env[input.name]?.trim();
  if (!raw) return input.fallback;
  const value = Number(raw);
  if (
    !Number.isSafeInteger(value) ||
    value < input.minimum ||
    value > input.maximum
  ) {
    throw new Error(
      `${input.name} must be an integer between ${input.minimum} and ${input.maximum}`,
    );
  }
  return value;
}

/**
 * Reads only scheduler execution controls. It intentionally does not contain
 * feature flags or business authorization: receipt processing re-evaluates the
 * command gate for every delivery.
 */
export function getDurableCouponWorkerRunOptions(): DurableCouponWorkerRunOptions {
  const workerId = requiredSetting("FEISHU_WORKER_ID");
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(workerId)) {
    throw new Error("FEISHU_WORKER_ID is invalid");
  }

  const options = {
    workerId,
    jobLimit: boundedInteger({
      name: "CONTROL_PLANE_WORKER_JOB_LIMIT",
      fallback: 10,
      minimum: 1,
      maximum: 100,
    }),
    effectLimit: boundedInteger({
      name: "CONTROL_PLANE_WORKER_EFFECT_LIMIT",
      fallback: 10,
      minimum: 1,
      maximum: 100,
    }),
    jobLeaseMs: boundedInteger({
      name: "CONTROL_PLANE_WORKER_JOB_LEASE_MS",
      fallback: 60_000,
      minimum: 1_000,
      maximum: 15 * 60_000,
    }),
    effectLeaseMs: boundedInteger({
      name: "CONTROL_PLANE_WORKER_EFFECT_LEASE_MS",
      fallback: 150_000,
      minimum: 1_000,
      maximum: 15 * 60_000,
    }),
    schedulerLeaseMs: boundedInteger({
      name: "CONTROL_PLANE_WORKER_SCHEDULER_LEASE_MS",
      fallback: 180_000,
      minimum: 1_000,
      maximum: 20 * 60_000,
    }),
  };
  if (
    options.schedulerLeaseMs <
    Math.max(options.jobLeaseMs, options.effectLeaseMs)
  ) {
    throw new Error(
      "CONTROL_PLANE_WORKER_SCHEDULER_LEASE_MS must cover job and effect leases",
    );
  }
  return options;
}

/**
 * Returns only after a constant-time bearer-token comparison. The token is a
 * scheduler-to-server credential, separate from Feishu ingress authentication.
 */
export function assertControlPlaneTickAuthorized(
  authorization: string | undefined,
): void {
  const token = process.env.CONTROL_PLANE_TICK_TOKEN?.trim();
  if (!token || token.length < 32) {
    throw new ControlPlaneTickAuthorizationError(
      "Control-plane tick endpoint is unavailable",
      503,
    );
  }
  const expected = `Bearer ${token}`;
  const provided = authorization ?? "";
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (
    expectedBytes.length !== providedBytes.length ||
    !timingSafeEqual(expectedBytes, providedBytes)
  ) {
    throw new ControlPlaneTickAuthorizationError(
      "Control-plane tick authorization failed",
      401,
    );
  }
}
