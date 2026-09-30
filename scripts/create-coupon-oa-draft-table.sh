#!/usr/bin/env zsh
set -euo pipefail

lark-cli base +table-create \
  --base-token KXJzbs2HeaCeifsOdbpcT9j9nMh \
  --name "优惠券提单草稿" \
  --fields @docs/oa-ticket-reimbursement-materials/implementation/coupon-oa-draft-base-fields-v1.json \
  --as user \
  --format json
