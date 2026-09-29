import { requireAdmin } from "~/lib/admin/auth";
import { applyAdminCors } from "~/lib/admin/cors";
import { publishAdminTemplate } from "~/lib/admin/service";

export default defineEventHandler(async (event) => {
  applyAdminCors(event);
  requireAdmin(event);
  const recordId = getRouterParam(event, "recordId");
  if (!recordId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing template record ID",
    });
  }
  return publishAdminTemplate(recordId);
});
