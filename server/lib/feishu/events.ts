import {
  getFeishuRuntimeStage,
  legacyPocEnabled,
} from "../control-plane/runtime-config";
import {
  createWorkflowInstance,
  decideWorkflowInstance,
  getPublishedExpenseTemplate,
  getTemplateByRecordId,
} from "./base-store";
import { sendFeishuCard } from "./client";
import { couponApprovalSchemaVersion } from "./coupon-oa/approval-schema";
import {
  buildCouponOaActiveWorkflowCard,
  buildCouponOaAttachmentRequestCard,
  buildCouponOaDisabledCard,
  buildCouponOaDraftDemoUnavailableCard,
  buildCouponOaDraftErrorCard,
  buildCouponOaDraftFormCard,
  buildCouponOaDraftSavedCard,
  buildCouponOaEntryCard,
  buildCouponOaPreviewCard,
  buildCouponOaSubmissionFailureCard,
  buildCouponOaSubmissionResultCard,
  buildCouponOaSubmissionUnknownCard,
  buildCouponOaSubmitCard,
  buildCouponOaUnavailableCard,
  buildCouponOaWorkflowCanceledCard,
  buildCouponOaWorkflowExpiredCard,
} from "./coupon-oa/cards";
import {
  assertCouponOaUserAllowed,
  getCouponOaInitiateUrl,
  isCouponOaDraftDemo,
  isCouponOaDraftInvocation,
  isCouponOaEnabled,
  isCouponOaInvocation,
} from "./coupon-oa/config";
import {
  missingCouponOaAttachments,
  parseCouponApplicationDraftForm,
  validateCouponApplicationDraft,
} from "./coupon-oa/draft-service";
import {
  type CouponOaDraft,
  getCouponOaDraft,
  listActiveCouponOaDrafts,
  saveCouponOaDraft,
  updateCouponOaDraft,
} from "./coupon-oa/draft-store";
import {
  buildCouponExcelPilotActiveWorkflowCard,
  buildCouponExcelPilotAmbiguousCard,
  buildCouponExcelPilotCanceledCard,
  buildCouponExcelPilotErrorCard,
  buildCouponExcelPilotExpiredCard,
  buildCouponExcelPilotGeneratingCard,
  buildCouponExcelPilotInputCard,
  buildCouponExcelPilotIntakeCard,
  buildCouponExcelPilotMappingCard,
  buildCouponExcelPilotOaHandoffRetryCard,
  buildCouponExcelPilotOutputCard,
  buildCouponExcelPilotWhitelistCorrectionCard,
  buildCouponExcelPilotWhitelistUploadCard,
} from "./coupon-oa/excel-pilot-cards";
import {
  isCouponExcelPilotEnabled,
  isCouponExcelPilotInvocation,
} from "./coupon-oa/excel-pilot-config";
import { handoffCouponPilotToOaDraft } from "./coupon-oa/excel-pilot-oa-handoff";
import { couponPilotSchemaVersion } from "./coupon-oa/excel-pilot-schema";
import {
  confirmCouponPilotInput,
  confirmCouponPilotOutput,
  extractAndSaveCouponPilotInput,
  generateCouponPilotArtifacts,
  saveCouponPilotWhitelistMapping,
  saveCouponPilotWhitelistSource,
} from "./coupon-oa/excel-pilot-service";
import {
  type CouponExcelPilotDraft,
  createCouponExcelPilotDraft,
  getCouponExcelPilotDraft,
  listActiveCouponExcelPilotDrafts,
  updateCouponExcelPilotDraft,
} from "./coupon-oa/excel-pilot-store";
import {
  confirmCouponOaDraft,
  submitConfirmedCouponOaDraft,
} from "./coupon-oa/submit-service";
import { buildCouponThreeSourceErrorCard } from "./coupon-oa/three-source/cards";
import {
  dispatchCouponThreeSourceCallback,
  dispatchCouponThreeSourceFile,
  dispatchCouponThreeSourceText,
} from "./coupon-oa/three-source/dispatcher";
import { isCouponThreeSourcePilotEnabled } from "./coupon-oa/three-source/pilot-config";
import { listActiveCouponThreeSourcePilotDrafts } from "./coupon-oa/three-source/store";
import {
  isCancelableCouponExcelPilot,
  isCancelableCouponOaDraft,
  isExpiredCouponExcelPilot,
  isExpiredCouponOaDraft,
} from "./coupon-oa/workflow-lifecycle";
import {
  buildExpenseApprovalCard,
  buildExpenseFormCard,
  buildExpenseResultCard,
  parseExpenseFormValue,
} from "./expense-poc";
import {
  downloadFeishuMessageResource as downloadExcelPilotMessageResource,
  getFeishuMessageBody as getExcelPilotMessageBody,
} from "./message-client";

export interface Envelope {
  challenge?: string;
  token?: string;
  header?: { event_id?: string; event_type?: string; token?: string };
  event?: {
    sender?: { sender_id?: { open_id?: string } };
    message?: {
      message_id?: string;
      message_type?: string;
      chat_type?: string;
      chat_id?: string;
      content?: string;
    };
  };
  action?: { name?: string; value?: unknown; form_value?: unknown };
  operator?: { open_id?: string; operator_id?: { open_id?: string } };
}
export type FeishuPocResult =
  | { kind: "challenge"; challenge: string }
  | { kind: "ignored"; reason: string }
  | { kind: "handled"; message: string };

const operatorId = (p: Envelope) =>
  p.operator?.open_id ?? p.operator?.operator_id?.open_id;

const eventId = (p: Envelope) =>
  p.header?.event_id ?? p.event?.message?.message_id;

const EXPENSE_INVOCATION_PATTERNS = [
  "发起报销",
  "申请报销",
  "我要报销",
  "帮我报销",
  "报销申请",
];

export function isExpenseInvocation(text: string): boolean {
  const normalized = text.replace(/\s+/g, "");
  return EXPENSE_INVOCATION_PATTERNS.some((pattern) =>
    normalized.includes(pattern),
  );
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object")
    return value as Record<string, unknown>;
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface CouponWorkflowState {
  oaDrafts: CouponOaDraft[];
  pilotDrafts: CouponExcelPilotDraft[];
  expiredOaDrafts: CouponOaDraft[];
  expiredPilotDrafts: CouponExcelPilotDraft[];
}

function onlyActiveExcelPilot(
  drafts: CouponExcelPilotDraft[],
): CouponExcelPilotDraft | undefined {
  if (drafts.length > 1) {
    throw new Error("存在多条 Excel 试点草稿，请先取消旧草稿后重试");
  }
  return drafts[0];
}

async function activeCouponWorkflowState(
  openId: string,
): Promise<CouponWorkflowState> {
  const [oaDrafts, pilotDrafts] = await Promise.all([
    listActiveCouponOaDrafts(openId),
    isCouponExcelPilotEnabled()
      ? listActiveCouponExcelPilotDrafts(openId)
      : Promise.resolve([]),
  ]);
  const expiredOaDrafts = oaDrafts.filter((draft) =>
    isExpiredCouponOaDraft(draft),
  );
  const expiredPilotDrafts = pilotDrafts.filter((draft) =>
    isExpiredCouponExcelPilot(draft),
  );
  await Promise.all([
    ...expiredOaDrafts.map((draft) =>
      updateCouponOaDraft(draft, { status: "Canceled" }),
    ),
    ...expiredPilotDrafts.map((draft) =>
      updateCouponExcelPilotDraft(draft, { status: "Canceled" }),
    ),
  ]);
  return {
    oaDrafts: oaDrafts.filter((draft) => !expiredOaDrafts.includes(draft)),
    pilotDrafts: pilotDrafts.filter(
      (draft) => !expiredPilotDrafts.includes(draft),
    ),
    expiredOaDrafts,
    expiredPilotDrafts,
  };
}

async function sendExpiredCouponWorkflowCards(
  openId: string,
  state: CouponWorkflowState,
): Promise<void> {
  await Promise.all([
    ...state.expiredOaDrafts.map((draft) =>
      sendFeishuCard(
        openId,
        buildCouponOaWorkflowExpiredCard({ draftId: draft.draftId }),
        `coupon-oa-expired-${draft.recordId}`,
      ),
    ),
    ...state.expiredPilotDrafts.map((draft) =>
      sendFeishuCard(
        openId,
        buildCouponExcelPilotExpiredCard({ pilotId: draft.pilotId }),
        `coupon-excel-pilot-expired-${draft.recordId}`,
      ),
    ),
  ]);
}

function expiredCouponWorkflowMessage(state: CouponWorkflowState): string {
  if (state.expiredOaDrafts.length) return "Coupon OA draft expired";
  return "Coupon Excel pilot expired";
}

async function ensureCouponOaUserAllowed(input: {
  openId: string;
  idempotencyKey?: string;
}): Promise<boolean> {
  try {
    assertCouponOaUserAllowed(input.openId);
    return true;
  } catch {
    await sendFeishuCard(
      input.openId,
      buildCouponOaDisabledCard(),
      input.idempotencyKey,
    );
    return false;
  }
}

async function expireCouponOaDraftIfNeeded(
  openId: string,
  draft: CouponOaDraft,
): Promise<boolean> {
  if (!isExpiredCouponOaDraft(draft)) return false;
  await updateCouponOaDraft(draft, { status: "Canceled" });
  await sendFeishuCard(
    openId,
    buildCouponOaWorkflowExpiredCard({ draftId: draft.draftId }),
    `coupon-oa-expired-${draft.recordId}`,
  );
  return true;
}

async function expireCouponExcelPilotIfNeeded(
  openId: string,
  draft: CouponExcelPilotDraft,
): Promise<boolean> {
  if (!isExpiredCouponExcelPilot(draft)) return false;
  await updateCouponExcelPilotDraft(draft, { status: "Canceled" });
  await sendFeishuCard(
    openId,
    buildCouponExcelPilotExpiredCard({ pilotId: draft.pilotId }),
    `coupon-excel-pilot-expired-${draft.recordId}`,
  );
  return true;
}

function canAcceptCouponPilotWhitelistSource(
  draft: CouponExcelPilotDraft,
): boolean {
  return (
    draft.status === "AwaitingWhitelistUpload" ||
    (draft.status === "NeedsInput" && Boolean(draft.input))
  );
}

async function handleCouponExcelPilotFile(input: {
  draft: CouponExcelPilotDraft;
  openId: string;
  messageId: string;
}): Promise<string> {
  if (input.draft.processedMessageIds.includes(input.messageId)) {
    return `Coupon Excel pilot source ${input.messageId} was already processed`;
  }
  const message = await getExcelPilotMessageBody({
    messageId: input.messageId,
  });
  if (message.messageType !== "file") {
    throw new Error("Excel 试点仅接受文件消息");
  }
  const content = objectValue(message.content);
  const fileKey = String(content?.file_key ?? "");
  const fileName = String(content?.file_name ?? "未命名白名单.xlsx");
  if (!fileKey) throw new Error("白名单文件未包含 file_key");
  if (!fileName.toLowerCase().endsWith(".xlsx")) {
    throw new Error("白名单源文件必须是 .xlsx");
  }
  const bytes = await downloadExcelPilotMessageResource({
    messageId: input.messageId,
    fileKey,
    type: "file",
  });
  if (bytes.byteLength > 2 * 1024 * 1024) {
    throw new Error("白名单源文件超过试点 2 MB 上限");
  }
  const next = await saveCouponPilotWhitelistSource({
    draft: input.draft,
    messageId: input.messageId,
    fileKey,
    fileName,
    bytes,
  });
  if (next.status === "AwaitingWhitelistMapping") {
    await sendFeishuCard(input.openId, buildCouponExcelPilotMappingCard(next));
  } else if (next.status === "NeedsInput" && next.input) {
    await sendFeishuCard(
      input.openId,
      buildCouponExcelPilotWhitelistCorrectionCard(next),
    );
  } else {
    await sendFeishuCard(input.openId, buildCouponExcelPilotInputCard(next));
  }
  return `Coupon Excel pilot source saved to ${next.pilotId}`;
}

function draftPreviewCard(draft: Awaited<ReturnType<typeof getCouponOaDraft>>) {
  return buildCouponOaPreviewCard({
    draftRecordId: draft.recordId,
    values: draft.values,
    attachments: draft.attachments,
    missing: missingCouponOaAttachments(draft),
  });
}

export interface FeishuPocEventOptions {
  /** Only the HMAC-verified private bridge ingress may set this value. */
  trustedIngress?: "bridge";
  /** Restricts the temporary P0 bridge to the three-source adapter. */
  threeSourceOnly?: boolean;
}

export async function handleFeishuPocEvent(
  payload: Envelope,
  options: FeishuPocEventOptions = {},
): Promise<FeishuPocResult> {
  if (options.trustedIngress !== "bridge") {
    const expected = process.env.FEISHU_VERIFICATION_TOKEN?.trim();
    if (!expected) {
      throw new Error("FEISHU_VERIFICATION_TOKEN is not configured");
    }
    if ((payload.token ?? payload.header?.token) !== expected) {
      throw new Error("Invalid Feishu verification token");
    }
  }
  if (payload.challenge)
    return { kind: "challenge", challenge: payload.challenge };

  if (getFeishuRuntimeStage() !== "local" && !legacyPocEnabled()) {
    return {
      kind: "ignored",
      reason:
        "Legacy synchronous Feishu POC routes are disabled outside local runtime",
    };
  }

  const couponOaEnabled = isCouponOaEnabled();
  const draftDemo = isCouponOaDraftDemo();

  if (payload.header?.event_type === "im.message.receive_v1") {
    const openId = payload.event?.sender?.sender_id?.open_id;
    const message = payload.event?.message;
    if (!openId || !message?.message_type || !message.content)
      return { kind: "ignored", reason: "Unsupported message" };
    const idempotencyKey = eventId(payload);

    if (["image", "file"].includes(message.message_type)) {
      if (message.message_type === "file" && message.message_id) {
        const content = objectValue(message.content);
        const fileKey = String(content?.file_key ?? "") || undefined;
        const fileName = String(content?.file_name ?? "") || undefined;
        const threeSourceResult = await dispatchCouponThreeSourceFile({
          openId,
          messageId: message.message_id,
          fileKey,
          fileName,
          idempotencyKey,
        });
        if (threeSourceResult.handled) {
          return { kind: "handled", message: threeSourceResult.message };
        }
      }
      if (options.threeSourceOnly) {
        return {
          kind: "ignored",
          reason: "Unsupported three-source P0 attachment",
        };
      }
      const workflowState = await activeCouponWorkflowState(openId);
      await sendExpiredCouponWorkflowCards(openId, workflowState);
      if (
        workflowState.expiredOaDrafts.length ||
        workflowState.expiredPilotDrafts.length
      ) {
        return {
          kind: "handled",
          message: expiredCouponWorkflowMessage(workflowState),
        };
      }
      const pilot = onlyActiveExcelPilot(workflowState.pilotDrafts);
      const oaDraft = workflowState.oaDrafts[0];
      if (pilot) {
        if (oaDraft) {
          await sendFeishuCard(
            openId,
            buildCouponExcelPilotAmbiguousCard({ pilot, oaDraft }),
          );
          return {
            kind: "handled",
            message: "Coupon Excel pilot and OA draft are ambiguous",
          };
        }
        if (!canAcceptCouponPilotWhitelistSource(pilot)) {
          await sendFeishuCard(
            openId,
            buildCouponExcelPilotErrorCard({
              title: "尚不能接收白名单",
              message:
                "请先确认优惠券字段；如已进入映射或生成阶段，请按当前卡片继续操作。",
            }),
          );
          return {
            kind: "handled",
            message:
              "Coupon Excel pilot rejected a file before whitelist upload",
          };
        }
        if (message.message_type !== "file" || !message.message_id) {
          await sendFeishuCard(
            openId,
            buildCouponExcelPilotErrorCard({
              message: "Excel 试点请发送 .xlsx 白名单文件。",
            }),
          );
          return {
            kind: "handled",
            message: "Coupon Excel pilot ignored attachment",
          };
        }
        try {
          const result = await handleCouponExcelPilotFile({
            draft: pilot,
            openId,
            messageId: message.message_id,
          });
          return { kind: "handled", message: result };
        } catch (error) {
          const detail =
            error instanceof Error
              ? error.message
              : "白名单文件处理失败，请稍后重试";
          await sendFeishuCard(
            openId,
            buildCouponExcelPilotErrorCard({ message: detail }),
          );
          return {
            kind: "handled",
            message: `Coupon Excel pilot failed: ${detail}`,
          };
        }
      }
      if (!couponOaEnabled) {
        await sendFeishuCard(
          openId,
          buildCouponOaDisabledCard(),
          idempotencyKey,
        );
        return {
          kind: "handled",
          message: "Coupon OA is disabled",
        };
      }
      if (!(await ensureCouponOaUserAllowed({ openId, idempotencyKey }))) {
        return { kind: "handled", message: "Coupon OA user is not allowed" };
      }
      if (draftDemo) {
        await sendFeishuCard(
          openId,
          buildCouponOaDraftDemoUnavailableCard(),
          idempotencyKey,
        );
        return {
          kind: "handled",
          message: "Coupon OA draft demo ignored an attachment",
        };
      }
      if (!oaDraft) {
        await sendFeishuCard(
          openId,
          buildCouponOaAttachmentRequestCard({
            draftId: "未找到草稿",
            missing: ["请先发送 OA优惠券填报，再填写并保存申请信息"],
          }),
          idempotencyKey,
        );
        return {
          kind: "handled",
          message: "Coupon OA attachment received without a draft",
        };
      }
      if (!message.message_id) {
        return { kind: "ignored", reason: "Attachment message ID is missing" };
      }
      await sendFeishuCard(
        openId,
        buildCouponOaDraftErrorCard({
          message:
            "原始附件直传审批已禁用。请使用受控的 Excel 试点产物，或等待三源提报路线完成 R2 draft-only 实现。",
        }),
        idempotencyKey,
      );
      return {
        kind: "handled",
        message: "Coupon OA source attachment promotion is disabled",
      };
    }

    if (message.message_type !== "text")
      return { kind: "ignored", reason: "Unsupported message" };
    const text =
      (objectValue(message.content)?.text as string | undefined) ?? "";
    const threeSourceResult = await dispatchCouponThreeSourceText({
      openId,
      text,
      idempotencyKey,
    });
    if (threeSourceResult.handled) {
      return { kind: "handled", message: threeSourceResult.message };
    }
    if (options.threeSourceOnly) {
      return {
        kind: "ignored",
        reason: "Unsupported three-source P0 message",
      };
    }
    if (
      isCouponThreeSourcePilotEnabled() &&
      (isCouponExcelPilotInvocation(text) || isCouponOaDraftInvocation(text))
    ) {
      const activeThreeSource =
        await listActiveCouponThreeSourcePilotDrafts(openId);
      if (activeThreeSource.length) {
        await sendFeishuCard(
          openId,
          buildCouponThreeSourceErrorCard({
            message:
              "当前存在未完成的 OA 优惠券三源提报。请继续或结束当前三源提报后，再启动其他优惠券流程。",
          }),
          idempotencyKey,
        );
        return {
          kind: "handled",
          message: "Coupon workflow is blocked by an active three-source pilot",
        };
      }
    }
    const workflowState = await activeCouponWorkflowState(openId);
    await sendExpiredCouponWorkflowCards(openId, workflowState);
    if (
      workflowState.expiredOaDrafts.length ||
      workflowState.expiredPilotDrafts.length
    ) {
      return {
        kind: "handled",
        message: expiredCouponWorkflowMessage(workflowState),
      };
    }

    if (isCouponExcelPilotInvocation(text)) {
      if (!isCouponExcelPilotEnabled()) {
        await sendFeishuCard(
          openId,
          buildCouponExcelPilotErrorCard({
            message: "Excel 试点尚未启用，请联系试点维护人完成配置。",
          }),
          idempotencyKey,
        );
        return { kind: "handled", message: "Coupon Excel pilot is disabled" };
      }
      try {
        const existing = onlyActiveExcelPilot(workflowState.pilotDrafts);
        const oaDraft = workflowState.oaDrafts[0];
        if (oaDraft) {
          await sendFeishuCard(
            openId,
            existing
              ? buildCouponExcelPilotAmbiguousCard({
                  pilot: existing,
                  oaDraft,
                })
              : buildCouponOaActiveWorkflowCard({
                  draftId: oaDraft.draftId,
                  draftRecordId: oaDraft.recordId,
                }),
          );
          return {
            kind: "handled",
            message: "Coupon Excel pilot cannot start with active OA draft",
          };
        }
        const draft =
          existing ??
          (await createCouponExcelPilotDraft({
            ownerOpenId: openId,
            schemaVersion: couponPilotSchemaVersion,
          }));
        await sendFeishuCard(
          openId,
          buildCouponExcelPilotIntakeCard(),
          idempotencyKey,
        );
        return {
          kind: "handled",
          message: `Coupon Excel pilot opened ${draft.pilotId}`,
        };
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : "无法创建 Excel 试点草稿";
        await sendFeishuCard(
          openId,
          buildCouponExcelPilotErrorCard({ message: detail }),
          idempotencyKey,
        );
        return {
          kind: "handled",
          message: `Coupon Excel pilot failed: ${detail}`,
        };
      }
    }

    if (isCouponOaDraftInvocation(text)) {
      if (!couponOaEnabled) {
        await sendFeishuCard(
          openId,
          buildCouponOaDisabledCard(),
          idempotencyKey,
        );
        return { kind: "handled", message: "Coupon OA is disabled" };
      }
      if (!(await ensureCouponOaUserAllowed({ openId, idempotencyKey }))) {
        return { kind: "handled", message: "Coupon OA user is not allowed" };
      }
      const pilot = onlyActiveExcelPilot(workflowState.pilotDrafts);
      const oaDraft = workflowState.oaDrafts[0];
      if (pilot) {
        await sendFeishuCard(
          openId,
          oaDraft
            ? buildCouponExcelPilotAmbiguousCard({ pilot, oaDraft })
            : buildCouponExcelPilotActiveWorkflowCard(pilot),
          idempotencyKey,
        );
        return {
          kind: "handled",
          message: "Coupon OA draft cannot start with active Excel pilot",
        };
      }
      await sendFeishuCard(
        openId,
        buildCouponOaDraftFormCard({ draftDemo }),
        idempotencyKey,
      );
      return { kind: "handled", message: "Coupon OA draft form opened" };
    }

    if (isCouponOaInvocation(text)) {
      let initiateUrl: string;
      try {
        initiateUrl = getCouponOaInitiateUrl();
      } catch (error) {
        console.error("Coupon OA entry is unavailable:", error);
        await sendFeishuCard(
          openId,
          buildCouponOaUnavailableCard(),
          idempotencyKey,
        );
        return { kind: "handled", message: "Coupon OA entry is unavailable" };
      }

      await sendFeishuCard(
        openId,
        buildCouponOaEntryCard(initiateUrl),
        idempotencyKey,
      );
      return { kind: "handled", message: "Coupon OA entry opened" };
    }

    const pilot = onlyActiveExcelPilot(workflowState.pilotDrafts);
    if (pilot) {
      const oaDraft = workflowState.oaDrafts[0];
      if (oaDraft) {
        await sendFeishuCard(
          openId,
          buildCouponExcelPilotAmbiguousCard({ pilot, oaDraft }),
        );
        return {
          kind: "handled",
          message: "Coupon Excel pilot and OA draft are ambiguous",
        };
      }
      if (
        ["Collecting", "NeedsInput", "AwaitingInputConfirmation"].includes(
          pilot.status,
        )
      ) {
        try {
          const next = await extractAndSaveCouponPilotInput(pilot, text);
          await sendFeishuCard(openId, buildCouponExcelPilotInputCard(next));
          return {
            kind: "handled",
            message: `Coupon Excel pilot input saved to ${next.pilotId}`,
          };
        } catch (error) {
          const detail =
            error instanceof Error ? error.message : "字段提取失败，请稍后重试";
          await sendFeishuCard(
            openId,
            buildCouponExcelPilotErrorCard({ message: detail }),
          );
          return {
            kind: "handled",
            message: `Coupon Excel pilot input failed: ${detail}`,
          };
        }
      }
    }

    if (!isExpenseInvocation(text))
      return { kind: "ignored", reason: "Not a supported invocation" };
    const template = await getPublishedExpenseTemplate();
    if (idempotencyKey) {
      await sendFeishuCard(
        openId,
        buildExpenseFormCard(template),
        idempotencyKey,
      );
    } else {
      await sendFeishuCard(openId, buildExpenseFormCard(template));
    }
    return { kind: "handled", message: "Published expense template opened" };
  }

  const openId = operatorId(payload);
  if (!openId) return { kind: "ignored", reason: "Missing operator" };
  const form = objectValue(payload.action?.form_value);
  const callbackValue = objectValue(payload.action?.value);
  const threeSourceResult = await dispatchCouponThreeSourceCallback({
    openId,
    action: payload.action?.name ?? String(callbackValue?.action ?? ""),
    value: callbackValue ?? undefined,
    form: form ?? undefined,
    idempotencyKey: eventId(payload),
  });
  if (threeSourceResult.handled) {
    return { kind: "handled", message: threeSourceResult.message };
  }
  if (options.threeSourceOnly) {
    return { kind: "ignored", reason: "Unsupported three-source P0 action" };
  }
  const name = payload.action?.name ?? "";
  const [mappingAction, mappingPilotRecordId, mappingRevisionText] =
    name.split(":");
  if (form && mappingAction === "coupon_excel_pilot_mapping_confirm") {
    try {
      const expectedRevision = Number(mappingRevisionText);
      if (!mappingPilotRecordId || !Number.isInteger(expectedRevision)) {
        throw new Error("白名单映射卡片无效，请重新上传文件");
      }
      const draft = await getCouponExcelPilotDraft(mappingPilotRecordId);
      if (draft.ownerOpenId !== openId) {
        throw new Error("只有 Excel 试点草稿创建人可以确认映射");
      }
      if (draft.revision !== expectedRevision) {
        throw new Error("当前白名单映射卡片已过期，请使用最新卡片");
      }
      if (draft.status !== "AwaitingWhitelistMapping") {
        throw new Error("当前状态不能确认白名单映射");
      }
      if (await expireCouponExcelPilotIfNeeded(openId, draft)) {
        return {
          kind: "handled",
          message: `Coupon Excel pilot ${draft.pilotId} expired`,
        };
      }
      const workflowState = await activeCouponWorkflowState(openId);
      await sendExpiredCouponWorkflowCards(openId, workflowState);
      if (
        workflowState.expiredOaDrafts.length ||
        workflowState.expiredPilotDrafts.length
      ) {
        return {
          kind: "handled",
          message: expiredCouponWorkflowMessage(workflowState),
        };
      }
      const oaDraft = workflowState.oaDrafts[0];
      if (oaDraft) {
        await sendFeishuCard(
          openId,
          buildCouponExcelPilotAmbiguousCard({ pilot: draft, oaDraft }),
        );
        return {
          kind: "handled",
          message: "Coupon Excel pilot and OA draft are ambiguous",
        };
      }
      const mappingRaw = String(form.mapping ?? "");
      const mapping = objectValue(mappingRaw);
      const sheetName = String(mapping?.sheetName ?? "");
      const column = String(mapping?.column ?? "");
      const header = String(mapping?.header ?? "");
      if (!sheetName || !column || !header) {
        throw new Error("请选择有效的白名单来源列");
      }
      const generating = await saveCouponPilotWhitelistMapping({
        draft,
        mapping: { sheetName, column, header },
      });
      await sendFeishuCard(openId, buildCouponExcelPilotGeneratingCard());
      const next = await generateCouponPilotArtifacts(generating);
      await sendFeishuCard(
        openId,
        next.status === "AwaitingOutputConfirmation"
          ? buildCouponExcelPilotOutputCard(next)
          : next.status === "NeedsInput" && next.input
            ? buildCouponExcelPilotWhitelistCorrectionCard(next)
            : buildCouponExcelPilotInputCard(next),
      );
      return {
        kind: "handled",
        message: `Coupon Excel pilot generation completed for ${next.pilotId}`,
      };
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Excel 生成失败，请稍后重试";
      await sendFeishuCard(
        openId,
        buildCouponExcelPilotErrorCard({ message: detail }),
      );
      return {
        kind: "handled",
        message: `Coupon Excel pilot generation failed: ${detail}`,
      };
    }
  }
  if (form && name === "coupon_oa_draft_save") {
    if (!couponOaEnabled) {
      await sendFeishuCard(openId, buildCouponOaDisabledCard());
      return { kind: "handled", message: "Coupon OA is disabled" };
    }
    if (!(await ensureCouponOaUserAllowed({ openId }))) {
      return { kind: "handled", message: "Coupon OA user is not allowed" };
    }
    const workflowState = await activeCouponWorkflowState(openId);
    await sendExpiredCouponWorkflowCards(openId, workflowState);
    if (
      workflowState.expiredOaDrafts.length ||
      workflowState.expiredPilotDrafts.length
    ) {
      return {
        kind: "handled",
        message: expiredCouponWorkflowMessage(workflowState),
      };
    }
    const pilot = onlyActiveExcelPilot(workflowState.pilotDrafts);
    if (pilot) {
      const oaDraft = workflowState.oaDrafts[0];
      await sendFeishuCard(
        openId,
        oaDraft
          ? buildCouponExcelPilotAmbiguousCard({ pilot, oaDraft })
          : buildCouponExcelPilotActiveWorkflowCard(pilot),
      );
      return {
        kind: "handled",
        message: "Coupon OA draft save blocked by active Excel pilot",
      };
    }
    let draft: Awaited<ReturnType<typeof saveCouponOaDraft>>;
    try {
      const values = parseCouponApplicationDraftForm(form);
      validateCouponApplicationDraft(values);
      draft = await saveCouponOaDraft({
        ownerOpenId: openId,
        schemaVersion: couponApprovalSchemaVersion,
        values,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "无法保存本地草稿，请稍后重试";
      await sendFeishuCard(openId, buildCouponOaDraftErrorCard({ message }));
      return {
        kind: "handled",
        message: `Coupon OA draft save failed: ${message}`,
      };
    }

    if (draftDemo) {
      await sendFeishuCard(
        openId,
        buildCouponOaDraftSavedCard({ draftId: draft.draftId }),
      );
      return {
        kind: "handled",
        message: `Saved coupon OA draft ${draft.draftId}`,
      };
    }
    await sendFeishuCard(
      openId,
      buildCouponOaAttachmentRequestCard({
        draftId: draft.draftId,
        missing: missingCouponOaAttachments(draft),
      }),
    );
    return {
      kind: "handled",
      message: `Saved coupon OA draft ${draft.draftId}`,
    };
  }

  if (form && name.startsWith("expense_submit:")) {
    const [, recordId, version] = name.split(":");
    const template = await getTemplateByRecordId(recordId);
    if (template.version !== Number(version))
      throw new Error("Template version changed; reopen the form");
    const instance = await createWorkflowInstance({
      template,
      submitterOpenId: openId,
      data: parseExpenseFormValue(form),
    });
    await sendFeishuCard(
      instance.approverOpenId,
      buildExpenseApprovalCard(instance),
    );
    return { kind: "handled", message: `Created ${instance.instanceId}` };
  }

  const value = objectValue(payload.action?.value);
  const action = String(value?.action ?? "");
  const couponPilotRecordId = String(value?.pilotRecordId ?? "");
  const couponPilotRevision = Number(value?.revision);
  const couponDraftRecordId = String(value?.draftRecordId ?? "");
  if (couponPilotRecordId && action === "coupon_excel_pilot_cancel") {
    try {
      const draft = await getCouponExcelPilotDraft(couponPilotRecordId);
      if (draft.ownerOpenId !== openId) {
        throw new Error("只有 Excel 试点草稿创建人可以结束流程");
      }
      if (
        !Number.isInteger(couponPilotRevision) ||
        draft.revision !== couponPilotRevision
      ) {
        throw new Error("当前卡片已过期，请打开最新的 Excel 试点卡片");
      }
      if (await expireCouponExcelPilotIfNeeded(openId, draft)) {
        return {
          kind: "handled",
          message: `Coupon Excel pilot ${draft.pilotId} expired`,
        };
      }
      if (draft.status === "Canceled") {
        await sendFeishuCard(
          openId,
          buildCouponExcelPilotCanceledCard({ pilotId: draft.pilotId }),
        );
        return {
          kind: "handled",
          message: `Coupon Excel pilot ${draft.pilotId} was already canceled`,
        };
      }
      if (!isCancelableCouponExcelPilot(draft)) {
        throw new Error("当前 Excel 试点状态不能结束");
      }
      const canceled = await updateCouponExcelPilotDraft(draft, {
        status: "Canceled",
      });
      await sendFeishuCard(
        openId,
        buildCouponExcelPilotCanceledCard({ pilotId: canceled.pilotId }),
      );
      return {
        kind: "handled",
        message: `Canceled coupon Excel pilot ${canceled.pilotId}`,
      };
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : "无法结束 Excel 试点，请稍后重试";
      await sendFeishuCard(
        openId,
        buildCouponExcelPilotErrorCard({ message: detail }),
      );
      return {
        kind: "handled",
        message: `Coupon Excel pilot cancel failed: ${detail}`,
      };
    }
  }
  if (couponDraftRecordId && action === "coupon_oa_cancel") {
    if (!couponOaEnabled) {
      await sendFeishuCard(openId, buildCouponOaDisabledCard());
      return { kind: "handled", message: "Coupon OA is disabled" };
    }
    if (!(await ensureCouponOaUserAllowed({ openId }))) {
      return { kind: "handled", message: "Coupon OA user is not allowed" };
    }
    try {
      const draft = await getCouponOaDraft(couponDraftRecordId);
      if (draft.ownerOpenId !== openId) {
        throw new Error("只有优惠券 OA 草稿创建人可以结束流程");
      }
      if (await expireCouponOaDraftIfNeeded(openId, draft)) {
        return {
          kind: "handled",
          message: `Coupon OA draft ${draft.draftId} expired`,
        };
      }
      if (draft.status === "Canceled") {
        await sendFeishuCard(
          openId,
          buildCouponOaWorkflowCanceledCard({ draftId: draft.draftId }),
        );
        return {
          kind: "handled",
          message: `Coupon OA draft ${draft.draftId} was already canceled`,
        };
      }
      if (!isCancelableCouponOaDraft(draft)) {
        throw new Error("当前优惠券 OA 草稿状态不能结束");
      }
      const canceled = await updateCouponOaDraft(draft, { status: "Canceled" });
      await sendFeishuCard(
        openId,
        buildCouponOaWorkflowCanceledCard({ draftId: canceled.draftId }),
      );
      return {
        kind: "handled",
        message: `Canceled coupon OA draft ${canceled.draftId}`,
      };
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : "无法结束优惠券 OA 草稿，请稍后重试";
      await sendFeishuCard(
        openId,
        buildCouponOaDraftErrorCard({ message: detail }),
      );
      return {
        kind: "handled",
        message: `Coupon OA draft cancel failed: ${detail}`,
      };
    }
  }

  if (
    couponPilotRecordId &&
    [
      "coupon_excel_pilot_input_confirm",
      "coupon_excel_pilot_output_confirm",
    ].includes(action)
  ) {
    try {
      const draft = await getCouponExcelPilotDraft(couponPilotRecordId);
      if (draft.ownerOpenId !== openId) {
        throw new Error("只有 Excel 试点草稿创建人可以确认");
      }
      if (
        !Number.isInteger(couponPilotRevision) ||
        draft.revision !== couponPilotRevision
      ) {
        throw new Error("当前卡片已过期，请打开最新的 Excel 试点卡片");
      }
      if (await expireCouponExcelPilotIfNeeded(openId, draft)) {
        return {
          kind: "handled",
          message: `Coupon Excel pilot ${draft.pilotId} expired`,
        };
      }
      if (action === "coupon_excel_pilot_input_confirm") {
        const confirmed = await confirmCouponPilotInput(draft);
        await sendFeishuCard(
          openId,
          buildCouponExcelPilotWhitelistUploadCard(),
        );
        return {
          kind: "handled",
          message: `Coupon Excel pilot input confirmed ${confirmed.pilotId}`,
        };
      }
      if (!couponOaEnabled) {
        throw new Error("优惠券 OA 工作流当前未启用，不能交接 Excel 试点结果");
      }
      if (!(await ensureCouponOaUserAllowed({ openId }))) {
        return { kind: "handled", message: "Coupon OA user is not allowed" };
      }
      if (draftDemo) {
        throw new Error(
          "Excel 试点自动填写 OA 需要 FEISHU_COUPON_OA_MODE=native-submit",
        );
      }
      const handingOff = await confirmCouponPilotOutput(draft);
      const handoff = await handoffCouponPilotToOaDraft(handingOff);
      const missing = missingCouponOaAttachments(handoff.oaDraft);
      await sendFeishuCard(
        openId,
        missing.length
          ? buildCouponOaAttachmentRequestCard({
              draftId: handoff.oaDraft.draftId,
              missing,
            })
          : draftPreviewCard(handoff.oaDraft),
      );
      return {
        kind: "handled",
        message: `Coupon Excel pilot filled OA draft ${handoff.oaDraft.draftId}`,
      };
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : "Excel 试点确认失败，请稍后重试";
      const retryPilot =
        error && typeof error === "object" && "pilot" in error
          ? (error.pilot as CouponExcelPilotDraft | undefined)
          : undefined;
      await sendFeishuCard(
        openId,
        action === "coupon_excel_pilot_output_confirm" && retryPilot
          ? buildCouponExcelPilotOaHandoffRetryCard(retryPilot)
          : buildCouponExcelPilotErrorCard({ message: detail }),
      );
      return {
        kind: "handled",
        message: `Coupon Excel pilot confirmation failed: ${detail}`,
      };
    }
  }
  if (
    couponDraftRecordId &&
    ["coupon_oa_confirm", "coupon_oa_submit"].includes(action)
  ) {
    if (!couponOaEnabled) {
      await sendFeishuCard(openId, buildCouponOaDisabledCard());
      return { kind: "handled", message: "Coupon OA is disabled" };
    }
    if (!(await ensureCouponOaUserAllowed({ openId }))) {
      return { kind: "handled", message: "Coupon OA user is not allowed" };
    }
    if (draftDemo) {
      await sendFeishuCard(openId, buildCouponOaDraftDemoUnavailableCard());
      return {
        kind: "handled",
        message: "Coupon OA draft demo ignored an approval action",
      };
    }
    const draft = await getCouponOaDraft(couponDraftRecordId);
    if (draft.ownerOpenId !== openId) {
      throw new Error(
        "Only the coupon OA draft owner can confirm or submit it",
      );
    }
    if (await expireCouponOaDraftIfNeeded(openId, draft)) {
      return {
        kind: "handled",
        message: `Coupon OA draft ${draft.draftId} expired`,
      };
    }
    if (
      action === "coupon_oa_submit" &&
      draft.status === "CreatedNeedsReview"
    ) {
      await sendFeishuCard(
        openId,
        buildCouponOaSubmissionResultCard({
          instanceLink: draft.approvalInstanceLink,
          verificationIssues: draft.validationIssues,
        }),
      );
      return {
        kind: "handled",
        message: `Coupon OA ${draft.approvalInstanceCode ?? ""} requires review`,
      };
    }
    if (action === "coupon_oa_submit" && draft.status === "SubmissionUnknown") {
      await sendFeishuCard(
        openId,
        buildCouponOaSubmissionUnknownCard({
          message:
            draft.failureReason ??
            "当前提交是否已创建原生 OA 无法确认，请人工对账。",
        }),
      );
      return {
        kind: "handled",
        message: `Coupon OA ${draft.draftId} submission outcome is unknown`,
      };
    }
    if (action === "coupon_oa_submit" && draft.status === "Submitted") {
      await sendFeishuCard(
        openId,
        buildCouponOaSubmissionResultCard({
          instanceLink: draft.approvalInstanceLink,
          verificationIssues: [],
        }),
      );
      return {
        kind: "handled",
        message: `Coupon OA ${draft.approvalInstanceCode ?? ""} was already submitted`,
      };
    }
    if (action === "coupon_oa_confirm") {
      const missing = missingCouponOaAttachments(draft);
      if (missing.length) {
        await sendFeishuCard(
          openId,
          buildCouponOaAttachmentRequestCard({
            draftId: draft.draftId,
            missing,
          }),
        );
        return {
          kind: "handled",
          message: "Coupon OA draft is missing attachments",
        };
      }
      const confirmed = await confirmCouponOaDraft(draft);
      await sendFeishuCard(
        openId,
        buildCouponOaSubmitCard({
          draftRecordId: confirmed.recordId,
          values: confirmed.values,
          attachments: confirmed.attachments,
        }),
      );
      return {
        kind: "handled",
        message: `Confirmed coupon OA draft ${confirmed.draftId}`,
      };
    }

    let result: Awaited<ReturnType<typeof submitConfirmedCouponOaDraft>>;
    try {
      result = await submitConfirmedCouponOaDraft(draft);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知提交错误";
      const failedDraft =
        error && typeof error === "object" && "draft" in error
          ? (error.draft as CouponOaDraft | undefined)
          : undefined;
      if (failedDraft?.status === "SubmissionUnknown") {
        await sendFeishuCard(
          openId,
          buildCouponOaSubmissionUnknownCard({ message }),
        );
        return {
          kind: "handled",
          message: `Coupon OA ${failedDraft.draftId} submission outcome is unknown`,
        };
      }
      await sendFeishuCard(
        openId,
        buildCouponOaSubmissionFailureCard({ message }),
      );
      return {
        kind: "handled",
        message: `Coupon OA submission failed: ${message}`,
      };
    }
    await sendFeishuCard(
      openId,
      buildCouponOaSubmissionResultCard({
        instanceLink: result.draft.approvalInstanceLink,
        verificationIssues: result.verificationIssues,
      }),
    );
    return {
      kind: "handled",
      message: `Submitted coupon OA ${result.draft.approvalInstanceCode ?? ""}`,
    };
  }

  const expenseRecordId = String(value?.instanceRecordId ?? "");
  if (
    !expenseRecordId ||
    !["expense_approve", "expense_reject"].includes(action)
  )
    return { kind: "ignored", reason: "Unsupported callback" };
  const instance = await decideWorkflowInstance({
    recordId: expenseRecordId,
    decision: action === "expense_approve" ? "Approved" : "Rejected",
    operatorOpenId: openId,
  });
  await sendFeishuCard(
    instance.submitterOpenId,
    buildExpenseResultCard(instance),
  );
  return {
    kind: "handled",
    message: `${instance.instanceId} ${instance.status}`,
  };
}
