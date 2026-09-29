#!/usr/bin/env zsh
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
env_file="$project_root/.env.local"

if [[ ! -f "$env_file" ]]; then
  print -u2 "Missing .env.local. Copy .env.example locally and fill only the required Base demo values."
  exit 1
fi

set -a
source "$env_file"
set +a

if [[ "${FEISHU_COUPON_OA_MODE:-}" != "draft-demo" ]]; then
  print -u2 "FEISHU_COUPON_OA_MODE must be draft-demo for this local Base-only test."
  exit 1
fi

if [[ -n "${FEISHU_VERIFICATION_TOKEN:-}" ]]; then
  print -u2 "FEISHU_VERIFICATION_TOKEN must be unset for lark-cli long-connection events."
  exit 1
fi

required=(
  FEISHU_APP_ID
  FEISHU_APP_SECRET
  FEISHU_BASE_APP_TOKEN
  FEISHU_COUPON_DRAFT_TABLE_ID
)
missing=()
for name in "${required[@]}"; do
  if [[ -z "${(P)name:-}" ]]; then
    missing+=("$name")
  fi
done

if (( ${#missing[@]} > 0 )); then
  print -u2 "Missing local configuration: ${(j:, :)missing}"
  exit 1
fi

print "Local Draft Demo configuration is ready. No values were printed."
print "Terminal 1: pnpm dev"
print "Terminal 2: FEISHU_PROCESS_URL=http://localhost:3000/api/feishu/process pnpm dev:events"
print "Expected bridge target: http://localhost:3000/api/feishu/process"
print "This mode writes fixed card fields to Base only; it will not accept attachments or create OA."
