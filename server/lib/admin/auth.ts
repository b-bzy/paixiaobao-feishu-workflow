import type { H3Event } from "h3";

export class AdminAccessError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "AdminAccessError";
  }
}

function configuredAdminIds(
  value = process.env.ADMIN_DEV_OPEN_IDS,
): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function assertDevelopmentAdmin(
  openId: string | undefined,
  env = process.env,
): string {
  if (env.NODE_ENV === "production" || env.ADMIN_AUTH_MODE !== "development") {
    throw new AdminAccessError(
      "The administrator API requires a production identity provider",
      503,
    );
  }
  if (!openId) {
    throw new AdminAccessError("Missing administrator identity", 401);
  }
  if (!configuredAdminIds(env.ADMIN_DEV_OPEN_IDS).has(openId)) {
    throw new AdminAccessError("Administrator access is required", 403);
  }
  return openId;
}

export function requireAdmin(event: H3Event): string {
  return assertDevelopmentAdmin(getRequestHeader(event, "x-admin-open-id"));
}
