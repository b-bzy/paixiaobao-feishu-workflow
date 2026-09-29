import type { H3Event } from "h3";

const developmentOrigins = new Set(["http://localhost:5173"]);

function allowedOrigins(): Set<string> {
  const configured = process.env.ADMIN_ALLOWED_ORIGINS;
  if (!configured) return developmentOrigins;
  return new Set(
    configured
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

export function applyAdminCors(event: H3Event): void {
  const origin = getRequestHeader(event, "origin");
  if (!origin) return;
  if (!allowedOrigins().has(origin)) {
    throw createError({
      statusCode: 403,
      statusMessage: "Origin is not allowed",
    });
  }
  setResponseHeader(event, "Access-Control-Allow-Origin", origin);
  setResponseHeader(
    event,
    "Access-Control-Allow-Headers",
    "Content-Type, X-Admin-Open-Id",
  );
  setResponseHeader(
    event,
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS",
  );
  setResponseHeader(event, "Vary", "Origin");
}
