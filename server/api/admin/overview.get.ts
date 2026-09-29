import { requireAdmin } from "~/lib/admin/auth";
import { applyAdminCors } from "~/lib/admin/cors";
import { getAdminOverview } from "~/lib/admin/service";

export default defineEventHandler(async (event) => {
  applyAdminCors(event);
  requireAdmin(event);
  return getAdminOverview();
});
