#!/usr/bin/env zsh
set -euo pipefail

repo_root="${0:A:h:h}"
manifest="$repo_root/docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-three-source-pilot-base-fields-v1.json"

lark-cli base +base-create \
  --as bot \
  --name "优惠券三源提报-R3单用户试点-20261009" \
  --time-zone Asia/Shanghai \
  --table-name "优惠券三源提报试点" \
  --fields "@$manifest"
