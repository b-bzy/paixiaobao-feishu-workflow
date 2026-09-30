import type { FeishuCard } from "../expense-poc";
import type { CouponExcelPilotDraft } from "./excel-pilot-store";

const plainText = (content: string) => ({ tag: "plain_text", content });

function card(
  title: string,
  subtitle: string,
  template: string,
  elements: Array<Record<string, unknown>>,
): FeishuCard {
  return {
    schema: "2.0",
    config: { update_multi: true, width_mode: "default" },
    header: {
      title: plainText(title),
      subtitle: plainText(subtitle),
      template,
      icon: { tag: "standard_icon", token: "excel_colorful" },
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 20px 12px",
      vertical_spacing: "12px",
      elements,
    },
  };
}

function actionValue(draft: CouponExcelPilotDraft, action: string) {
  return {
    action,
    pilotRecordId: draft.recordId,
    revision: draft.revision,
  };
}

export function buildCouponExcelPilotIntakeCard(): FeishuCard {
  return card(
    "优惠券 Excel 试点",
    "第 1 步：一次性填写常规满减券字段",
    "blue",
    [
      {
        tag: "markdown",
        content: [
          "本试点仅支持 **常规满减券 + SKU 白名单**。请复制下面清单并尽量一次填写；我只会追问缺少或有歧义的字段。",
          "```text",
          "活动名称：",
          "活动背景：",
          "业务模式：寄卖 / pop / 严选",
          "申请人：",
          "活动开始日期：YYYY-MM-DD",
          "活动结束日期：YYYY-MM-DD",
          "用券渠道：京东渠道 / 严选APP及小程序 / 两者",
          "满减门槛（元）：",
          "优惠面额（元）：",
          "总申请数量：",
          "单次到账张数：",
          "每日领取次数：",
          "可领时间：YYYY-MM-DD HH:mm 至 YYYY-MM-DD HH:mm",
          "可用时间：YYYY-MM-DD HH:mm 至 YYYY-MM-DD HH:mm",
          "预计领用率：",
          "预计使用率：",
          "平台承担比例：",
          "预计引入GMV（元）：",
          "用户领券规则：活动期间仅可领一次 / 活动期间每天可领一次",
          "优惠券赠送：允许 / 不允许",
          "推广途径：公开自动推广 / 非公开推广",
          "公开推广渠道：",
          "是否超扣点：是 / 否",
          "超扣点原因：",
          "```",
          "字段确认后，再上传手头的白名单 Excel。源文件只用于映射，不会上传到正式 OA。",
        ].join("\n"),
      },
    ],
  );
}

export function buildCouponExcelPilotInputCard(
  draft: CouponExcelPilotDraft,
): FeishuCard {
  const candidate = draft.candidateInput ?? draft.input ?? {};
  const entries = Object.entries(candidate).map(
    ([key, value]) =>
      `- **${key}：** ${Array.isArray(value) ? value.join("；") : String(value)}`,
  );
  const issues = draft.validationIssues.map((issue) => `- ${issue}`);
  const ready = draft.status === "AwaitingInputConfirmation";
  return card(
    ready ? "优惠券字段待确认" : "请补充优惠券字段",
    ready ? "第 2 步：确认提取结果" : "系统尚不能生成 Excel",
    ready ? "orange" : "red",
    [
      {
        tag: "markdown",
        content: [
          "**已提取字段**",
          ...(entries.length ? entries : ["- 暂未识别到字段"]),
          ...(issues.length ? ["", "**待补充/修正**", ...issues] : []),
        ].join("\n"),
      },
      ...(ready
        ? [
            {
              tag: "button",
              text: plainText("确认字段，继续上传白名单"),
              type: "primary_filled",
              width: "fill",
              behaviors: [
                {
                  type: "callback",
                  value: actionValue(draft, "coupon_excel_pilot_input_confirm"),
                },
              ],
            },
          ]
        : []),
    ],
  );
}

export function buildCouponExcelPilotWhitelistUploadCard(): FeishuCard {
  return card(
    "字段已确认，请上传白名单",
    "第 3 步：发送 .xlsx 源白名单",
    "blue",
    [
      {
        tag: "markdown",
        content: [
          "优惠券字段已冻结为当前版本。请直接发送手头的 `.xlsx` 白名单文件。",
          "系统会先让你选择 Sheet 与 SKU 所在列，再生成两份 Excel。",
        ].join("\n"),
      },
    ],
  );
}

export function buildCouponExcelPilotWhitelistCorrectionCard(
  draft: CouponExcelPilotDraft,
): FeishuCard {
  const issues = draft.validationIssues.map((issue) => `- ${issue}`);
  return card("请修正白名单文件", "重新发送 .xlsx 源白名单", "orange", [
    {
      tag: "markdown",
      content: [
        "当前白名单无法生成，请修正后重新发送 `.xlsx` 文件。",
        ...(issues.length ? ["", "**待修正问题**", ...issues] : []),
      ].join("\n"),
    },
  ]);
}

export function buildCouponExcelPilotMappingCard(
  draft: CouponExcelPilotDraft,
): FeishuCard {
  const candidates = draft.sourceWhitelist?.candidates ?? [];
  return card(
    "选择白名单 SKU 列",
    "第 3 步：确认源 Sheet 与 SKU 列",
    "orange",
    [
      {
        tag: "markdown",
        content:
          "请从上传的源白名单中选择一列 SKU。首期只会生成一列 `SKUID` 的标准白名单。",
      },
      {
        tag: "form",
        name: "coupon_excel_pilot_mapping_submit",
        elements: [
          {
            tag: "select_static",
            name: "mapping",
            required: true,
            placeholder: plainText("请选择来源 Sheet 和 SKU 列"),
            options: candidates.map((candidate) => ({
              text: plainText(
                `${candidate.sheetName} / ${candidate.column}（${candidate.header}，${candidate.nonEmptyCount} 条）`,
              ),
              value: JSON.stringify({
                sheetName: candidate.sheetName,
                column: candidate.column,
                header: candidate.header,
              }),
            })),
          },
          {
            tag: "button",
            name: `coupon_excel_pilot_mapping_confirm:${draft.recordId}:${draft.revision}`,
            text: plainText("确认映射并生成 Excel"),
            type: "primary_filled",
            width: "fill",
            form_action_type: "submit",
          },
        ],
      },
    ],
  );
}

export function buildCouponExcelPilotGeneratingCard(): FeishuCard {
  return card("正在生成 Excel", "正在复制模板、写入字段并校验结果", "blue", [
    {
      tag: "markdown",
      content: "请稍候；生成的文件会先关联到系统草稿，不会上传或提交正式 OA。",
    },
  ]);
}

export function buildCouponExcelPilotOutputCard(
  draft: CouponExcelPilotDraft,
): FeishuCard {
  return card(
    "Excel 已生成，待确认",
    "第 4 步：核对系统草稿中的两份附件",
    "green",
    [
      {
        tag: "markdown",
        content: [
          "**已生成文件**",
          ...draft.artifacts.map(
            (artifact) =>
              `- ${artifact.fileName}（${artifact.bytes} bytes，${artifact.sha256.slice(0, 12)}…）`,
          ),
          "",
          "请在系统草稿记录中查看附件。确认后，系统会自动填写 OA 草稿并附上这两份冻结文件；不会提交正式 OA。",
        ].join("\n"),
      },
      {
        tag: "button",
        text: plainText("确认生成结果"),
        type: "primary_filled",
        width: "fill",
        behaviors: [
          {
            type: "callback",
            value: actionValue(draft, "coupon_excel_pilot_output_confirm"),
          },
        ],
      },
    ],
  );
}

export function buildCouponExcelPilotOaHandoffRetryCard(
  draft: CouponExcelPilotDraft,
): FeishuCard {
  return card(
    "自动填写 OA 未完成",
    "已生成的 Excel 未改变，可安全重试",
    "orange",
    [
      {
        tag: "markdown",
        content: [
          "两份 Excel 已冻结，但尚未创建系统 OA 草稿。",
          `**原因：** ${draft.failureReason ?? "未知错误"}`,
          "重试只会继续当前版本；不会自动提交正式 OA。",
        ].join("\n"),
      },
      {
        tag: "button",
        text: plainText("重试自动填写 OA 草稿"),
        type: "primary_filled",
        width: "fill",
        behaviors: [
          {
            type: "callback",
            value: actionValue(draft, "coupon_excel_pilot_output_confirm"),
          },
        ],
      },
    ],
  );
}

export function buildCouponExcelPilotOutputConfirmedCard(
  draft: CouponExcelPilotDraft,
): FeishuCard {
  return card("OA 草稿已自动填写", "两份 Excel 已作为 OA 附件冻结", "green", [
    {
      tag: "markdown",
      content: `草稿 ${draft.pilotId} 已创建系统 OA 草稿。请按提示补充材料并人工确认；系统不会自动提交正式 OA。`,
    },
  ]);
}

export function buildCouponExcelPilotErrorCard(input: {
  title?: string;
  message: string;
}): FeishuCard {
  return card(input.title ?? "优惠券 Excel 试点未完成", "请修正后重试", "red", [
    { tag: "markdown", content: `**原因：** ${input.message}` },
  ]);
}

export function buildCouponExcelPilotActiveWorkflowCard(
  draft: CouponExcelPilotDraft,
): FeishuCard {
  return card(
    "已有未完成的优惠券 Excel 试点",
    "请继续当前流程，或结束后再填写 OA 草稿",
    "orange",
    [
      {
        tag: "markdown",
        content: `当前 Excel 试点 **${draft.pilotId.slice(0, 12)}** 尚未完成。为避免文件归属错误，不能同时启动 OA 填报。`,
      },
      {
        tag: "button",
        text: plainText("结束当前 Excel 试点"),
        type: "danger",
        width: "fill",
        behaviors: [
          {
            type: "callback",
            value: actionValue(draft, "coupon_excel_pilot_cancel"),
          },
        ],
      },
    ],
  );
}

export function buildCouponExcelPilotExpiredCard(input: {
  pilotId: string;
}): FeishuCard {
  return card("优惠券 Excel 试点已结束", "超过 10 分钟未继续操作", "orange", [
    {
      tag: "markdown",
      content: `试点草稿 **${input.pilotId.slice(0, 12)}** 已因长时间未继续操作而结束。未创建或提交正式 OA；如需继续，请重新发送 \`优惠券Excel试点\`。`,
    },
  ]);
}

export function buildCouponExcelPilotCanceledCard(input: {
  pilotId: string;
}): FeishuCard {
  return card("优惠券 Excel 试点已结束", "可重新发起其他优惠券流程", "green", [
    {
      tag: "markdown",
      content: `试点草稿 **${input.pilotId.slice(0, 12)}** 已结束，未创建或提交正式 OA。`,
    },
  ]);
}

export function buildCouponExcelPilotAmbiguousCard(input?: {
  pilot: CouponExcelPilotDraft;
  oaDraft: { recordId: string; draftId: string };
}): FeishuCard {
  return card(
    "存在两个未完成的优惠券流程",
    "请结束其中一个流程后再继续",
    "red",
    [
      {
        tag: "markdown",
        content:
          "为避免文件误挂到错误申请单，系统未处理本次文件。请选择结束其中一个流程后重新操作。",
      },
      ...(input
        ? [
            {
              tag: "button",
              text: plainText("结束 OA 草稿"),
              type: "danger",
              width: "fill",
              behaviors: [
                {
                  type: "callback",
                  value: {
                    action: "coupon_oa_cancel",
                    draftRecordId: input.oaDraft.recordId,
                  },
                },
              ],
            },
            {
              tag: "button",
              text: plainText("结束 Excel 试点"),
              type: "danger",
              width: "fill",
              behaviors: [
                {
                  type: "callback",
                  value: actionValue(input.pilot, "coupon_excel_pilot_cancel"),
                },
              ],
            },
          ]
        : []),
    ],
  );
}
