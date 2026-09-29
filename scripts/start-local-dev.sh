#!/usr/bin/env zsh
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
env_file="$project_root/.env.local"

if [[ -f "$env_file" ]]; then
  set -a
  source "$env_file"
  set +a
fi

cd "$project_root"
exec "$project_root/node_modules/.bin/nitro" dev
