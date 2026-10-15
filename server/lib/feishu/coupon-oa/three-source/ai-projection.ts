import type {
  CouponAiRecognitionProjector,
  CouponAiSourceLoader,
} from "../../../control-plane/coupon-ai-recognition-effect";
import type { CouponAiRecognitionRun } from "../../../control-plane/postgres-coupon-ai-recognition-repository";
import { downloadFeishuMessageResource } from "../../message-client";
import { deliverCouponThreeSourceMappingCard } from "./mapping-card-delivery";
import {
  getCouponThreeSourcePilotDraft,
  updateCouponThreeSourcePilotDraft,
} from "./store";

export interface CouponThreeSourceAiProjectionDependencies {
  getDraft: typeof getCouponThreeSourcePilotDraft;
  updateDraft: typeof updateCouponThreeSourcePilotDraft;
  deliverMappingCard: typeof deliverCouponThreeSourceMappingCard;
}

const defaultDependencies: CouponThreeSourceAiProjectionDependencies = {
  getDraft: getCouponThreeSourcePilotDraft,
  updateDraft: updateCouponThreeSourcePilotDraft,
  deliverMappingCard: deliverCouponThreeSourceMappingCard,
};

function hasPendingAiRecognition(
  draft: Awaited<ReturnType<typeof getCouponThreeSourcePilotDraft>>,
): boolean {
  return Object.values(draft.recognitions).some(
    (recognition) => recognition?.ai?.status === "pending",
  );
}

export function createCouponThreeSourceAiProjector(
  dependencies: CouponThreeSourceAiProjectionDependencies = defaultDependencies,
): CouponAiRecognitionProjector {
  return {
    async project({ run, idempotencyKey }) {
      const draft = await dependencies.getDraft(run.pilotRecordId);
      const role = run.sourceSlot;
      if (role === "pending") return;
      const recognition = draft.recognitions[role];
      // An owner, revision or source change invalidates old AI output. Discarding
      // is terminal and deliberately does not mutate or notify the newer draft.
      // A canceled or confirmed draft must also discard: the store refuses
      // writes on inactive drafts, so projecting would retry forever.
      if (
        draft.ownerOpenId !== run.ownerOpenId ||
        draft.task.taskId !== run.businessTaskId ||
        draft.task.revision !== run.revision ||
        draft.task.status === "Canceled" ||
        draft.task.status === "DraftOnlyConfirmed" ||
        !recognition ||
        recognition.sourceHash !== run.sourceSha256 ||
        recognition.ai?.runId !== run.id
      ) {
        return;
      }
      // A terminal slot means this run's result was already written — either
      // the owner skipped the wait (ai failed/owner_skipped) or an earlier
      // attempt persisted the result but died before delivering the card
      // (e.g. an interrupted tick). Never overwrite it; a retry must still
      // complete the delivery half below or the owner is stranded on the
      // recognizing card with everything else already settled.
      const alreadyWritten = recognition.ai?.status !== "pending";
      const updated = alreadyWritten
        ? draft
        : await dependencies.updateDraft(
            draft,
            {
              recognitions: {
                ...draft.recognitions,
                [role]: {
                  ...recognition,
                  ai: {
                    runId: run.id,
                    revision: run.revision,
                    sourceSha256: run.sourceSha256,
                    status: run.status,
                    result: run.result,
                    audit: run.audit,
                    fallbackCode: run.fallbackCode,
                    primary: recognition.ai?.primary,
                    activityCopyEnabled: recognition.ai?.activityCopyEnabled,
                  },
                },
              },
              validationIssues:
                run.status === "succeeded"
                  ? draft.validationIssues
                  : [
                      ...draft.validationIssues.filter(
                        (issue) => !issue.startsWith("AI 识别已降级"),
                      ),
                      `AI 识别已降级：${run.fallbackCode ?? run.status}；请人工确认缺失字段`,
                    ],
            },
            run.revision,
          );
      // Delivery is idempotent per revision: skip when this revision's
      // mapping card already went out (a duplicate delivery would PATCH the
      // live form and reset the owner's in-progress typing).
      const deliveredForRevision =
        draft.mappingCardDelivery?.messageId !== undefined &&
        draft.mappingCardDelivery.revision === draft.task.revision;
      // Several source roles can be recognized for the same revision. Do not
      // append another progress card for each terminal run; the last run sends
      // the single latest card after the whole recognition batch has settled.
      if (
        !deliveredForRevision &&
        !hasPendingAiRecognition(updated) &&
        updated.task.sources.couponTable &&
        updated.task.sources.whitelist
      ) {
        await dependencies.deliverMappingCard({
          draft: updated,
          idempotencyKey,
        });
      }
    },
  };
}

export const feishuCouponAiSourceLoader: CouponAiSourceLoader = {
  async load(run: CouponAiRecognitionRun) {
    const messageId = run.sourceReference.messageId;
    const fileKey = run.sourceReference.fileKey;
    if (typeof messageId !== "string" || typeof fileKey !== "string") {
      throw new Error("AI source reference is invalid");
    }
    const bytes = await downloadFeishuMessageResource({
      messageId,
      fileKey,
      type: "file",
    });
    return { fileName: run.sourceFileName, bytes };
  },
};
