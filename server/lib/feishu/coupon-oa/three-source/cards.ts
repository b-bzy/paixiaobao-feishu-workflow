import type {
  CouponCandidate,
  CouponFieldCandidate,
  CouponFieldKey,
  ListColumnCandidate,
} from "../../../coupon-oa/three-source/types";
import type { FeishuCard } from "../../expense-poc";
import type {
  CouponThreeSourcePilotDraft,
  StoredWorkbookRecognition,
} from "./store";

const plainText = (content: string) => ({ tag: "plain_text", content });

function card(input: {
  title: string;
  subtitle: string;
  template: string;
  content?: string;
  elements?: Array<Record<string, unknown>>;
}): FeishuCard {
  return {
    schema: "2.0",
    config: { update_multi: true, width_mode: "default" },
    header: {
      title: plainText(input.title),
      subtitle: plainText(input.subtitle),
      template: input.template,
      icon: { tag: "standard_icon", token: "form_colorful" },
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 20px 12px",
      vertical_spacing: "12px",
      elements: input.elements ?? [
        { tag: "markdown", content: input.content ?? "" },
      ],
    },
  };
}

function actionValue(draft: CouponThreeSourcePilotDraft, action: string) {
  return {
    action,
    pilotRecordId: draft.recordId,
    revision: draft.task.revision,
  };
}

function button(
  draft: CouponThreeSourcePilotDraft,
  input: {
    action: string;
    text: string;
    type?: string;
    extra?: Record<string, unknown>;
  },
): Record<string, unknown> {
  return {
    tag: "button",
    text: plainText(input.text),
    type: input.type ?? "primary_filled",
    width: "fill",
    behaviors: [
      {
        type: "callback",
        value: { ...actionValue(draft, input.action), ...input.extra },
      },
    ],
  };
}

function cancelButton(
  draft: CouponThreeSourcePilotDraft,
): Record<string, unknown> {
  return button(draft, {
    action: "coupon_three_source_cancel",
    text: "结束当前三源提报",
    type: "danger",
  });
}

function candidateText(
  candidate: CouponFieldCandidate | ListColumnCandidate,
): string {
  return `${candidate.sheetName} / ${candidate.column}（${candidate.header}）`;
}

function candidateSelect(input: {
  name: string;
  label: string;
  candidates: Array<CouponFieldCandidate | ListColumnCandidate>;
  required?: boolean;
}): Record<string, unknown> {
  return {
    tag: "select_static",
    name: input.name,
    placeholder: plainText(`请选择${input.label}`),
    required: input.required ?? false,
    width: "fill",
    options: input.candidates.map((candidate) => ({
      text: plainText(candidateText(candidate)),
      value: candidate.id,
    })),
  };
}

function sourcesSummary(draft: CouponThreeSourcePilotDraft): string[] {
  const sources = draft.task.sources;
  return [
    `- 配券表：${sources.couponTable?.fileName ?? "待上传"}`,
    `- 商品白名单：${sources.whitelist?.fileName ?? "待上传"}`,
    `- 商品黑名单：${
      sources.blacklist?.fileName ??
      (draft.task.blacklistStatus === "absent_confirmed"
        ? "已确认无黑名单"
        : "待上传或确认无黑名单")
    }`,
  ];
}

export function buildCouponThreeSourceUnavailableCard(): FeishuCard {
  return card({
    title: "OA 优惠券提报暂未开放",
    subtitle: "三源 Bot 试点未启用",
    template: "orange",
    content: [
      "`/OA优惠券提报` 的服务端试点模块默认关闭。",
      "当前不会读取来源文件、创建系统草稿、上传文件或创建原生 OA。",
      "请继续使用已开放流程，或联系试点维护人完成受控资源配置。",
    ].join("\n"),
  });
}

export function buildCouponThreeSourceRuntimeBlockedCard(): FeishuCard {
  return card({
    title: "OA 优惠券提报尚不能开始",
    subtitle: "当前用户或环境未通过试点 Gate",
    template: "orange",
    content: [
      "系统没有读取来源文件、创建任务、写入 Base/Drive 或创建原生 OA。",
      "请由试点维护人确认功能开关、用户权限和受控资源后再开启。",
    ].join("\n"),
  });
}

export function buildCouponThreeSourceClearedCard(input: {
  clearedCount: number;
}): FeishuCard {
  const cleared = input.clearedCount > 0;
  return card({
    title: cleared ? "当前三源提报已清空" : "当前已是清空状态",
    subtitle: "可以重新发起 OA 优惠券提报",
    template: "green",
    content: [
      cleared
        ? `已结束 ${input.clearedCount} 笔未完成的三源提报。`
        : "没有检测到未完成的三源提报。",
      "原始记录和文件仅保留用于审计，不会被下一次提报复用。",
      "请重新发送 `/OA优惠券提报`，并重新上传本次材料。",
    ].join("\n"),
  });
}

export function buildCouponThreeSourceIntakeCard(
  draft?: CouponThreeSourcePilotDraft,
): FeishuCard {
  const content = [
    "请直接发送原始 `.xlsx` 配券表、商品白名单，以及可选商品黑名单（可任意顺序）。",
    ...(draft ? ["", "**当前材料**", ...sourcesSummary(draft)] : []),
  ].join("\n");
  return card({
    title: "OA 优惠券提报",
    subtitle: "第 1 步：收集三源材料",
    template: "blue",
    ...(draft
      ? {
          elements: [
            { tag: "markdown", content },
            button(draft, {
              action: "coupon_three_source_recognition_start",
              text: "材料已上传完毕，开始统一识别",
            }),
            cancelButton(draft),
          ],
        }
      : { content }),
  });
}

export function buildCouponThreeSourceRoleCard(input: {
  draft: CouponThreeSourcePilotDraft;
  recognition: StoredWorkbookRecognition;
}): FeishuCard {
  return card({
    title: "确认材料角色",
    subtitle: "系统无法唯一判断刚上传的 Excel",
    template: "orange",
    elements: [
      {
        tag: "markdown",
        content: [
          `**文件：** ${input.recognition.source.fileName}`,
          "请选择该文件在本次三源提报中的角色。选择后会替换同角色材料并产生新 revision。",
        ].join("\n"),
      },
      ...input.recognition.roleCandidates.map((candidate) =>
        button(input.draft, {
          action: "coupon_three_source_role_confirm",
          text:
            candidate.role === "couponTable"
              ? "作为配券表"
              : candidate.role === "whitelist"
                ? "作为商品白名单"
                : "作为商品黑名单",
          extra: { role: candidate.role },
        }),
      ),
      cancelButton(input.draft),
    ],
  });
}

export function buildCouponThreeSourceNoBlacklistCard(
  draft: CouponThreeSourcePilotDraft,
): FeishuCard {
  return card({
    title: "请确认是否有黑名单",
    subtitle: "第 2 步：不能把未上传误当作无黑名单",
    template: "orange",
    elements: [
      {
        tag: "markdown",
        content: [
          ...sourcesSummary(draft),
          "",
          "若本次确实没有商品黑名单，请由创建人明确确认。若有黑名单，请直接发送原始 `.xlsx` 文件。",
        ].join("\n"),
      },
      button(draft, {
        action: "coupon_three_source_no_blacklist_confirm",
        text: "确认本次无黑名单",
        type: "danger",
      }),
      cancelButton(draft),
    ],
  });
}

export function buildCouponThreeSourceRecognizingCard(
  draft: CouponThreeSourcePilotDraft,
): FeishuCard {
  const pending = Object.entries(draft.recognitions)
    .filter(([, recognition]) => recognition?.ai?.status === "pending")
    .map(([role, recognition]) => `- ${role}：${recognition?.source.fileName}`);
  return card({
    title: "AI 识别中",
    subtitle: "候选识别完成后再进行第二轮确认",
    template: "blue",
    elements: [
      {
        tag: "markdown",
        content: [
          "DeepSeek 当前只识别候选，不会生成表格或创建 OA。",
          ...pending,
          "请等待最新卡片；失败时系统会回退到人工补充。",
        ].join("\n"),
      },
      cancelButton(draft),
    ],
  });
}

function combinedCouponCandidates(
  recognition: StoredWorkbookRecognition | undefined,
): CouponCandidate[] {
  if (!recognition) return [];
  const result = [...(recognition.couponCandidates ?? [])];
  for (const candidate of recognition.ai?.result?.couponCandidates ?? []) {
    if (
      !result.some(
        (item) =>
          item.sheetName === candidate.sheetName && item.row === candidate.row,
      )
    ) {
      result.push(candidate);
    }
  }
  return result;
}

const ownerSupplementKeys = [
  "activityName",
  "activityBackground",
  "businessMode",
  "applicantName",
  "activityStartAt",
  "activityEndAt",
  "channels",
  "thresholdYuan",
  "discountAmountYuan",
  "totalQuantity",
  "grantQuantityPerClaim",
  "dailyClaimLimit",
  "claimWindow",
  "useWindow",
  "expectedClaimRate",
  "expectedUseRate",
  "platformBearingRatio",
  "estimatedGmvYuan",
  "claimRule",
  "allowGift",
  "promotionMode",
  "overDeduction",
] as const satisfies readonly CouponFieldKey[];

const optionalOwnerSupplementKeys = [
  "publicPromotionChannels",
  "overDeductionReason",
] as const satisfies readonly CouponFieldKey[];

const fieldLabels: Partial<Record<CouponFieldKey, string>> = {
  activityName: "活动名称",
  activityBackground: "活动背景",
  businessMode: "业务模式",
  applicantName: "申请人",
  activityStartAt: "活动开始日期",
  activityEndAt: "活动结束日期",
  channels: "用券渠道",
  thresholdYuan: "使用门槛（元）",
  discountAmountYuan: "优惠金额（元）",
  totalQuantity: "申请总数量",
  grantQuantityPerClaim: "单次发放数量",
  dailyClaimLimit: "每日领取上限",
  claimWindow: "领取时间",
  useWindow: "使用时间",
  expectedClaimRate: "预计领取率",
  expectedUseRate: "预计使用率",
  platformBearingRatio: "平台承担比例",
  estimatedGmvYuan: "预计成交额（元）",
  claimRule: "领取规则",
  allowGift: "是否允许转赠",
  promotionMode: "推广方式",
  publicPromotionChannels: "公开推广渠道",
  overDeduction: "是否超扣",
  overDeductionReason: "超扣原因",
};

function ownerDefaultValue(
  draft: CouponThreeSourcePilotDraft,
  key: CouponFieldKey,
): string | undefined {
  const ownerValue = draft.selections.ownerFieldValues?.[key];
  if (ownerValue !== undefined) {
    return Array.isArray(ownerValue)
      ? ownerValue.join("、")
      : String(ownerValue);
  }
  const copy =
    draft.recognitions.couponTable?.ai?.result?.activityCopyCandidates?.find(
      (candidate) => candidate.key === key,
    );
  if (copy?.value) return copy.value;
  return draft.recognitions.couponTable?.couponFieldCandidates[key]
    ?.flatMap((candidate) => candidate.sampleValues)
    .find((value) => value.trim());
}

function missingOwnerFields(
  recognition: StoredWorkbookRecognition | undefined,
): CouponFieldKey[] {
  if (!recognition) return [...ownerSupplementKeys];
  return ownerSupplementKeys.filter(
    (key) =>
      !recognition.couponFieldCandidates[key]?.some((candidate) =>
        candidate.sampleValues.some((value) => value.trim()),
      ) &&
      !recognition.ai?.result?.fieldCandidates.some(
        (candidate) => candidate.key === key,
      ),
  );
}

export function buildCouponThreeSourceMappingCard(
  draft: CouponThreeSourcePilotDraft,
): FeishuCard {
  const coupon = draft.recognitions.couponTable;
  const whitelist = draft.recognitions.whitelist;
  const blacklist = draft.recognitions.blacklist;
  const coupons = combinedCouponCandidates(coupon);
  const hasUnknownCoupon = coupons.some(
    (candidate) => candidate.couponType === "unknown",
  );
  const onlyUnsupported =
    coupons.length > 0 &&
    coupons.every((candidate) => candidate.couponType === "unsupported");
  const elements: Array<Record<string, unknown>> = [
    {
      tag: "markdown",
      content: [
        "第二轮：确认券模板、活动点位和缺失字段。",
        "可使用手机或电脑自带语音输入，把转写文字放入补充说明后先识别并回填；提交前仍可逐项修改。",
        ...(onlyUnsupported
          ? [
              "当前只识别到 P0 不支持的券型，请结束并改用受支持的常规满减券材料。",
            ]
          : []),
      ].join("\n"),
    },
    {
      tag: "form",
      name: "coupon_three_source_supplement_submit",
      vertical_spacing: "12px",
      elements: [
        {
          tag: "input",
          name: "supplementText",
          label: plainText("语音或文字补充说明"),
          input_type: "multiline_text",
          rows: 4,
          required: true,
          width: "fill",
          ...(draft.supplementRecognition?.text
            ? { default_value: draft.supplementRecognition.text }
            : {}),
        },
        {
          tag: "button",
          name: `coupon_three_source_supplement_recognition_start:${draft.recordId}:${draft.task.revision}`,
          text: plainText("识别补充说明并回填字段"),
          type: "default",
          width: "fill",
          form_action_type: "submit",
        },
      ],
    },
    {
      tag: "form",
      name: "coupon_three_source_mapping_submit",
      vertical_spacing: "12px",
      elements: [
        ...(coupons.length === 0 || hasUnknownCoupon
          ? [
              {
                tag: "select_static",
                name: "couponType",
                placeholder: plainText("请确认优惠券类型"),
                required: true,
                width: "fill",
                options: [
                  {
                    text: plainText("常规满减券"),
                    value: "regular_full_reduction",
                  },
                ],
              },
            ]
          : []),
        {
          tag: "input",
          name: "activityPointPercent",
          label: plainText("OA 活动点位（%）："),
          input_type: "text",
          required: true,
          width: "fill",
        },
        {
          tag: "select_static",
          name: "owner_businessMode",
          placeholder: plainText("请选择业务模式"),
          required: true,
          width: "fill",
          options: [
            { text: plainText("严选"), value: "严选" },
            { text: plainText("寄卖"), value: "寄卖" },
            { text: plainText("POP"), value: "pop" },
          ],
        },
        {
          tag: "input",
          name: "owner_activityName",
          label: plainText("活动名称"),
          input_type: "text",
          ...(ownerDefaultValue(draft, "activityName")
            ? { default_value: ownerDefaultValue(draft, "activityName") }
            : {}),
          required: true,
          width: "fill",
        },
        {
          tag: "input",
          name: "owner_activityBackground",
          label: plainText("活动背景"),
          input_type: "multiline_text",
          rows: 3,
          ...(ownerDefaultValue(draft, "activityBackground")
            ? {
                default_value: ownerDefaultValue(draft, "activityBackground"),
              }
            : {}),
          required: true,
          width: "fill",
        },
        ...(draft.task.blacklistStatus === "absent_pending_confirmation"
          ? [
              {
                tag: "select_static",
                name: "blacklistDecision",
                placeholder: plainText("请确认本次是否无商品黑名单"),
                required: true,
                width: "fill",
                options: [
                  {
                    text: plainText("确认本次无商品黑名单"),
                    value: "absent_confirmed",
                  },
                ],
              },
            ]
          : []),
        ...Object.entries(coupon?.couponFieldCandidates ?? {})
          .filter(([, candidates]) => candidates.length > 1)
          .map(([key, candidates]) =>
            candidateSelect({
              name: `coupon_${key}`,
              label: `配券表${fieldLabels[key as CouponFieldKey] ?? "字段"}`,
              candidates,
              required: true,
            }),
          ),
        ...missingOwnerFields(coupon)
          .filter(
            (key) =>
              !["businessMode", "activityName", "activityBackground"].includes(
                key,
              ),
          )
          .map((key) => ({
            ...(key === "businessMode"
              ? {
                  tag: "select_static",
                  name: "owner_businessMode",
                  placeholder: plainText("请选择业务模式"),
                  required: true,
                  width: "fill",
                  options: [
                    { text: plainText("严选"), value: "严选" },
                    { text: plainText("寄卖"), value: "寄卖" },
                    { text: plainText("POP"), value: "pop" },
                  ],
                }
              : {
                  tag: "input",
                  name: `owner_${key}`,
                  label: plainText(fieldLabels[key] ?? "补充信息"),
                  input_type:
                    key === "activityBackground" ? "multiline_text" : "text",
                  ...(key === "activityBackground" ? { rows: 3 } : {}),
                  ...(ownerDefaultValue(draft, key)
                    ? { default_value: ownerDefaultValue(draft, key) }
                    : {}),
                  required: true,
                  width: "fill",
                }),
          })),
        ...optionalOwnerSupplementKeys
          .filter(
            (key) =>
              !coupon?.couponFieldCandidates[key]?.some((candidate) =>
                candidate.sampleValues.some((value) => value.trim()),
              ) &&
              !coupon?.ai?.result?.fieldCandidates.some(
                (candidate) => candidate.key === key,
              ),
          )
          .map((key) => ({
            tag: "input",
            name: `owner_${key}`,
            label: plainText(fieldLabels[key] ?? "按业务条件补充"),
            input_type: "text",
            ...(ownerDefaultValue(draft, key)
              ? { default_value: ownerDefaultValue(draft, key) }
              : {}),
            required: false,
            width: "fill",
          })),
        ...listCandidateElements("whitelist", whitelist),
        ...listCandidateElements("blacklist", blacklist),
        ...(!onlyUnsupported
          ? [
              {
                tag: "button",
                name: `coupon_three_source_mapping_confirm:${draft.recordId}:${draft.task.revision}`,
                text: plainText("确认来源并生成标准附件"),
                type: "primary_filled",
                width: "fill",
                form_action_type: "submit",
              },
            ]
          : []),
      ],
    },
    cancelButton(draft),
  ];
  return card({
    title: "确认来源映射",
    subtitle: "第二轮：异常、缺失字段与来源确认",
    template: "orange",
    elements,
  });
}

function listCandidateElements(
  prefix: "whitelist" | "blacklist",
  recognition: StoredWorkbookRecognition | undefined,
): Array<Record<string, unknown>> {
  if (!recognition) return [];
  const identifier = recognition.listCandidates.filter(
    (candidate) => candidate.kind === "identifier",
  );
  return [
    ...(identifier.length > 1
      ? [
          candidateSelect({
            name: `${prefix}_identifierCandidateId`,
            label: `${prefix === "whitelist" ? "白名单" : "黑名单"} SKU 列`,
            candidates: identifier,
            required: true,
          }),
        ]
      : []),
    ...(identifier.length > 1
      ? [
          {
            tag: "select_static",
            name: `${prefix}_selectedSheetName`,
            placeholder: plainText(
              `请选择${prefix === "whitelist" ? "白名单" : "黑名单"} Sheet`,
            ),
            required: true,
            width: "fill",
            options: [
              ...new Set(identifier.map((candidate) => candidate.sheetName)),
            ].map((sheetName) => ({
              text: plainText(sheetName),
              value: sheetName,
            })),
          },
        ]
      : []),
  ];
}

export function buildCouponThreeSourceOverlapCard(input: {
  draft: CouponThreeSourcePilotDraft;
  count: number;
}): FeishuCard {
  return card({
    title: "白黑名单存在重叠 SKU",
    subtitle: "第 4 步：必须明确冲突处理规则",
    template: "orange",
    elements: [
      {
        tag: "markdown",
        content: `检测到 **${input.count}** 个 SKU 同时存在于白名单和黑名单。选择规则后将重新确认并生成标准附件。`,
      },
      button(input.draft, {
        action: "coupon_three_source_overlap_decide",
        text: "白名单优先",
        extra: { decision: "whitelist_wins" },
      }),
      button(input.draft, {
        action: "coupon_three_source_overlap_decide",
        text: "黑名单优先",
        extra: { decision: "blacklist_wins" },
      }),
      button(input.draft, {
        action: "coupon_three_source_overlap_decide",
        text: "返回替换源文件",
        type: "danger",
        extra: { decision: "source_replacement_required" },
      }),
      cancelButton(input.draft),
    ],
  });
}

export function buildCouponThreeSourcePreviewCard(
  draft: CouponThreeSourcePilotDraft,
): FeishuCard {
  const prefill = draft.oaPrefill;
  return card({
    title: "标准附件已生成，待创建 OA 测试稿",
    subtitle: "第 5 步：确认当前 revision",
    template: "green",
    elements: [
      {
        tag: "markdown",
        content: [
          `**版本：** revision ${draft.task.revision}`,
          `**业务模式：** ${prefill?.values.businessMode ?? "—"}`,
          `**活动名称：** ${prefill?.values.activityName ?? "—"}`,
          `**活动点位：** ${prefill?.values.activityPointPercent ?? "—"}%`,
          "**冻结标准附件：**",
          ...draft.artifacts.map(
            (artifact) =>
              `- ${artifact.fileName}（${artifact.sha256.slice(0, 12)}…）`,
          ),
          "",
          "严选首期不生成配券表截图。确认后只会创建既有 OA 测试稿；不会自动提交正式 OA。",
        ].join("\n"),
      },
      button(draft, {
        action: "coupon_three_source_final_confirm",
        text: "确认并创建 OA 测试稿",
      }),
      cancelButton(draft),
    ],
  });
}

export function buildCouponThreeSourceCompletedCard(
  draft: CouponThreeSourcePilotDraft,
): FeishuCard {
  return card({
    title: "OA 测试稿已创建",
    subtitle: "请使用既有明确“发送”动作提交正式 OA",
    template: "green",
    content: [
      `三源提报 ${draft.pilotId.slice(0, 12)} 的 revision ${draft.task.revision} 已冻结并生成 OA 测试稿。`,
      "当前操作没有创建正式 OA；只有既有 OA 草稿中的显式“确认提交正式 OA”才会进入原生审批创建与回读 Gate。",
    ].join("\n"),
  });
}

export function buildCouponThreeSourceErrorCard(input: {
  message: string;
}): FeishuCard {
  return card({
    title: "OA 优惠券三源提报未完成",
    subtitle: "请修正材料或使用最新卡片重试",
    template: "red",
    content: `**原因：** ${input.message}`,
  });
}
