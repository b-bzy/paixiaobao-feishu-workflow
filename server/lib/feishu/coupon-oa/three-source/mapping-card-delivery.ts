import { sendFeishuCardWithReceipt, updateFeishuCard } from "../../client";
import { buildCouponThreeSourceMappingCard } from "./cards";
import {
  type CouponThreeSourcePilotDraft,
  computeCouponThreeSourceMappingContextHash,
  updateCouponThreeSourcePilotDraft,
} from "./store";

export interface CouponThreeSourceMappingCardDeliveryDependencies {
  createCard: typeof sendFeishuCardWithReceipt;
  updateCard: typeof updateFeishuCard;
  updateDraft: typeof updateCouponThreeSourcePilotDraft;
}

const defaults: CouponThreeSourceMappingCardDeliveryDependencies = {
  createCard: sendFeishuCardWithReceipt,
  updateCard: updateFeishuCard,
  updateDraft: updateCouponThreeSourcePilotDraft,
};

export async function deliverCouponThreeSourceMappingCard(
  input: {
    draft: CouponThreeSourcePilotDraft;
    idempotencyKey?: string;
  },
  dependencies: CouponThreeSourceMappingCardDeliveryDependencies = defaults,
): Promise<CouponThreeSourcePilotDraft> {
  const card = buildCouponThreeSourceMappingCard(input.draft);
  const prior = input.draft.mappingCardDelivery;
  const contextHash = computeCouponThreeSourceMappingContextHash(input.draft);
  if (prior?.revision === input.draft.task.revision) {
    await dependencies.updateCard(prior.messageId, card);
    if (prior.contextHash === contextHash) return input.draft;
    return dependencies.updateDraft(
      input.draft,
      {
        mappingCardDelivery: {
          ...prior,
          contextHash,
        },
      },
      input.draft.task.revision,
    );
  }
  const receipt = await dependencies.createCard(
    input.draft.ownerOpenId,
    card,
    input.idempotencyKey,
  );
  return dependencies.updateDraft(
    input.draft,
    {
      mappingCardDelivery: {
        messageId: receipt.messageId,
        revision: input.draft.task.revision,
        contextHash,
      },
    },
    input.draft.task.revision,
  );
}
