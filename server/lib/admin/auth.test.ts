import { describe, expect, it } from "vitest";
import { AdminAccessError, assertDevelopmentAdmin } from "./auth";

describe("development administrator access", () => {
  const env = {
    NODE_ENV: "development",
    ADMIN_AUTH_MODE: "development",
    ADMIN_DEV_OPEN_IDS: "ou_admin, ou_finance",
  };

  it("accepts a configured development administrator", () => {
    expect(assertDevelopmentAdmin("ou_admin", env)).toBe("ou_admin");
  });

  it("rejects a missing or unlisted identity", () => {
    expect(() => assertDevelopmentAdmin(undefined, env)).toThrow(
      AdminAccessError,
    );
    expect(() => assertDevelopmentAdmin("ou_other", env)).toThrow(
      "Administrator access is required",
    );
  });

  it("fails closed outside development mode", () => {
    expect(() =>
      assertDevelopmentAdmin("ou_admin", {
        ...env,
        NODE_ENV: "production",
      }),
    ).toThrow("requires a production identity provider");
  });
});
