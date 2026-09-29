import { getServiceStatus } from "~/lib/health";

export default defineEventHandler(() => getServiceStatus());
