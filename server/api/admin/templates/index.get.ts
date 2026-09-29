import { requireAdmin } from "~/lib/admin/auth";
import { applyAdminCors } from "~/lib/admin/cors";
import { getAdminTemplates } from "~/lib/admin/service";

export default defineEventHandler(async (event) => {
  applyAdminCors(event);
  requireAdmin(event);
  return getAdminTemplates();
});
