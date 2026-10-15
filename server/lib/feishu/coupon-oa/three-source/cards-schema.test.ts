import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCouponThreeSourceTask } from "../../../coupon-oa/three-source/task";
import type { FeishuCard } from "../../expense-poc";
import {
  buildCouponOaAttachmentRequestCard,
  buildCouponOaSubmitCard,
} from "../cards";
import {
  buildCouponThreeSourceClearedCard,
  buildCouponThreeSourceCompletedCard,
  buildCouponThreeSourceErrorCard,
  buildCouponThreeSourceGeneratingArtifactsCard,
  buildCouponThreeSourceIntakeCard,
  buildCouponThreeSourceMappingCard,
  buildCouponThreeSourceNoBlacklistCard,
  buildCouponThreeSourceOverlapCard,
  buildCouponThreeSourcePreviewCard,
  buildCouponThreeSourceRecognizingCard,
  buildCouponThreeSourceRoleCard,
  buildCouponThreeSourceRuntimeBlockedCard,
  buildCouponThreeSourceUnavailableCard,
} from "./cards";
import type { CouponThreeSourcePilotDraft } from "./store";

/**
 * Structural guard against Feishu card-schema regressions (class: ErrCode
 * 200621 "unknown property" — e.g. a `label` on select_static made every
 * mapping-card delivery fail while recognition kept succeeding). Every card
 * built anywhere on the pilot path must only use properties the live im API
 * has accepted. Adding a new property to a builder requires adding it here
 * AND re-running the live-send audit once.
 */
const allowedProperties: Record<string, ReadonlySet<string>> = {
  _card: new Set(["schema", "config", "header", "body"]),
  _config: new Set(["update_multi", "width_mode"]),
  _header: new Set(["title", "subtitle", "template", "icon", "text_tag_list"]),
  _textTag: new Set(["tag", "text", "color"]),
  _body: new Set(["direction", "padding", "vertical_spacing", "elements"]),
  _plainText: new Set(["tag", "content"]),
  markdown: new Set(["tag", "content"]),
  button: new Set([
    "tag",
    "text",
    "type",
    "width",
    "behaviors",
    "name",
    "form_action_type",
  ]),
  form: new Set(["tag", "name", "vertical_spacing", "elements"]),
  input: new Set([
    "tag",
    "name",
    "label",
    "input_type",
    "rows",
    "required",
    "width",
    "default_value",
  ]),
  // select_static supports NEITHER `label` NOR `default_value` in the
  // Feishu schema (live-audited: both fail the whole card with 200621) —
  // titles are separate markdown lines; stored choices survive in the
  // server-side merge instead of being pre-selected client-side.
  select_static: new Set([
    "tag",
    "name",
    "placeholder",
    "required",
    "width",
    "options",
  ]),
  column_set: new Set(["tag", "flex_mode", "horizontal_spacing", "columns"]),
  column: new Set(["tag", "width", "weight", "elements"]),
};

const behaviorProperties = new Set(["type", "value", "default_url"]);

function collectViolations(
  node: unknown,
  path: string,
  violations: string[],
): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) =>
      collectViolations(item, `${path}[${index}]`, violations),
    );
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  const tag = typeof record.tag === "string" ? record.tag : undefined;
  const whitelist = tag ? allowedProperties[tag] : undefined;
  if (whitelist) {
    for (const key of Object.keys(record)) {
      if (!whitelist.has(key)) {
        violations.push(`${path}(${tag}): unknown property "${key}"`);
      }
    }
  } else if (tag === undefined) {
    // Structural objects without a tag (card root, config, header, body,
    // behavior entries, plain-text objects) are validated by their position.
    const parent = path.split(".").pop() ?? path;
    const structural: Array<[RegExp, ReadonlySet<string>]> = [
      [/^card(\[\d+\])?$/, allowedProperties._card],
      [/^card\.config$/, allowedProperties._config],
      [/^card\.header$/, allowedProperties._header],
      [/^card\.body$/, allowedProperties._body],
      [/^behaviors(\[\d+\])?$/, behaviorProperties],
      [/^options(\[\d+\])?$/, new Set(["text", "value"])],
      [
        /^(text|title|subtitle|placeholder|label)(\[0\])?$/,
        allowedProperties._plainText,
      ],
      [/^text_tag$/, allowedProperties._textTag],
    ];
    const match = structural.find(([pattern]) => pattern.test(parent));
    if (match) {
      for (const key of Object.keys(record)) {
        if (!match[1].has(key)) {
          violations.push(`${path}: unknown property "${key}"`);
        }
      }
    }
  }
  for (const [key, value] of Object.entries(record)) {
    if (value !== null && typeof value === "object") {
      collectViolations(value, `${path}.${key}`, violations);
    }
  }
}

export function assertFeishuCardSchema(cards: unknown, label: string): void {
  const violations: string[] = [];
  collectViolations(cards, "card", violations);
  expect(violations, `${label}:\n${violations.join("\n")}`).toEqual([]);
}

function baseDraft(): CouponThreeSourcePilotDraft {
  const task = createCouponThreeSourceTask({
    taskId: "CTS-schema",
    ownerOpenId: "ou_owner",
  });
  task.revision = 4;
  task.status = "AwaitingSourceConfirmation";
  const source = {
    messageId: "om-source",
    fileKey: "file-key",
    fileName: "配券表.xlsx",
    bytes: 10,
    sha256: "a".repeat(64),
  };
  task.sources = {
    couponTable: { role: "couponTable", ...source },
    whitelist: { role: "whitelist", ...source },
  };
  task.blacklistStatus = "absent_confirmed";
  return {
    recordId: "rec-schema",
    pilotId: "CTS-schema",
    ownerOpenId: "ou_owner",
    task,
    schemaVersion: "coupon-three-source-pilot-v2",
    recognitions: {},
    selections: {},
    artifacts: [],
    processedMessageIds: [],
    validationIssues: [],
  };
}

const fullFeatureDraft = (): CouponThreeSourcePilotDraft => {
  const draft = baseDraft();
  draft.task.blacklistStatus = "absent_pending_confirmation";
  draft.task.confirmedCalcImages = [
    {
      artifactId: "calc-1",
      messageId: "om-img",
      resourceKey: "img",
      resourceType: "image",
      sourceType: "feishu_image",
      fileName: "测算图1.png",
      contentType: "image/png",
      bytes: 100,
      width: 10,
      height: 10,
      sha256: "b".repeat(64),
      receivedAt: "2026-10-15T00:00:00.000Z",
      receivedOrder: 0,
      revision: 4,
      actorOpenId: "ou_owner",
    },
  ];
  draft.task.pendingCalcImages = [
    {
      artifactId: "calc-2",
      messageId: "om-img-2",
      resourceKey: "img2",
      resourceType: "image",
      sourceType: "feishu_image",
      fileName: "测算图2.png",
      contentType: "image/png",
      bytes: 100,
      width: 10,
      height: 10,
      sha256: "c".repeat(64),
      receivedAt: "2026-10-15T00:00:00.000Z",
      receivedOrder: 1,
      revision: 4,
      actorOpenId: "ou_owner",
    },
  ];
  draft.recognitions.couponTable = {
    source: {
      messageId: "om-source",
      fileKey: "file-key",
      fileName: "配券表.xlsx",
      bytes: 10,
      sha256: "a".repeat(64),
    },
    sourceHash: "a".repeat(64),
    roleCandidates: [],
    couponFieldCandidates: {
      totalQuantity: [
        {
          id: "total-1",
          key: "totalQuantity",
          score: 1,
          header: "总申请数量",
          headerRow: 1,
          column: "J",
          sheetName: "Sheet1",
          sampleValues: ["1000"],
          reasons: [],
        },
      ],
    },
    listCandidates: [],
    issues: [],
    ai: {
      runId: "run-1",
      revision: 4,
      sourceSha256: "a".repeat(64),
      status: "failed",
      fallbackCode: "timeout",
      primary: true,
      activityCopyEnabled: true,
    },
  };
  draft.supplementRecognition = {
    kind: "owner_supplement",
    text: "语音转写内容",
    textSha256: "d".repeat(64),
    runId: "run-text",
    revision: 4,
    status: "succeeded",
  };
  draft.selections.ownerFieldValues = {
    overDeduction: "是",
    overDeductionReason: "历史遗留扣点",
    channels: ["京东", "拍拍"],
  };
  draft.failureReason = "上次确认未完成：示例原因";
  draft.validationIssues = [
    "输入校验[totalQuantity]：「申请总数量」的取值无法识别为数字，请修改后重新提交",
    "补充说明识别提示：示例提示",
  ];
  return draft;
};

describe("Feishu card schema audit across the pilot chain", () => {
  beforeEach(() => {
    process.env.FEISHU_WEB_BASE_URL = "https://preview.example.com";
  });
  afterEach(() => {
    delete process.env.FEISHU_WEB_BASE_URL;
  });

  it("static state cards only use accepted properties", () => {
    assertFeishuCardSchema(
      [
        buildCouponThreeSourceUnavailableCard(),
        buildCouponThreeSourceRuntimeBlockedCard(),
        buildCouponThreeSourceGeneratingArtifactsCard(),
        buildCouponThreeSourceClearedCard({
          clearedCount: 1,
          closedOaDraftCount: 1,
        }),
        buildCouponThreeSourceClearedCard({ clearedCount: 0 }),
        buildCouponThreeSourceCompletedCard(baseDraft()),
        buildCouponThreeSourceErrorCard({ message: "示例原因" }),
        buildCouponThreeSourceErrorCard({
          message: "版本已变化",
          reopen: { recordId: "rec-schema", revision: 4 },
        }),
      ],
      "static cards",
    );
  });

  it("intake, role, blacklist, recognizing and overlap cards stay clean", () => {
    const draft = baseDraft();
    draft.recognitions.couponTable = {
      source: {
        messageId: "om-source",
        fileKey: "file-key",
        fileName: "配券表.xlsx",
        bytes: 10,
        sha256: "a".repeat(64),
      },
      sourceHash: "a".repeat(64),
      roleCandidates: [
        {
          id: "role-1",
          role: "couponTable",
          score: 90,
          reasons: ["示例"],
        },
      ],
      couponFieldCandidates: {},
      listCandidates: [],
      issues: [],
    };
    draft.pendingRecognition = draft.recognitions.couponTable;
    assertFeishuCardSchema(
      [
        buildCouponThreeSourceIntakeCard(),
        buildCouponThreeSourceIntakeCard(draft),
        buildCouponThreeSourceRoleCard({
          draft,
          recognition: draft.recognitions.couponTable,
        }),
        buildCouponThreeSourceNoBlacklistCard(draft),
        buildCouponThreeSourceRecognizingCard(draft),
        buildCouponThreeSourceOverlapCard({ draft, count: 3 }),
      ],
      "flow cards",
    );
  });

  it("mapping card variants (full feature matrix) stay clean", () => {
    assertFeishuCardSchema(
      [
        buildCouponThreeSourceMappingCard(baseDraft()),
        buildCouponThreeSourceMappingCard(fullFeatureDraft()),
      ],
      "mapping cards",
    );
  });

  it("preview and OA send cards stay clean", () => {
    const draft = baseDraft();
    draft.task.status = "AwaitingFinalConfirmation";
    draft.oaPrefill = {
      ownerId: "ou_owner",
      revision: 4,
      snapshotHash: "e".repeat(64),
      values: {
        businessMode: "寄卖",
        activityName: "活动",
        activityPointPercent: 6,
        overDeduction: "否",
        activityStartAt: "2030-01-01",
        activityEndAt: "2030-01-02",
      } as never,
      attachments: [],
      blacklistStatus: "absent_confirmed",
      overlap: { ids: [], sha256: "f".repeat(64) },
    };
    draft.artifacts = [
      {
        artifactId: "couponTable-x",
        order: 0,
        role: "couponTable",
        fileName: "配券表.xlsx",
        fileToken: "tok-1",
        bytes: 10,
        sha256: "1".repeat(64),
        templateId: "t",
        templateVersion: "v1",
        previewGrantedFor: "ou_owner",
      },
      {
        artifactId: "calcImage-1",
        order: 0,
        role: "calcImage",
        fileName: "测算图1.png",
        fileToken: "tok-2",
        bytes: 10,
        sha256: "2".repeat(64),
        templateId: "user-upload",
        templateVersion: "1",
        contentType: "image/png",
        previewGrantedFor: "ou_owner",
      },
    ];
    assertFeishuCardSchema(
      buildCouponThreeSourcePreviewCard(draft),
      "preview card",
    );

    const oaValues = {
      applicationType: "优惠券申请",
      businessMode: "寄卖",
      activityName: "活动",
      activityBackground: "背景",
      activityPointPercent: 6,
      platformBearingPercent: 50,
      overDeduction: "否",
      estimatedGmvYuan: 1000,
      estimatedCostYuan: 100,
      channels: ["京东渠道"],
      activityStartAt: "2030-01-01",
      activityEndAt: "2030-01-02",
    } as never;
    assertFeishuCardSchema(
      buildCouponOaSubmitCard({
        draftRecordId: "rec-oa",
        values: oaValues,
        attachments: [
          {
            role: "couponTable",
            fileName: "配券表.xlsx",
            fileCode: "code-1",
            sha256: "3".repeat(64),
            bytes: 100,
          },
        ],
        stepLabel: "第 4 步：核对无误后点击确认，将创建并发送正式 OA",
      }),
      "OA send card",
    );
    assertFeishuCardSchema(
      buildCouponOaAttachmentRequestCard({
        draftId: "COA-1",
        missing: ["商品明细白名单（.xlsx）"],
      }),
      "attachment request card",
    );
  });

  it("the walker itself rejects a card with an invalid property", () => {
    const badCard = {
      ...buildCouponThreeSourceIntakeCard(),
      body: {
        direction: "vertical",
        elements: [
          {
            tag: "select_static",
            name: "broken",
            label: { tag: "plain_text", content: "不该存在" },
            placeholder: { tag: "plain_text", content: "x" },
            options: [],
          } as never,
        ],
      },
    } as unknown as FeishuCard;
    const violations: string[] = [];
    collectViolations(badCard, "card", violations);
    expect(violations.join("\n")).toContain('unknown property "label"');
  });
});
