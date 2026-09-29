import type { Envelope } from "~/lib/feishu/events";

export default defineEventHandler(async (event) => {
  try {
    const payload = await readBody<Envelope>(event);
    if (!payload) {
      throw createError({ statusCode: 400, statusMessage: "Missing body" });
    }
    const { handleFeishuPocEvent } = await import("~/lib/feishu/events");
    const result = await handleFeishuPocEvent(payload);
    if (result.kind === "challenge") return { challenge: result.challenge };
    return {
      code: 0,
      message: result.kind === "handled" ? result.message : result.reason,
    };
  } catch (error) {
    console.error("Feishu expense POC event failed:", error);
    setResponseStatus(event, 400);
    return {
      code: 1,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
});
