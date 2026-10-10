import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  createWorker: vi.fn(),
  getOptions: vi.fn(),
  getStage: vi.fn(),
  isAiEnabled: vi.fn(),
  runOnce: vi.fn(),
}));

vi.mock("~/lib/control-plane/durable-coupon-control-plane-worker", () => ({
  createConfiguredDurableCouponControlPlaneWorker: mocks.createWorker,
}));
vi.mock("~/lib/control-plane/durable-worker-tick", () => ({
  assertControlPlaneTickAuthorized: mocks.authorize,
  ControlPlaneTickAuthorizationError: class ControlPlaneTickAuthorizationError extends Error {
    statusCode: 401 | 503 = 401;
  },
  getDurableCouponWorkerRunOptions: mocks.getOptions,
}));
vi.mock("~/lib/control-plane/runtime-config", () => ({
  getFeishuRuntimeStage: mocks.getStage,
}));
vi.mock("~/lib/feishu/coupon-oa/three-source/ai-config", () => ({
  isCouponThreeSourceAiRecognitionEnabled: mocks.isAiEnabled,
}));

interface FakeTickEvent {
  headers: Record<string, string>;
  responseStatus?: number;
}

async function tickHandler() {
  return (await import("../../api/internal/control-plane/tick.post"))
    .default as unknown as (
    event: FakeTickEvent,
  ) => Promise<Record<string, unknown>>;
}

describe("durable control-plane tick route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.isAiEnabled.mockReturnValue(false);
    mocks.getOptions.mockReturnValue({
      workerId: "worker-1",
      jobLimit: 10,
      effectLimit: 10,
      jobLeaseMs: 60_000,
      effectLeaseMs: 60_000,
      schedulerLeaseMs: 90_000,
    });
    mocks.createWorker.mockReturnValue({ runOnce: mocks.runOnce });
    mocks.runOnce.mockResolvedValue({
      skipped: false,
      jobs: { claimed: 0, succeeded: 0, retried: 0, deadLettered: 0 },
      effects: {
        claimed: 0,
        succeeded: 0,
        retried: 0,
        deadLettered: 0,
        outcomeUnknown: 0,
      },
    });
    vi.stubGlobal("defineEventHandler", <T>(handler: T) => handler);
    vi.stubGlobal(
      "getHeader",
      (event: FakeTickEvent, name: string) => event.headers[name],
    );
    vi.stubGlobal(
      "setResponseStatus",
      (event: FakeTickEvent, status: number) => {
        event.responseStatus = status;
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("is unavailable in local mode before attempting authorization or database work", async () => {
    mocks.getStage.mockReturnValue("local");
    const event: FakeTickEvent = { headers: {} };

    await expect((await tickHandler())(event)).resolves.toEqual({
      code: 1,
      message: "Durable worker is not installed",
    });
    expect(event.responseStatus).toBe(503);
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(mocks.createWorker).not.toHaveBeenCalled();
  });

  it("runs a configured worker only after the route authorization guard", async () => {
    mocks.getStage.mockReturnValue("r2-draft-only");
    const event: FakeTickEvent = {
      headers: { authorization: "Bearer scheduler-token" },
    };

    await expect((await tickHandler())(event)).resolves.toMatchObject({
      code: 0,
      result: { skipped: false },
    });
    expect(mocks.authorize).toHaveBeenCalledWith("Bearer scheduler-token");
    expect(mocks.runOnce).toHaveBeenCalledWith(
      expect.objectContaining({ workerId: "worker-1" }),
    );
  });

  it("allows an authorized local tick only when the P0 AI gate is enabled", async () => {
    mocks.getStage.mockReturnValue("local");
    mocks.isAiEnabled.mockReturnValue(true);
    const event: FakeTickEvent = {
      headers: { authorization: "Bearer scheduler-token" },
    };

    await expect((await tickHandler())(event)).resolves.toMatchObject({
      code: 0,
      result: { skipped: false },
    });
    expect(mocks.authorize).toHaveBeenCalledWith("Bearer scheduler-token");
    expect(mocks.runOnce).toHaveBeenCalledWith(
      expect.objectContaining({ workerId: "worker-1" }),
    );
  });
});
