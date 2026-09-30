import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CouponExcelPilotDraft } from "./excel-pilot-store";

vi.mock("./excel-pilot-store", () => ({
  sourceFileMetadata: vi.fn(),
  updateCouponExcelPilotDraft: vi.fn(),
}));

import { confirmCouponPilotInput } from "./excel-pilot-service";
import { updateCouponExcelPilotDraft } from "./excel-pilot-store";

const draft = {
  recordId: "rec-pilot",
  pilotId: "CEP-test",
  ownerOpenId: "ou_test",
  status: "AwaitingInputConfirmation",
  revision: 2,
  schemaVersion: "coupon-excel-pilot-v1",
  input: {} as never,
  artifacts: [],
  validationIssues: [],
  processedMessageIds: [],
} as CouponExcelPilotDraft;

describe("coupon Excel pilot input confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists the whitelist-upload state only after confirmation", async () => {
    const confirmed = {
      ...draft,
      status: "AwaitingWhitelistUpload" as const,
      revision: 3,
    };
    vi.mocked(updateCouponExcelPilotDraft).mockResolvedValue(confirmed);

    await expect(confirmCouponPilotInput(draft)).resolves.toEqual(confirmed);

    expect(updateCouponExcelPilotDraft).toHaveBeenCalledWith(draft, {
      status: "AwaitingWhitelistUpload",
      validationIssues: [],
      failureReason: undefined,
    });
  });

  it("does not confirm incomplete coupon input", async () => {
    await expect(
      confirmCouponPilotInput({ ...draft, input: undefined }),
    ).rejects.toThrow("当前优惠券字段不能确认");
    expect(updateCouponExcelPilotDraft).not.toHaveBeenCalled();
  });
});
