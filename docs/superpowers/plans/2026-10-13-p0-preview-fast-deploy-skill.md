# P0 Preview Fast Deploy Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a repository-level Skill and deterministic commands that validate, deploy, verify, start, inspect, and stop the protected P0 Preview test chain without manually editing deployment URLs.

**Architecture:** A small Node orchestration layer wraps the existing Vercel CLI, deployment-identity verifier, bridge, and worker. Secrets stay in a mode-0600 ignored local env file; only non-sensitive deployment/process state is persisted, and the Skill routes user intent to tested commands without embedding operational secrets or mutable URLs.

**Tech Stack:** Node.js ESM, pnpm scripts, Vercel CLI, Vitest, existing P0 bridge/worker runtime, Codex project Skill format.

**Spec:** `docs/superpowers/specs/2026-10-13-p0-preview-fast-deploy-skill-design.md`

## Global Constraints

- Scope is the `p0-three-source-direct-http` Preview draft-only path under ADR-0010, never Production or an R1 managed-bridge claim.
- Do not store secrets in source, state JSON, stdout/stderr, docs, snapshots, command arguments, or chat.
- Use the `x-vercel-protection-bypass` header; never put the bypass secret in the URL.
- Every deploy/start must verify the full 40-character deployed Git SHA before starting a consumer or worker.
- Never infer OA, Base, Drive, or Feishu E2E success from deployment, HTTP 2xx, or process startup.
- Preserve unrelated working-tree changes; do not reset, overwrite, stage, or commit them. Do not create commits unless the user separately authorizes commits.
- Real Vercel deployment is a final smoke requiring explicit Preview deployment authorization; unit tests use fakes only.

## Review Focus

- A successful CLI exit with empty or ambiguous stdout must not select a guessed deployment URL; covered by Task 2.
- A valid URL serving a different Git SHA must never start bridge/worker or overwrite the active state; covered by Tasks 2 and 4.
- A PID reused by an unrelated process must not be killed by `down`; covered by Task 3.
- Secrets containing shell metacharacters must be passed through process environment without interpolation or logging; covered by Tasks 1 and 3.
- A partial `up` where bridge starts and worker fails must stop only the just-started bridge and leave external resources/Gates unchanged; covered by Task 4.

---

### Task 1: Add secure local configuration and atomic state handling

**Files:**
- Create: `scripts/lib/p0-preview-config.mjs`
- Create: `scripts/lib/p0-preview-config.test.mjs`
- Modify: `.gitignore`
- Modify: `.env.example`

**Interfaces:**
- Produces: `loadP0PreviewConfig({ path, statImpl, readFileImpl }): P0PreviewConfig`, `readP0PreviewState(path): Promise<P0PreviewState | undefined>`, `writeP0PreviewState(path, state): Promise<void>`, and `clearP0PreviewState(path): Promise<void>`.
- Consumes: `.local/p0-preview.env` and `.local/p0-preview-state.json`.

- [ ] **Step 1: Write failing config/state tests**

Cover required key presence, quoted values and shell metacharacters, duplicate keys, files more permissive than `0600`, secret redaction, absent state, malformed state, state schema version, atomic rename, and ensuring state never accepts secret fields.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test scripts/lib/p0-preview-config.test.mjs`

- [ ] **Step 3: Implement the config parser and typed state schema**

Parse dotenv-compatible scalar values without evaluating shell syntax. Required local values are `FEISHU_BRIDGE_KEY_ID`, `FEISHU_BRIDGE_SHARED_SECRET`, `CONTROL_PLANE_TICK_TOKEN`, and `VERCEL_AUTOMATION_BYPASS_SECRET`. Validate key ID and minimum shared-secret length using the same constraints as the existing bridge runtime.

- [ ] **Step 4: Add ignored local paths and non-secret examples**

Ignore `.local/`. Document variable names and intended scopes in `.env.example` using placeholders only.

- [ ] **Step 5: Run focused tests**

Run: `node --test scripts/lib/p0-preview-config.test.mjs`

Expected: PASS.

### Task 2: Wrap Vercel Preview deployment and identity/health verification

**Files:**
- Create: `scripts/lib/p0-preview-deploy.mjs`
- Create: `scripts/lib/p0-preview-deploy.test.mjs`
- Reuse: `scripts/lib/p0-deployment-identity.mjs`

**Interfaces:**
- Consumes: injected `runCommand`, `fetchImpl`, repository path, branch, expected Git SHA, project identity, and bypass secret.
- Produces: `deployP0Preview(input): Promise<{ deploymentUrl: string; gitCommitSha: string }>` and `verifyP0PreviewHealth(input): Promise<P0PreviewHealth>`.

- [ ] **Step 1: Write failing deployment tests**

Cover correct single stdout URL, empty output, multiple URLs, non-zero exit, HTTP/non-Vercel URL rejection, explicit Git branch metadata, bypass header presence, secret absence from URL/logs, identity timeout/HTTP/JSON/SHA mismatch, and stage/native-kill-switch/required-Gate failure.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test scripts/lib/p0-preview-deploy.test.mjs`

- [ ] **Step 3: Implement `deployP0Preview`**

Invoke Vercel without a shell, capture stdout separately, and pass metadata for `p0-three-source-direct-http` plus the expected revision. Accept exactly one valid HTTPS `*.vercel.app` URL and never parse stderr progress text.

- [ ] **Step 4: Implement identity and health verification**

Delegate SHA verification to `verifyP0DeploymentIdentity`. Read only the minimum existing diagnostics needed to assert `local` stage, native submit disabled, and configured P0 Gate state; return a redacted health object.

- [ ] **Step 5: Run deployment and existing identity tests**

Run: `node --test scripts/lib/p0-preview-deploy.test.mjs scripts/lib/p0-deployment-identity.test.mjs`

Expected: PASS.

### Task 3: Add guarded bridge/worker process lifecycle

**Files:**
- Create: `scripts/lib/p0-preview-processes.mjs`
- Create: `scripts/lib/p0-preview-processes.test.mjs`
- Reuse: `scripts/lib/p0-worker-process-guard.mjs`
- Reuse: `scripts/long-connection-bridge.mjs`
- Reuse: `scripts/run-p0-control-plane-worker.mjs`

**Interfaces:**
- Consumes: verified URL/SHA, secure config, existing state, and injected process adapters.
- Produces: `startP0Processes(input): Promise<P0ProcessState>`, `inspectP0Processes(input): Promise<P0ProcessStatus>`, and `stopP0Processes(input): Promise<void>`.

- [ ] **Step 1: Write failing lifecycle tests**

Cover direct HTTPS target injection, bypass/bridge/tick tokens only in child env, bridge and worker readiness, duplicate bridge/worker/relay/curl-loop detection, child early exit, worker-start rollback, PID reuse, process fingerprint mismatch, timeout, signal escalation limited to owned children, and idempotent stop.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test scripts/lib/p0-preview-processes.test.mjs`

- [ ] **Step 3: Implement guarded start and status**

Spawn Node entrypoints directly with `shell: false`; construct child env objects without logging them. A process becomes owned only after its readiness line and fingerprint are verified.

- [ ] **Step 4: Implement safe stop**

Before signaling, compare PID start identity and expected command fingerprint. Refuse to signal mismatches. Stop worker and bridge with bounded waits and clear only matched state entries.

- [ ] **Step 5: Run process and existing guard/runtime tests**

Run: `node --test scripts/lib/p0-preview-processes.test.mjs scripts/lib/p0-worker-process-guard.test.mjs scripts/lib/long-connection-bridge-runtime.test.mjs`

Expected: PASS.

### Task 4: Add `check`, `deploy`, `up`, `status`, and `down` CLI commands

**Files:**
- Create: `scripts/p0-preview.mjs`
- Create: `scripts/p0-preview.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Tasks 1–3 modules and injected adapters in tests.
- Produces: five pnpm commands with structured exit codes and redacted user-facing summaries.

- [ ] **Step 1: Write failing command-orchestration tests**

Assert command routing, branch/project/SHA/dirty-tree checks, `check` read-only behavior, same-SHA deployment reuse, different-SHA deployment, atomic state activation only after verification, partial-up rollback, status drift detection, down idempotency, Ctrl-C cleanup, and that no output contains fixture secrets.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test scripts/p0-preview.test.mjs`

- [ ] **Step 3: Implement the CLI with explicit adapters**

`check` runs repository gates without mutation. `deploy` performs Preview deployment only after checks. `up` reuses a healthy same-SHA state or deploys, then starts both processes. `status` is read-only. `down` stops only owned processes. Unknown commands exit non-zero with usage.

- [ ] **Step 4: Add package scripts**

Map `p0:preview:check`, `p0:preview:deploy`, `p0:preview:up`, `p0:preview:status`, and `p0:preview:down` to the single CLI entrypoint.

- [ ] **Step 5: Run orchestration tests and local read-only smoke**

Run: `node --test scripts/p0-preview.test.mjs && pnpm p0:preview:status`

Expected: tests pass; status either reports no configured session or a redacted verified status without mutating external systems.

### Task 5: Create and validate the repository Skill

**Files:**
- Create: `.agents/skills/p0-preview-deploy/SKILL.md`
- Create: `.agents/skills/p0-preview-deploy/agents/openai.yaml`
- Create: `.agents/skills/p0-preview-deploy/references/configuration.md`
- Create: `.agents/skills/p0-preview-deploy/references/troubleshooting.md`

**Interfaces:**
- Consumes: package commands from Task 4 and the current P0 runbook.
- Produces: automatically discoverable `p0-preview-deploy` Skill.

- [ ] **Step 1: Initialize the Skill with only needed resources**

Use the bundled `skill-creator` initializer for `scripts`-free Skill scaffolding with references. Keep implicit discovery enabled.

- [ ] **Step 2: Write concise routing and mutation boundaries**

Map status/diagnosis requests to `status` or `check`, explicit Preview deployment requests to `deploy`, and “deploy and start Feishu test” to `up`. Require separate explicit scope for Production, secret rotation, Gate changes, deletion, or native OA.

- [ ] **Step 3: Write configuration and troubleshooting references**

Document one-time Vercel branch variables, `.local/p0-preview.env` permissions, failure codes, rollback/stop behavior, and why relay recreation is forbidden. Include placeholders only.

- [ ] **Step 4: Validate Skill structure and scan for secrets/placeholders**

Run: `python /Users/jacob/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/p0-preview-deploy && rg -n "TBD|TODO|<secret>|vercel\.app" .agents/skills/p0-preview-deploy`

Expected: validator passes; scan contains no unfinished scaffold, real secret, or mutable deployment URL.

### Task 6: Update runbook and verify the whole local toolchain

**Files:**
- Modify: `README.md`
- Modify: `docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md`
- Modify: `docs/oa-ticket-reimbursement-materials/current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md`

**Interfaces:**
- Consumes: completed CLI and Skill.
- Produces: one documented supported path for local P0 Preview iteration.

- [ ] **Step 1: Replace manual URL/relay instructions with the new command flow**

Keep first-time secret configuration separate from daily deploy/up/status/down usage. State that deployment/start success is not Feishu E2E success and that local P0 remains time-boxed.

- [ ] **Step 2: Document stop and recovery conditions**

Preserve native-submit false, single consumer, fail-closed identity mismatch, no blind retries after unknown external outcomes, and manual Feishu E2E ownership.

- [ ] **Step 3: Run all local automated verification**

Run: `node --test scripts/lib/p0-preview-config.test.mjs scripts/lib/p0-preview-deploy.test.mjs scripts/lib/p0-preview-processes.test.mjs scripts/p0-preview.test.mjs && pnpm typecheck && pnpm lint && pnpm build && git diff --check`

Expected: PASS. If full lint reports pre-existing unrelated failures, run Biome on all changed files and report the unrelated baseline without weakening checks.

- [ ] **Step 4: Perform a separately authorized Preview smoke**

Run `pnpm p0:preview:deploy`, verify the returned deployment identity and redacted health, then run `pnpm p0:preview:up`, `pnpm p0:preview:status`, and `pnpm p0:preview:down`. Do not send a Feishu message or click a card as part of this tooling smoke.

Expected: a protected Preview tied to the exact SHA; one bridge and one worker start; status is redacted; down stops only owned processes. Any failure stops before consumer startup or rolls back locally started children.
