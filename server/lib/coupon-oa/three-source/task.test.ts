import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  confirmCouponThreeSourceDraftOnly,
  confirmCouponThreeSourceNoBlacklist,
  confirmCouponThreeSourceSources,
  createCouponThreeSourceTask,
  replaceCouponThreeSourceSource,
  saveCouponThreeSourceArtifacts,
  setCouponThreeSourceOverlap,
} from "./task";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function source(role: "couponTable" | "whitelist" | "blacklist") {
  return {
    role,
    messageId: `om_${role}`,
    fileKey: `file_${role}`,
    fileName: `${role}.xlsx`,
    bytes: 100,
    sha256: hash(role),
  } as const;
}

describe("coupon three-source R2 task aggregate", () => {
  it("requires explicit no-blacklist confirmation before the first confirmation", () => {
    const created = createCouponThreeSourceTask({
      taskId: "CTS-1",
      ownerOpenId: "ou_owner",
    });
    const withCoupon = replaceCouponThreeSourceSource({
      task: created,
      ownerOpenId: "ou_owner",
      expectedRevision: 1,
      source: source("couponTable"),
    });
    const withWhitelist = replaceCouponThreeSourceSource({
      task: withCoupon,
      ownerOpenId: "ou_owner",
      expectedRevision: 2,
      source: source("whitelist"),
    });

    expect(withWhitelist.blacklistStatus).toBe("absent_pending_confirmation");
    expect(() =>
      confirmCouponThreeSourceSources({
        task: withWhitelist,
        ownerOpenId: "ou_owner",
        expectedRevision: 3,
        snapshotHash: hash("source-confirmation"),
      }),
    ).toThrow("必须明确确认“本次无黑名单”");

    const noBlacklist = confirmCouponThreeSourceNoBlacklist({
      task: withWhitelist,
      ownerOpenId: "ou_owner",
      expectedRevision: 3,
    });
    expect(noBlacklist).toMatchObject({
      revision: 4,
      status: "AwaitingSourceConfirmation",
      blacklistStatus: "absent_confirmed",
    });
  });

  it("binds both confirmations and artifacts to one immutable revision", () => {
    let task = createCouponThreeSourceTask({
      taskId: "CTS-2",
      ownerOpenId: "ou_owner",
    });
    task = replaceCouponThreeSourceSource({
      task,
      ownerOpenId: "ou_owner",
      expectedRevision: task.revision,
      source: source("couponTable"),
    });
    task = replaceCouponThreeSourceSource({
      task,
      ownerOpenId: "ou_owner",
      expectedRevision: task.revision,
      source: source("whitelist"),
    });
    task = confirmCouponThreeSourceNoBlacklist({
      task,
      ownerOpenId: "ou_owner",
      expectedRevision: task.revision,
    });
    task = setCouponThreeSourceOverlap({
      task,
      ownerOpenId: "ou_owner",
      expectedRevision: task.revision,
      overlap: { sha256: hash("empty-overlap"), count: 0 },
    });
    task = confirmCouponThreeSourceSources({
      task,
      ownerOpenId: "ou_owner",
      expectedRevision: task.revision,
      snapshotHash: hash("source-confirmation"),
    });

    const couponHash = hash("standard-coupon");
    task = saveCouponThreeSourceArtifacts({
      task,
      ownerOpenId: "ou_owner",
      expectedRevision: task.revision,
      requiresCalcImage: true,
      artifacts: [
        {
          role: "couponTable",
          fileName: "标准配券表.xlsx",
          bytes: 100,
          sha256: couponHash,
        },
        {
          role: "productWhitelist",
          fileName: "标准白名单.xlsx",
          bytes: 100,
          sha256: hash("standard-whitelist"),
        },
        {
          role: "calcImage",
          fileName: "标准配券表.png",
          bytes: 100,
          sha256: hash("render"),
          sourceArtifactSha256: couponHash,
          rendererVersion: "test-renderer-v1",
          renderRange: "配券表!A1:Z30",
        },
      ],
    });
    expect(task.status).toBe("AwaitingFinalConfirmation");

    const frozen = confirmCouponThreeSourceDraftOnly({
      task,
      ownerOpenId: "ou_owner",
      expectedRevision: task.revision,
      snapshotHash: hash("prefill"),
    });
    expect(frozen).toMatchObject({
      status: "DraftOnlyConfirmed",
      finalConfirmation: {
        actorOpenId: "ou_owner",
        revision: task.revision,
      },
    });

    expect(() =>
      replaceCouponThreeSourceSource({
        task: frozen,
        ownerOpenId: "ou_owner",
        expectedRevision: frozen.revision,
        source: source("couponTable"),
      }),
    ).toThrow("已结束");
  });

  it("allows strict-only artifacts without a calculation image", () => {
    let task = createCouponThreeSourceTask({
      taskId: "CTS-strict",
      ownerOpenId: "ou_owner",
    });
    task = replaceCouponThreeSourceSource({
      task,
      ownerOpenId: "ou_owner",
      expectedRevision: task.revision,
      source: source("couponTable"),
    });
    task = replaceCouponThreeSourceSource({
      task,
      ownerOpenId: "ou_owner",
      expectedRevision: task.revision,
      source: source("whitelist"),
    });
    task = confirmCouponThreeSourceNoBlacklist({
      task,
      ownerOpenId: "ou_owner",
      expectedRevision: task.revision,
    });
    task = confirmCouponThreeSourceSources({
      task,
      ownerOpenId: "ou_owner",
      expectedRevision: task.revision,
      snapshotHash: hash("strict-source-confirmation"),
    });

    expect(
      saveCouponThreeSourceArtifacts({
        task,
        ownerOpenId: "ou_owner",
        expectedRevision: task.revision,
        requiresCalcImage: false,
        artifacts: [
          {
            role: "couponTable",
            fileName: "标准配券表.xlsx",
            bytes: 100,
            sha256: hash("strict-coupon"),
          },
          {
            role: "productWhitelist",
            fileName: "标准白名单.xlsx",
            bytes: 100,
            sha256: hash("strict-whitelist"),
          },
        ],
      }),
    ).toMatchObject({ status: "AwaitingFinalConfirmation" });
  });

  it("invalidates confirmations and artifacts whenever a source changes", () => {
    const started = createCouponThreeSourceTask({
      taskId: "CTS-3",
      ownerOpenId: "ou_owner",
    });
    const sourced = replaceCouponThreeSourceSource({
      task: started,
      ownerOpenId: "ou_owner",
      expectedRevision: started.revision,
      source: source("couponTable"),
    });
    const changed = replaceCouponThreeSourceSource({
      task: sourced,
      ownerOpenId: "ou_owner",
      expectedRevision: sourced.revision,
      source: {
        ...source("couponTable"),
        messageId: "om_replacement",
        sha256: hash("replacement"),
      },
    });

    expect(changed.revision).toBe(3);
    expect(changed.sourceConfirmation).toBeUndefined();
    expect(changed.finalConfirmation).toBeUndefined();
    expect(changed.artifacts).toEqual([]);
  });

  it("rejects non-owner and stale-revision mutations", () => {
    const task = createCouponThreeSourceTask({
      taskId: "CTS-4",
      ownerOpenId: "ou_owner",
    });
    expect(() =>
      confirmCouponThreeSourceNoBlacklist({
        task,
        ownerOpenId: "ou_other",
        expectedRevision: 1,
      }),
    ).toThrow("创建人");
    expect(() =>
      confirmCouponThreeSourceNoBlacklist({
        task,
        ownerOpenId: "ou_owner",
        expectedRevision: 2,
      }),
    ).toThrow("版本已变化");
  });
});
