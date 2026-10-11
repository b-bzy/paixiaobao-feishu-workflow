import type { CouponAiTextProjector } from "../../../control-plane/coupon-ai-text-effect";
import { sendFeishuCard } from "../../client";
import { buildCouponThreeSourceMappingCard } from "./cards";
import {
  getCouponThreeSourcePilotDraft,
  updateCouponThreeSourcePilotDraft,
} from "./store";

export interface CouponAiTextProjectionDependencies {
  getDraft: typeof getCouponThreeSourcePilotDraft;
  updateDraft: typeof updateCouponThreeSourcePilotDraft;
  sendCard: typeof sendFeishuCard;
}

const defaults: CouponAiTextProjectionDependencies = {
  getDraft: getCouponThreeSourcePilotDraft,
  updateDraft: updateCouponThreeSourcePilotDraft,
  sendCard: sendFeishuCard,
};

export function createCouponAiTextProjector(
  dependencies: CouponAiTextProjectionDependencies = defaults,
): CouponAiTextProjector {
  return {
    async project({ run, idempotencyKey }) {
      const draft = await dependencies.getDraft(run.pilotRecordId);
      if (
        draft.ownerOpenId !== run.ownerOpenId ||
        draft.task.taskId !== run.businessTaskId ||
        draft.task.revision !== run.revision ||
        draft.supplementRecognition?.runId !== run.id ||
        draft.supplementRecognition.textSha256 !== run.textSha256
      ) {
        return;
      }
      const mergedOwnerValues =
        run.status === "succeeded" && run.result
          ? {
              ...run.result.fields,
              ...draft.selections.ownerFieldValues,
            }
          : draft.selections.ownerFieldValues;
      const updated = await dependencies.updateDraft(
        draft,
        {
          supplementRecognition: {
            ...draft.supplementRecognition,
            status: run.status,
            result: run.result,
            audit: run.audit,
            fallbackCode: run.fallbackCode,
          },
          selections: {
            ...draft.selections,
            ownerFieldValues: mergedOwnerValues,
          },
          validationIssues:
            run.status === "succeeded"
              ? [
                  ...draft.validationIssues.filter(
                    (issue) => !issue.startsWith("补充说明识别"),
                  ),
                  ...(run.result?.warnings.map(
                    (warning) => `补充说明识别提示：${warning}`,
                  ) ?? []),
                ]
              : [
                  ...draft.validationIssues.filter(
                    (issue) => !issue.startsWith("补充说明识别"),
                  ),
                  "补充说明识别失败，请直接在字段中修改后提交",
                ],
        },
        run.revision,
      );
      await dependencies.sendCard(
        run.ownerOpenId,
        buildCouponThreeSourceMappingCard(updated),
        idempotencyKey,
      );
    },
  };
}
