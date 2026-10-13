import { describe, expect, it } from "vitest";
import type { SerializedWorkbookForAi } from "../ai-recognition";
import { createAiReplayGateway } from "./ai-replay";

const workbook: SerializedWorkbookForAi = {
  fileName: "synthetic.xlsx",
  sourceHash: "a".repeat(64),
  byteLength: 123,
  sheets: [
    {
      name: "配券表",
      state: "visible",
      rowCount: 2,
      columnCount: 2,
      mergeRanges: [],
      rows: [
        {
          row: 1,
          cells: [{ address: "A1", kind: "string", value: "活动名称" }],
        },
      ],
    },
  ],
};

describe("coupon three-source AI replay gateway", () => {
  it("returns one deterministic successful response per semantic request", async () => {
    const gateway = createAiReplayGateway("complete");
    const first = await gateway.recognize({ workbook });
    const second = await gateway.recognize({ workbook });
    expect(first).toEqual(second);
    expect(gateway.audit()).toMatchObject({ calls: 2, uniqueRequests: 1 });
    expect(first.ok).toBe(true);
  });

  it.each(["timeout", "rate-limited", "invalid-json", "provider-error"])(
    "replays %s without network access",
    async (scenario) => {
      const gateway = createAiReplayGateway(scenario);
      const result = await gateway.recognize({ workbook });
      expect(result.ok).toBe(false);
      expect(gateway.audit().networkCalls).toBe(0);
    },
  );

  it("rejects an unknown replay scenario", () => {
    expect(() => createAiReplayGateway("not-registered")).toThrow(/replay/iu);
  });
});
