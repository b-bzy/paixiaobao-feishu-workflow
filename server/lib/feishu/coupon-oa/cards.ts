import type { FeishuCard } from "../expense-poc";
import type { CouponOaDraftValues } from "./approval-schema";
import type { CouponOaAttachment } from "./draft-store";

const plainText = (content: string) => ({ tag: "plain_text", content });

function baseCard(
  title: string,
  subtitle: string,
  template: string,
  status: string,
  elements: Array<Record<string, unknown>>,
): FeishuCard {
  return {
    schema: "2.0",
    config: { update_multi: true, width_mode: "default" },
    header: {
      title: plainText(title),
      subtitle: plainText(subtitle),
      template,
      icon: { tag: "standard_icon", token: "approval_colorful" },
      text_tag_list: [
        {
          tag: "text_tag",
          text: plainText(status),
          color: template === "red" ? "red" : "blue",
        },
      ],
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 20px 12px",
      vertical_spacing: "12px",
      elements,
    },
  };
}

export function buildCouponOaEntryCard(initiateUrl: string): FeishuCard {
  return baseCard(
    "优惠券 OA 审批表",
    "请在飞书原生 OA 中填写并提交",
    "blue",
    "待发起",
    [
      {
        tag: "markdown",
        content:
          "点击下方按钮打开优惠券 OA 审批表。表单权限由飞书 OA 按你的账号校验；机器人不会代填、代提交或代为审批。",
      },
      {
        tag: "button",
        text: plainText("打开优惠券 OA 审批表"),
        type: "primary_filled",
        width: "fill",
        behaviors: [
          {
            type: "open_url",
            default_url: initiateUrl,
          },
        ],
      },
    ],
  );
}

export function buildCouponOaUnavailableCard(): FeishuCard {
  return baseCard(
    "优惠券 OA 审批表暂不可用",
    "请联系流程管理员完成配置",
    "red",
    "暂不可用",
    [
      {
        tag: "markdown",
        content:
          "优惠券 OA 发起入口尚未完成配置。请联系流程管理员确认表单地址和你的 OA 使用权限。",
      },
    ],
  );
}

const formInput = (name: string, label: string, multiline = false) => ({
  tag: "input",
  name,
  label: plainText(`${label}：`),
  input_type: multiline ? "multiline_text" : "text",
  ...(multiline ? { rows: 3 } : {}),
  required: true,
  width: "fill",
});

const formSelect = (name: string, label: string, values: string[]) => ({
  tag: "select_static",
  name,
  placeholder: plainText(`请选择${label}`),
  required: true,
  width: "fill",
  options: values.map((value) => ({ text: plainText(value), value })),
});

export function buildCouponOaDraftFormCard(
  input: { draftDemo?: boolean } = {},
): FeishuCard {
  const draftDemo = input.draftDemo ?? false;
  return baseCard(
    draftDemo ? "优惠券 OA 本地草稿填报" : "优惠券 OA 智能填报",
    draftDemo
      ? "填写固定字段，系统会自动写入 Base 草稿表"
      : "第 1 步：填写申请信息，系统会保存业务草稿",
    "blue",
    "填写中",
    [
      {
        tag: "markdown",
        content: draftDemo
          ? "本地草稿测试只验证固定字段到 Base 的自动填报；不会接收附件、调用审批接口或创建 OA。"
          : "本页面不会创建 OA。提交后请按提示发送测算图片、配券信息表和商品白名单；三份材料齐全后才能进入人工确认。",
      },
      {
        tag: "form",
        name: "coupon_oa_draft_form",
        vertical_spacing: "12px",
        elements: [
          formSelect("businessMode", "业务模式", ["严选", "寄卖", "pop"]),
          formInput("activityName", "活动名称"),
          formInput("activityBackground", "活动背景", true),
          formSelect("overDeduction", "是否超扣点", ["是", "否"]),
          formInput("overDeductionReason", "超扣点原因（若否请填写无）", true),
          formInput("estimatedGmvYuan", "预估 GMV（元）"),
          formInput("estimatedCostYuan", "预估费用（元）"),
          formInput(
            "channels",
            "配置渠道（用；分隔，可填京东渠道；严选APP及小程序）",
          ),
          formInput("activityStartAt", "活动开始日期（YYYY-MM-DD）"),
          formInput("activityEndAt", "活动结束日期（YYYY-MM-DD）"),
          {
            tag: "button",
            text: plainText(draftDemo ? "保存本地草稿" : "保存草稿并上传材料"),
            type: "primary_filled",
            width: "fill",
            form_action_type: "submit",
            name: "coupon_oa_draft_save",
          },
        ],
      },
    ],
  );
}

export function buildCouponOaAttachmentRequestCard(input: {
  draftId: string;
  missing: string[];
}): FeishuCard {
  return baseCard(
    "优惠券 OA 智能填报",
    `草稿 ${input.draftId.slice(0, 12)} 已保存`,
    "blue",
    "待补材料",
    [
      {
        tag: "markdown",
        content: [
          "请将以下文件直接发送给机器人（一次一个文件）：",
          ...input.missing.map((item) => `- ${item}`),
          "文件名需分别包含：`测算`（图片）、`配券`（Excel）、`白名单`（Excel）。",
        ].join("\n"),
      },
    ],
  );
}

export function buildCouponOaDraftSavedCard(input: {
  draftId: string;
}): FeishuCard {
  return baseCard(
    "优惠券 OA 本地草稿已保存",
    "已自动写入 Base 草稿表",
    "green",
    "已保存",
    [
      {
        tag: "markdown",
        content: [
          `草稿 **${input.draftId.slice(0, 12)}** 已保存到「优惠券提单草稿」。`,
          "本地测试到此结束：不会接收附件、调用审批接口或创建 OA。",
        ].join("\n"),
      },
    ],
  );
}

export function buildCouponOaDraftDemoUnavailableCard(): FeishuCard {
  return baseCard(
    "优惠券 OA 本地草稿测试",
    "当前模式仅验证固定字段自动写入 Base",
    "blue",
    "仅草稿",
    [
      {
        tag: "markdown",
        content:
          "附件处理、人工确认和正式 OA 提交均已在本地草稿测试中禁用，不会调用审批接口。",
      },
    ],
  );
}

export function buildCouponOaDraftErrorCard(input: {
  message: string;
}): FeishuCard {
  return baseCard(
    "优惠券 OA 本地草稿未保存",
    "请修正字段后重新提交",
    "red",
    "校验失败",
    [
      {
        tag: "markdown",
        content: `**原因：** ${input.message}`,
      },
    ],
  );
}

export function buildCouponOaActiveWorkflowCard(input: {
  draftId: string;
  draftRecordId: string;
}): FeishuCard {
  return baseCard(
    "已有未完成的优惠券 OA 流程",
    "请继续当前流程，或结束后再启动 Excel 试点",
    "orange",
    "进行中",
    [
      {
        tag: "markdown",
        content: `当前 OA 草稿 **${input.draftId.slice(0, 12)}** 尚未完成。为避免文件归属错误，不能同时启动 Excel 试点。`,
      },
      {
        tag: "button",
        text: plainText("结束当前 OA 草稿"),
        type: "danger",
        width: "fill",
        behaviors: [
          {
            type: "callback",
            value: {
              action: "coupon_oa_cancel",
              draftRecordId: input.draftRecordId,
            },
          },
        ],
      },
    ],
  );
}

export function buildCouponOaWorkflowExpiredCard(input: {
  draftId: string;
}): FeishuCard {
  return baseCard(
    "优惠券 OA 流程已结束",
    "超过 10 分钟未继续操作",
    "orange",
    "已结束",
    [
      {
        tag: "markdown",
        content: `草稿 **${input.draftId.slice(0, 12)}** 已因长时间未继续操作而结束。本次未创建或提交正式 OA；如需继续，请重新发送 \`OA优惠券填报\`。`,
      },
    ],
  );
}

export function buildCouponOaWorkflowCanceledCard(input: {
  draftId: string;
}): FeishuCard {
  return baseCard(
    "优惠券 OA 草稿已结束",
    "可重新发起其他优惠券流程",
    "green",
    "已结束",
    [
      {
        tag: "markdown",
        content: `草稿 **${input.draftId.slice(0, 12)}** 已结束，未创建或提交正式 OA。`,
      },
    ],
  );
}

export function buildCouponOaPreviewCard(input: {
  draftRecordId: string;
  values: CouponOaDraftValues;
  attachments: CouponOaAttachment[];
  missing: string[];
}): FeishuCard {
  const ready = input.missing.length === 0;
  const values = input.values;
  const gmv = values.estimatedGmvYuan;
  const cost = values.estimatedCostYuan;
  const attachmentNames = input.attachments.map(
    (attachment) => `- ${attachment.fileName}`,
  );
  return baseCard(
    "优惠券 OA 预填确认",
    ready ? "第 2 步：请核对后确认" : "材料未齐全",
    ready ? "orange" : "red",
    ready ? "待确认" : "待补充",
    [
      {
        tag: "markdown",
        content: [
          "**申请基本信息**",
          `**申请类型：** ${values.applicationType}`,
          `**业务模式：** ${values.businessMode ?? "—"}`,
          `**活动名称：** ${values.activityName ?? "未填写活动名称"}`,
          `**活动背景：** ${values.activityBackground ?? "—"}`,
          `**活动时间：** ${values.activityStartAt ?? "—"} 至 ${values.activityEndAt ?? "—"}`,
        ].join("\n"),
      },
      {
        tag: "markdown",
        content: [
          "**费用与配置**",
          `**是否超扣点：** ${values.overDeduction ?? "—"}`,
          ...(values.overDeduction === "是"
            ? [`**超扣点原因：** ${values.overDeductionReason ?? "—"}`]
            : []),
          `**预估 GMV：** ${gmv === undefined ? "—" : `¥${gmv}`}`,
          `**预估费用：** ${cost === undefined ? "—" : `¥${cost}`}`,
          `**活动点位：** ${values.activityPointPercent === undefined ? "—" : `${values.activityPointPercent}%`}`,
          `**平台承担比例：** ${values.platformBearingPercent === undefined ? "—" : `${values.platformBearingPercent}%`}`,
          `**预估 ROI：** ${gmv && cost ? (gmv / cost).toFixed(2) : "由飞书公式计算"}`,
          `**配置渠道：** ${values.channels?.join("；") || "—"}`,
        ].join("\n"),
      },
      {
        tag: "markdown",
        content: [
          "**已上传材料**",
          ...(attachmentNames.length ? attachmentNames : ["- 暂无"]),
        ].join("\n"),
      },
      {
        tag: "markdown",
        content: [
          ready
            ? "确认后系统会在提交前重新读取正式审批定义；定义变化会阻止创建。创建后如回读无法确认，将保留正式 OA 并标记为人工复核，不会自动重试。"
            : `**仍缺少：** ${input.missing.join("、")}`,
        ].join("\n"),
      },
      ...(ready
        ? [
            {
              tag: "button",
              text: plainText("确认进入提交页"),
              type: "primary_filled",
              width: "fill",
              behaviors: [
                {
                  type: "callback",
                  value: {
                    action: "coupon_oa_confirm",
                    draftRecordId: input.draftRecordId,
                  },
                },
              ],
            },
          ]
        : []),
    ],
  );
}

export function buildCouponOaSubmitCard(input: {
  draftRecordId: string;
  values: CouponOaDraftValues;
  attachments: CouponOaAttachment[];
}): FeishuCard {
  const preview = buildCouponOaPreviewCard({
    draftRecordId: input.draftRecordId,
    values: input.values,
    attachments: input.attachments,
    missing: [],
  });
  const reviewElements = preview.body.elements.slice(0, -1);
  return baseCard(
    "确认提交正式优惠券 OA",
    "第 3 步：此操作会创建真实 OA 并进入原生审批流",
    "orange",
    "待提交",
    [
      ...reviewElements,
      {
        tag: "markdown",
        content:
          "以上是即将提交的完整内容。点击下方按钮后，飞书会向原流程的审批人和抄送人发送通知。",
      },
      {
        tag: "button",
        text: plainText("确认提交正式 OA"),
        type: "danger",
        width: "fill",
        behaviors: [
          {
            type: "callback",
            value: {
              action: "coupon_oa_submit",
              draftRecordId: input.draftRecordId,
            },
          },
        ],
      },
    ],
  );
}

export function buildCouponOaSubmissionResultCard(input: {
  instanceLink?: string;
  verificationIssues: string[];
}): FeishuCard {
  const success = input.verificationIssues.length === 0;
  return baseCard(
    success ? "优惠券 OA 已创建并核对" : "优惠券 OA 已创建但需立即复核",
    success ? "正式审批已按原生流程发起" : "字段回读存在差异",
    success ? "green" : "red",
    success ? "已提交" : "需复核",
    [
      {
        tag: "markdown",
        content: success
          ? "系统已读取创建后的正式 OA，提交字段与确认快照一致。"
          : `发现差异：\n${input.verificationIssues.map((item) => `- ${item}`).join("\n")}`,
      },
      ...(input.instanceLink
        ? [
            {
              tag: "button",
              text: plainText("打开正式 OA"),
              type: "primary_filled",
              width: "fill",
              behaviors: [
                { type: "open_url", default_url: input.instanceLink },
              ],
            },
          ]
        : []),
    ],
  );
}

export function buildCouponOaSubmissionFailureCard(input: {
  message: string;
}): FeishuCard {
  return baseCard(
    "优惠券 OA 提交失败",
    "正式 OA 未创建，请修正后重新提交",
    "red",
    "未提交",
    [
      {
        tag: "markdown",
        content: [
          `**失败原因：** ${input.message}`,
          "本次未创建正式审批，不会出现在“审批 → 已发起”中。请重新发送 `OA优惠券填报`，修正信息并重新上传附件。",
        ].join("\n"),
      },
    ],
  );
}
