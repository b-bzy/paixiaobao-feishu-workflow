import type { CouponAiTextProjector } from "../../../control-plane/coupon-ai-text-effect";
import { deliverCouponThreeSourceMappingCard } from "./mapping-card-delivery";
import {
  getCouponThreeSourcePilotDraft,
  updateCouponThreeSourcePilotDraft,
} from "./store";

export interface CouponAiTextProjectionDependencies {
  getDraft: typeof getCouponThreeSourcePilotDraft;
  updateDraft: typeof updateCouponThreeSourcePilotDraft;
  deliverMappingCard: typeof deliverCouponThreeSourceMappingCard;
}

const defaults: CouponAiTextProjectionDependencies = {
  getDraft: getCouponThreeSourcePilotDraft,
  updateDraft: updateCouponThreeSourcePilotDraft,
  deliverMappingCard: deliverCouponThreeSourceMappingCard,
};

function hasOwnerValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => String(item).trim());
  if (typeof value === "string") return Boolean(value.trim());
  return value !== undefined && value !== null;
}

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
          ? (() => {
              const replaceKeys = new Set<string>(
                draft.supplementRecognition?.replaceOwnerFieldKeys ?? [],
              );
              const returnedKeys = new Set(Object.keys(run.result.fields));
              const preserved = Object.fromEntries(
                Object.entries(draft.selections.ownerFieldValues ?? {}).filter(
                  ([key, value]) =>
                    hasOwnerValue(value) &&
                    (!replaceKeys.has(key) || !returnedKeys.has(key)),
                ),
              );
              return { ...run.result.fields, ...preserved };
            })()
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
                  ...draft.validationIssues.filter((issue) => {
                    if (issue.startsWith("补充说明识别")) return false;
                    const key = issue.match(/^输入校验\[([^\]]+)\]：/)?.[1];
                    return (
                      !key || !Object.hasOwn(run.result?.fields ?? {}, key)
                    );
                  }),
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
      await dependencies.deliverMappingCard({
        draft: updated,
        idempotencyKey,
      });
    },
  };
}
