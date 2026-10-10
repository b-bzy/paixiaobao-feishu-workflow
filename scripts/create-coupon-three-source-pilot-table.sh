#!/usr/bin/env zsh
set -euo pipefail

: "${FEISHU_COUPON_THREE_SOURCE_PILOT_BASE_APP_TOKEN:?Set FEISHU_COUPON_THREE_SOURCE_PILOT_BASE_APP_TOKEN to the dedicated three-source pilot Base app token.}"

lark-cli base +table-create \
  --base-token "$FEISHU_COUPON_THREE_SOURCE_PILOT_BASE_APP_TOKEN" \
  --name "优惠券三源提报试点" \
  --fields @docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-three-source-pilot-base-fields-v1.json \
  --as bot \
  --format json
