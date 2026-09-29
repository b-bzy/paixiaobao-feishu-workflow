#!/usr/bin/env zsh
set -euo pipefail

printf '%s\n' 'tblq0cZ9cW2AmDTH' |
  npx -y vercel@latest env add FEISHU_COUPON_DRAFT_TABLE_ID production

printf '%s\n' '34F3F8E4-90D9-4A3C-8C61-F05D97FD0941' |
  npx -y vercel@latest env add FEISHU_COUPON_OA_APPROVAL_CODE production
