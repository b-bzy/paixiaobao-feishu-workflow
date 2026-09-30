#!/usr/bin/env zsh
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
env_file="$project_root/.env.local"

if [[ -f "$env_file" ]]; then
  # Explicit values supplied by the caller must win over local defaults.
  # Record variables already present in the process environment before
  # sourcing .env.local, then restore them afterwards.
  typeset -A inherited_values
  typeset -a inherited_names
  while IFS= read -r line; do
    line="${line#export }"
    key="${line%%=*}"
    key="${key//[[:space:]]/}"
    if [[ "$key" =~ '^[A-Za-z_][A-Za-z0-9_]*$' ]] &&
      (( ${+parameters[$key]} )); then
      inherited_names+=("$key")
      inherited_values[$key]="${(P)key}"
    fi
  done < "$env_file"

  set -a
  source "$env_file"
  set +a

  for key in "${inherited_names[@]}"; do
    export "$key=${inherited_values[$key]}"
  done
fi

cd "$project_root"
exec "$project_root/node_modules/.bin/nitro" dev
