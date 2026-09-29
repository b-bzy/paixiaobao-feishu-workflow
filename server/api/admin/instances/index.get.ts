import { requireAdmin } from "~/lib/admin/auth";
import { applyAdminCors } from "~/lib/admin/cors";
import { getAdminInstances } from "~/lib/admin/service";
import type { WorkflowInstance } from "~/lib/feishu/expense-poc";

const statuses = new Set<WorkflowInstance["status"]>([
  "Pending",
  "Approved",
  "Rejected",
]);

export default defineEventHandler(async (event) => {
  applyAdminCors(event);
  requireAdmin(event);
  const status = getQuery(event).status;
  if (
    typeof status === "string" &&
    !statuses.has(status as WorkflowInstance["status"])
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid instance status",
    });
  }
  return getAdminInstances(status as WorkflowInstance["status"] | undefined);
});
