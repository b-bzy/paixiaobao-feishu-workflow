import { sendFeishuCardWithReceipt, updateFeishuCard } from "../../client";
import { buildCouponThreeSourceMappingCard } from "./cards";
import {
  type CouponThreeSourcePilotDraft,
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
  if (prior?.revision === input.draft.task.revision) {
    await dependencies.updateCard(prior.messageId, card);
    return input.draft;
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
      },
    },
    input.draft.task.revision,
  );
}
