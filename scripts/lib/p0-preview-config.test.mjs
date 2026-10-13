import { expect, it } from "vitest";
import { parseP0PreviewEnv, loadP0PreviewConfig } from "./p0-preview-config.mjs";

it("parses quoted secrets without evaluating shell syntax", () => {
  const values = parseP0PreviewEnv('A="literal-$()"\nB=value\n');
  expect(values).toEqual({ A: "literal-$()", B: "value" });
});

it("rejects duplicate variables", () => {
  expect(() => parseP0PreviewEnv("A=1\nA=2\n")).toThrow("重复变量");
});

it("requires a mode-0600 config", async () => {
  await expect(
    loadP0PreviewConfig({
      statImpl: async () => ({ mode: 0o100644 }),
      readFileImpl: async () => "",
    }),
  ).rejects.toThrow("0600");
});

it("loads the required runner credentials", async () => {
  const config = await loadP0PreviewConfig({
    statImpl: async () => ({ mode: 0o100600 }),
    readFileImpl: async () =>
      [
        "FEISHU_BRIDGE_KEY_ID=coupon-p0-preview-v1",
        `FEISHU_BRIDGE_SHARED_SECRET=${"a".repeat(64)}`,
        "CONTROL_PLANE_TICK_TOKEN=tick",
        "VERCEL_AUTOMATION_BYPASS_SECRET=bypass",
      ].join("\n"),
  });
  expect(config.FEISHU_BRIDGE_KEY_ID).toBe("coupon-p0-preview-v1");
});
