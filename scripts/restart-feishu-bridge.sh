#!/usr/bin/env zsh
set -euo pipefail

pids=("${(@f)$(pgrep -f 'node scripts/long-connection-bridge\.mjs' || true)}")
if (( ${#pids[@]} > 0 )); then
  kill "${pids[@]}"
  sleep 1
fi

nohup node scripts/long-connection-bridge.mjs \
  > /tmp/aihuishou-feishu-bridge.log \
  2>&1 &

print "Feishu bridge restarted (PID $!)."
print "Log file: /tmp/aihuishou-feishu-bridge.log"
