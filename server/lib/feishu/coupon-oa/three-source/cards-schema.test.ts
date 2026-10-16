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
    node.forEach((item, index) => {
      collectViolations(item, `${path}[${index}]`, violations);
    });
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
    // Feishu rejects the whole card when any component name exceeds 100
    // characters (ErrCode 11310, live-verified 2026-10-16 — a 64-hex context
    // hash suffix bricked every mapping confirm button).
    const componentName = record.name;
    if (typeof componentName === "string" && componentName.length > 100) {
      violations.push(
        `${path}(${tag}): name length ${componentName.length} exceeds Feishu limit 100`,
      );
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

function assertFeishuCardSchema(cards: unknown, label: string): void {
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
    // Hostile-length record id (Feishu record ids observed ~16 chars): the
    // action-name codec must keep every button name within the 100-char
    // limit even at this bound.
    recordId: `rec-schema-${"0".repeat(19)}`,
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
  // Hostile inputs: a revision with extra digits, and 900-character
  // Excel-derived values that must be dropped from prefill (never
  // truncated) with a manual-entry notice. Revision stays small enough that
  // the action name remains constructible at the hostile record-id bound.
  draft.task.revision = 42;
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
      claimRule: [
        {
          id: "claim-rule-1",
          key: "claimRule",
          score: 1,
          header: "领取规则",
          headerRow: 1,
          column: "K",
          sheetName: "Sheet1",
          sampleValues: ["活动期间每天可领一次".padEnd(900, "长")],
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
    activityBackground: "背".repeat(900),
  };
  draft.failureReason = "上次确认未完成：示例原因";
  draft.validationIssues = [
    "输入校验[totalQuantity]：「申请总数量」的取值无法识别为数字，请修改后重新提交",
    "输入校验[claimRule]：「领取规则」的取值无法识别，请修改后重新提交",
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

  it("revisioned action names stay within the Feishu name limit", () => {
    for (const build of [baseDraft, fullFeatureDraft]) {
      const names: string[] = [];
      const collectNames = (node: unknown): void => {
        if (Array.isArray(node)) {
          node.forEach(collectNames);
          return;
        }
        if (node && typeof node === "object") {
          for (const [key, value] of Object.entries(node)) {
            if (key === "name" && typeof value === "string") {
              names.push(value);
            } else {
              collectNames(value);
            }
          }
        }
      };
      collectNames(buildCouponThreeSourceMappingCard(build()));
      const confirm = names.find((name) =>
        name.startsWith("coupon_three_source_mapping_confirm:"),
      );
      expect(confirm).toMatch(
        /^coupon_three_source_mapping_confirm:[^:]+:\d+:[a-f0-9]{24}$/,
      );
      for (const name of names) {
        expect(name.length).toBeLessThanOrEqual(100);
      }
    }
  });

  it("fails closed in the builder when the name budget is exhausted", () => {
    // 30-char record id + 10-digit revision exceeds the 100-char budget:
    // the codec must refuse to build rather than ship a card Feishu will
    // reject (and burn five effect retries on).
    const draft = fullFeatureDraft();
    draft.task.revision = 1234567890;
    expect(() => buildCouponThreeSourceMappingCard(draft)).toThrow(
      "100 字符上限",
    );
  });

  it("drops oversize prefills with a manual-entry notice instead of truncating", () => {
    const content = JSON.stringify(
      buildCouponThreeSourceMappingCard(fullFeatureDraft()),
    );
    expect(content).toContain("已清空预填");
    expect(content).toContain("领取规则");
    for (const match of content.matchAll(
      /"default_value":"((?:[^"\\]|\\.)*)"/g,
    )) {
      const value = JSON.parse(`"${match[1]}"`) as string;
      expect(value.length).toBeLessThanOrEqual(800);
    }
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

  it("the walker itself rejects an over-long component name", () => {
    const badCard = {
      ...buildCouponThreeSourceIntakeCard(),
      body: {
        direction: "vertical",
        elements: [
          {
            tag: "input",
            name: "x".repeat(101),
            label: { tag: "plain_text", content: "超长" },
          } as never,
        ],
      },
    } as unknown as FeishuCard;
    const violations: string[] = [];
    collectViolations(badCard, "card", violations);
    expect(violations.join("\n")).toContain("exceeds Feishu limit 100");
  });
});

describe("form component name uniqueness (11310 regression)", () => {
  const incidentDraft = (): CouponThreeSourcePilotDraft => {
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
      roleCandidates: [],
      couponFieldCandidates: {
        promotionMode: [
          {
            id: "pm-1",
            key: "promotionMode",
            score: 1,
            header: "推广途径",
            headerRow: 1,
            column: "V",
            sheetName: "Sheet1",
            sampleValues: ["公开自动推广"],
            reasons: [],
          },
        ],
        publicPromotionChannels: [
          {
            id: "ch-1",
            key: "publicPromotionChannels",
            score: 1,
            header: "公开推广渠道",
            headerRow: 1,
            column: "W",
            sheetName: "Sheet1",
            sampleValues: ["", ""],
            reasons: [],
          },
        ],
      },
      listCandidates: [],
      issues: [],
    };
    draft.validationIssues = [
      "输入校验[publicPromotionChannels]：公开自动推广时必须填写公开推广渠道",
    ];
    return draft;
  };

  it("form component names are unique within every mapping card shape", () => {
    for (const build of [baseDraft, fullFeatureDraft, incidentDraft]) {
      const card = buildCouponThreeSourceMappingCard(
        build() as CouponThreeSourcePilotDraft,
      );
      const names: string[] = [];
      const collect = (node: unknown): void => {
        if (Array.isArray(node)) {
          node.forEach(collect);
          return;
        }
        if (node && typeof node === "object") {
          for (const [key, value] of Object.entries(node)) {
            if (key === "name" && typeof value === "string") {
              names.push(value);
            } else {
              collect(value);
            }
          }
        }
      };
      collect(card);
      const duplicates = names.filter(
        (name, index) => names.indexOf(name) !== index,
      );
      expect(
        duplicates,
        `${build.name}: duplicate component names ${duplicates.join(",")}`,
      ).toEqual([]);
    }
  });

  it("incident shape renders public promotion channels exactly once", () => {
    const rendered = JSON.stringify(
      buildCouponThreeSourceMappingCard(incidentDraft()),
    );
    // 2026-10-16 事故复现形态：校验问题命中 + 列头在但值空，两区同时命中
    // 时只允许出现一次（重复即飞书 11310 整卡拒收）。
    expect(rendered.match(/owner_publicPromotionChannels/g)?.length).toBe(1);
  });
});
