import { z } from "zod";
import { requireAdmin } from "~/lib/admin/auth";
import { applyAdminCors } from "~/lib/admin/cors";
import { saveAdminTemplate } from "~/lib/admin/service";
import { expenseTemplateDraftSchema } from "~/lib/feishu/expense-poc";

function parseDraft(body: unknown) {
  const parsed = expenseTemplateDraftSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  throw createError({
    statusCode: 400,
    statusMessage: "Invalid expense template draft",
    data: z.treeifyError(parsed.error),
  });
}

export default defineEventHandler(async (event) => {
  applyAdminCors(event);
  requireAdmin(event);
  return saveAdminTemplate(parseDraft(await readBody(event)));
});
