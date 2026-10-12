import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  diagnose: vi.fn(),
}));

vi.mock("~/lib/control-plane/coupon-ai-diagnostics", () => ({
  getRecentCouponAiDiagnostics: mocks.diagnose,
}));
vi.mock("~/lib/control-plane/durable-worker-tick", () => ({
  assertControlPlaneTickAuthorized: mocks.authorize,
  ControlPlaneTickAuthorizationError: class ControlPlaneTickAuthorizationError extends Error {
    statusCode: 401 | 503 = 401;
  },
}));

interface FakeEvent {
  headers: Record<string, string>;
  responseStatus?: number;
}

async function handler() {
  return (await import("../../api/internal/control-plane/ai-diagnostics.get"))
    .default as unknown as (
    event: FakeEvent,
  ) => Promise<Record<string, unknown>>;
}

describe("coupon AI diagnostics route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.diagnose.mockResolvedValue([{ status: "succeeded" }]);
    vi.stubGlobal("defineEventHandler", <T>(value: T) => value);
    vi.stubGlobal(
      "getHeader",
      (event: FakeEvent, name: string) => event.headers[name],
    );
    vi.stubGlobal("setResponseStatus", (event: FakeEvent, status: number) => {
      event.responseStatus = status;
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("returns diagnostics only after control-plane authorization", async () => {
    const event = {
      headers: { authorization: "Bearer scheduler-token" },
    };
    await expect((await handler())(event)).resolves.toEqual({
      code: 0,
      result: [{ status: "succeeded" }],
    });
    expect(mocks.authorize).toHaveBeenCalledWith("Bearer scheduler-token");
  });
});
