import { applyAdminCors } from "~/lib/admin/cors";

export default defineEventHandler((event) => {
  applyAdminCors(event);
  setResponseStatus(event, 204);
  return "";
});
