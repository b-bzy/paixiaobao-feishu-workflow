---
name: p0-preview-deploy
description: Deploy, verify, start, inspect, or stop the protected Vercel Preview and local bridge/worker used by the three-source coupon P0 test flow. Use for requests to deploy the P0 branch, prepare Feishu manual testing, check whether its callback service is online, or stop the local P0 test chain. Do not use for Production, managed R1 bridge rollout, native OA enablement, secret rotation, or resource deletion.
---

# P0 Preview 快速部署

Operate only in the repository root and preserve unrelated working-tree changes.

## Route the request

- Read-only diagnosis or “is it online?”: run `pnpm p0:preview:status`. If no state exists, run `pnpm p0:preview:check` only when the user wants readiness diagnosis.
- Validate before a future deployment: run `pnpm p0:preview:check`.
- Explicitly deploy a Preview without starting Feishu consumers: run `pnpm p0:preview:deploy`.
- Explicitly deploy and prepare manual Feishu testing: run `pnpm p0:preview:up`.
- Stop the test chain: run `pnpm p0:preview:down`.

Deployment and `up` mutate external Vercel state. Execute them only when the user explicitly asks to deploy or start testing. An authorization applies to the requested operation, not Production, secret rotation, Gate changes, deletion, or native OA.

## Required outcomes

- The branch must be `p0-three-source-direct-http` and the working tree must be reproducible and clean.
- The deployment identity endpoint must return the exact full local Git SHA before a consumer starts.
- Protection Bypass is sent as `x-vercel-protection-bypass`; never place it in a URL.
- One bridge and one worker may run. Never recreate the old URL-hardcoded relay or a handwritten tick loop.
- Logs and replies may show a hostname, short SHA, status, and error code, but never secrets, tokens, database URLs, full Open IDs, file keys, or event payloads.
- “Deployed” and “processes online” do not mean Feishu E2E or OA success. Tell the user when manual Feishu testing may begin, and state that it is still pending.

## Stop conditions

Stop without blind retries on identity mismatch, protection failure, dirty checkout, duplicate consumer, bridge/worker early exit, unknown external outcome, native-submit enabled, or an unexpected environment. Preserve diagnostic state unless `down` safely verifies and stops the owned processes.

For first-time setup, read [references/configuration.md](references/configuration.md). For a failed command, read [references/troubleshooting.md](references/troubleshooting.md) and follow only the matching failure path.
