# Feishu Dev Delivery Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Reconcile every three-source proposal into one sequential FDEV delivery workflow, with unambiguous R1-dev terminology, independent test-agent handoffs, and an auditable FDEV-001 baseline gate.

**Architecture:** The requirements tracker becomes the canonical state machine for FDEV work. The release plan, risk backlog, technical design, test plan, proposal index, and cross-product backlog become derived views that link back to the tracker and use the same ring names and dependencies. A new FDEV-001 evidence template records a release candidate without changing runtime behavior, secrets, or feature flags.

**Tech Stack:** Markdown documentation, existing Vitest/TypeScript validation commands, PostgreSQL integration evidence already present in the repository.

**Spec:** `docs/superpowers/specs/2026-10-09-feishu-dev-delivery-governance-design.md`

## Global Constraints

- `R1-dev` is a release/acceptance ring mapped to `FEISHU_RUNTIME_STAGE=r1-intake`; do not add an `r1-dev` runtime-stage string.
- Formal `R2` remains the full draft-only file/material flow and exclusively maps to `r2-draft-only`.
- No task may enable a feature flag, deploy, create cloud resources, alter secrets, invoke real Feishu, or create an OA instance.
- Each FDEV/FDEV sub-requirement must complete: requirement → design → implementation → new Test-Plan Agent → local/isolated test → bug fixes → 🥇 → next requirement.
- The Test-Plan Agent and QA/Test Agent use isolated worktrees; only the Lead integrates shared contracts, migrations, secrets, environment configuration, bridge/scheduler startup, real Feishu tests, or deployment.
- FDEV-001 must become 🥇 before any FDEV-002+ implementation starts from a release baseline.
- Do not create a git commit or tag unless the user explicitly asks for one.

## Review Focus

- **R2-dev occurrence:** Task 2 must search every proposal and ensure command-to-card is called R1-dev; formal R2 semantics must remain unchanged.
- **Circular prerequisite:** Task 2 must prove FDEV-005 does not need real event consumption and FDEV-006 is the first real Dev Bot event requirement.
- **Granularity regression:** Task 1 must ensure CP-RISK-002 through CP-RISK-006 each map to exactly one independently 🥇-able FDEV sub-requirement.
- **Test-agent bypass:** Task 1 and Task 3 must require a fresh Test-Plan Agent at step 4 and prevent it from changing shared migration/secret/feature settings.
- **Baseline misrepresentation:** Task 4 must state that the FDEV-001 artifact is a candidate template until a clean revision/commit/tag and repeatable evidence exist.

---

## File Structure

| File | Responsibility after this plan |
| --- | --- |
| `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-dev-requirements-tracker-v1.md` | Canonical FDEV/sub-requirement state, eight-step workflow, agent handoff and 🥇 prerequisite. |
| `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-dev-command-intake-release-plan-v1.md` | Derived release-ring plan; uses R1-dev and removes the FDEV-005 circular prerequisite. |
| `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-durable-control-plane-risk-remediation-backlog-v1.md` | CP-RISK-to-FDEV mapping and risk-specific acceptance requirements. |
| `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-durable-command-intake-worker-design-v1.md` | Technical scope boundary; differentiates R1-dev command/card from formal R2 material flow. |
| `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-durable-command-intake-worker-test-plan-v1.md` | Test-agent inputs, already-proven PostgreSQL evidence and remaining HTTP/bridge/Dev Bot tests. |
| `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-unified-skill-upgrade-plan-v1.md` | W/Ring terminology alignment; no command-only canary presented as formal R2. |
| `docs/oa-ticket-reimbursement-materials/records/durable-control-plane/fdev-001-dev-release-baseline-v1.md` | New non-Golden candidate manifest/evidence template for FDEV-001. |
| `docs/oa-ticket-reimbursement-materials/proposals/README.md` and `docs/requirements-backlog.md` | Navigation and cross-product dependency views. |

### Task 1: Make the FDEV tracker the canonical sequential workflow

**Files:**
- Modify: `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-dev-requirements-tracker-v1.md`
- Modify: `docs/requirements-backlog.md`

**Interfaces:**
- Consumes: CP-RISK IDs from `coupon-oa-durable-control-plane-risk-remediation-backlog-v1.md` and the ring definitions from the approved spec.
- Produces: Stable FDEV/FDEV-subrequirement IDs and canonical statuses that all later documentation references.

- [x] **Step 1: Define the testable tracker invariants before editing**

Write the expected ID/order matrix in the tracker’s “current requirements queue” section:

```text
FDEV-001 → FDEV-002 → FDEV-003A → FDEV-003B → FDEV-004A → FDEV-004B → FDEV-004C → FDEV-005 → FDEV-006 → FDEV-007 → FDEV-008
```

Each row must state current step, single CP-RISK mapping where applicable, predecessor 🥇 condition, and the Test-Plan Agent handoff at step 4.

- [x] **Step 2: Add the granular FDEV rows and eight-step delivery fields**

Replace the aggregate FDEV-003/FDEV-004 queue rows with independent `FDEV-003A`, `FDEV-003B`, `FDEV-004A`, `FDEV-004B`, and `FDEV-004C` rows. Keep `FDEV-001`, `FDEV-002`, `FDEV-005` through `FDEV-008` as stable IDs. For each entry specify the matching CP-RISK ID, allowed/forbidden side effects, 🥇 evidence, and direct successor.

- [x] **Step 3: State the Test-Plan Agent and QA/Test Agent worktree contract in the tracker**

Make step 4 a hard handoff to a fresh Test-Plan Agent. Make step 5 a separate QA/Test worktree execution stage. State that neither may alter shared migrations, secrets, feature/kill switches, Dev App configuration, or real Feishu settings.

- [x] **Step 4: Update the cross-product backlog index**

Add or revise the CP-BL rows so every CP-RISK range links to its granular FDEV ID instead of a broad aggregate phase. Preserve the existing business backlog entries unchanged.

- [x] **Step 5: Validate the tracker invariant**

Run:

```bash
rg -n 'FDEV-003A|FDEV-003B|FDEV-004A|FDEV-004B|FDEV-004C|Test-Plan Agent|🥇' \
  docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-dev-requirements-tracker-v1.md
```

Expected: every granular requirement, the step-4 handoff, and the 🥇 gate appear exactly as the new workflow requires.

### Task 2: Rename the command-to-card release ring and remove the FDEV-005 cycle

**Files:**
- Modify: `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-dev-command-intake-release-plan-v1.md`
- Modify: `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-unified-skill-upgrade-plan-v1.md`
- Modify: `docs/oa-ticket-reimbursement-materials/proposals/README.md`

**Interfaces:**
- Consumes: the canonical tracker order from Task 1.
- Produces: consistent R1-dev terminology and a non-circular Dev environment/rehearsal sequence.

- [x] **Step 1: Add a documentation search check for the naming conflict**

Run:

```bash
rg -n 'R2-dev|R1-dev|FDEV-005|FDEV-006' \
  docs/oa-ticket-reimbursement-materials/proposals
```

Record each existing command-to-card occurrence that needs conversion; do not rename formal R2 draft-only material-flow references.

- [x] **Step 2: Rewrite the release plan’s title, scope and gate names to R1-dev**

Rename “R2-dev command-intake” to “R1-dev command-to-card” throughout the release plan. Define R1-dev as a release ring that uses `r1-intake` plus future independent Dev command/card gates; explicitly prohibit `r2-draft-only` and object-store/renderer/material capabilities in this ring.

- [x] **Step 3: Split FDEV-005 environment preflight from FDEV-006 real-event rehearsal**

Make FDEV-005 require configuration readiness only: separate Dev App identity, PostgreSQL, secret store, bridge host, scheduler, route/network policy, allowlist and kill switch with bridge consumption disabled. Move Shadow/Dark-task/card canary event consumption to FDEV-006 after FDEV-005 🥇.

- [x] **Step 4: Align the unified upgrade plan and proposal index**

Retain formal R2 as the full draft-only file/material ring in the unified plan. Add a short reference to R1-dev as a pre-R2 Dev command/card validation ring. Update the proposal index statuses and links to point to the tracker as the canonical sequence.

- [x] **Step 5: Verify terminology and dependency behavior**

Run:

```bash
rg -n 'R2-dev' docs/oa-ticket-reimbursement-materials/proposals
rg -n 'R1-dev|r1-intake|R2.*draft-only|FDEV-005|FDEV-006' \
  docs/oa-ticket-reimbursement-materials/proposals/three-source
```

Expected: no command-to-card reference remains named R2-dev; FDEV-005 has no real event-consumption requirement; formal R2 continues to mean the material/file flow.

### Task 3: Map risk remediation and test planning to the new delivery gates

**Files:**
- Modify: `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-durable-control-plane-risk-remediation-backlog-v1.md`
- Modify: `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-durable-command-intake-worker-design-v1.md`
- Modify: `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-durable-command-intake-worker-test-plan-v1.md`

**Interfaces:**
- Consumes: Task 1’s FDEV/subrequirement IDs and Task 2’s R1-dev semantics.
- Produces: CP-RISK requirements, design boundaries and test matrices whose scope and evidence are consistent.

- [x] **Step 1: Map each CP-RISK to a single FDEV or FDEV sub-requirement**

Add an explicit mapping table:

```text
CP-RISK-001 → FDEV-002
CP-RISK-002 → FDEV-003A
CP-RISK-003 → FDEV-003B
CP-RISK-004 → FDEV-004A
CP-RISK-005 → FDEV-004B
CP-RISK-006 → FDEV-004C
CP-RISK-007/008 → FDEV-007 prerequisites
```

For every row, make “fresh Test-Plan Agent at step 4” a prerequisite for 🥇.

- [x] **Step 2: Correct evidence status in design and test-plan documents**

Describe the existing local PostgreSQL evidence precisely: migration repeatability, delivery dedupe, task/effect transaction, concurrent owner handling, `SKIP LOCKED`, stale fencing, fake card success, and `outcome_unknown` restart no-resend are verified. Keep HTTP rehearsal, durable bridge ACK, long-running worker, real card behavior, object storage and Dev Bot E2E explicitly unverified.

- [x] **Step 3: Add the per-requirement test-agent input/output contract**

The worker test plan must require a Test-Plan Agent handoff after implementation freeze. Its output must include a case matrix, expected side-effect count, failure/rollback model, required local/PostgreSQL/HTTP/Dev-Bot evidence, and a list of untestable external gates. QA/Test output must include actual commands, revision, environment, exit code, duration, result and remaining risk.

- [x] **Step 4: Preserve the formal R2 boundary**

In both design and test plan, state that R1-dev command/card testing cannot access files, Base/Drive, object storage, renderer, approval attachments or OA. Do not change the formal R2/R3 acceptance matrices beyond cross-links to the tracker.

- [x] **Step 5: Validate mapping and evidence consistency**

Run:

```bash
rg -n 'CP-RISK-00[1-8]|FDEV-003A|FDEV-004A|Test-Plan Agent|R1-dev' \
  docs/oa-ticket-reimbursement-materials/proposals/three-source
```

Expected: each CP-RISK has exactly one delivery owner and no document claims real Feishu/bridge/OA proof from local PostgreSQL tests.

### Task 4: Create the FDEV-001 baseline evidence artifact and wire navigation

**Files:**
- Create: `docs/oa-ticket-reimbursement-materials/records/durable-control-plane/fdev-001-dev-release-baseline-v1.md`
- Modify: `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-dev-requirements-tracker-v1.md`
- Modify: `docs/oa-ticket-reimbursement-materials/proposals/README.md`
- Modify: `docs/oa-ticket-reimbursement-materials/records/durable-control-plane/coupon-r2-foundation-verification-2026-10-09.md`

**Interfaces:**
- Consumes: Task 1 tracker state and existing verification record evidence.
- Produces: a candidate-only baseline manifest that FDEV-001 owners can fill once a clean revision is approved.

- [x] **Step 1: Create a FDEV-001 candidate manifest template**

Include fixed fields for:

```text
candidate revision / commit / tag
working-tree cleanliness evidence
git diff --check
Node / pnpm / PostgreSQL / Docker image versions
lockfile digest
migration filenames and SHA-256 values
full test, server typecheck, build, PostgreSQL integration commands/results
source of test database and disposable-schema cleanup evidence
feature flags and external side effects explicitly kept disabled
Owner / QA / runtime review and 🥇 conclusion
```

Label every empty field `Not yet recorded`; explicitly state it is not a release baseline or 🥇 until a user-authorized clean commit/tag and repeatable commands are recorded.

- [x] **Step 2: Link the manifest from FDEV-001 and verification evidence**

Update FDEV-001’s tracker row and the R2 foundation verification record to distinguish current working-tree evidence from the future clean-baseline evidence artifact.

- [x] **Step 3: Add a proposal index entry**

Add a concise entry in `proposals/README.md` that points to the FDEV tracker and baseline manifest without claiming a release is ready.

- [x] **Step 4: Verify artifact safety language**

Run:

```bash
rg -n 'Not yet recorded|not a release baseline|not.*🥇|clean commit/tag' \
  docs/oa-ticket-reimbursement-materials/records/durable-control-plane/fdev-001-dev-release-baseline-v1.md
```

Expected: the template cannot be mistaken for a completed release record.

### Task 5: Documentation integration verification and handoff

**Files:**
- Modify: all files from Tasks 1–4 only when the checks identify a contradiction.
- Test: documentation links and repository-wide regression commands.

**Interfaces:**
- Consumes: all governance documentation from Tasks 1–4.
- Produces: a synchronized proposal set ready for FDEV-001’s separate requirement/design/development/test-agent cycle.

- [x] **Step 1: Run conflict scans**

Run:

```bash
rg -n 'R2-dev' docs/oa-ticket-reimbursement-materials
rg -n 'PostgreSQL integration.*待实施|没有真实 PostgreSQL' \
  docs/oa-ticket-reimbursement-materials/proposals/three-source
rg -n 'FDEV-005.*rehearsal|FDEV-006.*R1-dev' \
  docs/oa-ticket-reimbursement-materials/proposals/three-source
```

Expected: no stale command-to-card R2-dev label, no false “PostgreSQL unverified” claim, and no FDEV-005 real-event prerequisite.

- [x] **Step 2: Verify all new relative Markdown links resolve**

Use a repository-safe Markdown link check or inspect each newly added relative target. Fix only broken links; do not rewrite unrelated historical links.

- [x] **Step 3: Run project regression checks**

Run:

```bash
pnpm test
pnpm typecheck:server
git diff --check
```

Expected: all tests and server typecheck pass; documentation changes introduce no whitespace errors.

- [x] **Step 4: Record documentation-governance completion, not FDEV-001 🥇**

Update the tracker’s governance note to state that the planning conflict is resolved, but leave FDEV-001 at its pre-existing lifecycle step until its own requirement, design, development, Test-Plan Agent, clean-baseline test and Owner acceptance occur.

## Self-Review

- **Spec coverage:** Tasks 1–4 cover canonical terminology, granular FDEV ordering, Test-Plan/QA agent handoff, FDEV-005 cycle removal, baseline requirements, document alignment and safety constraints. Task 5 covers contradiction scans and regression verification.
- **Step scan:** Every task action specifies the exact artifacts, IDs, terminology or command it must produce. No runtime feature implementation is implied.
- **Type consistency:** No source-code interfaces change. Documentation uses one canonical ID mapping defined in Task 3 and the R1-dev label defined in Task 2.
- **Review focus:** Each high-risk governance ambiguity is assigned a direct scan or acceptance check in Tasks 1–5.
- **Proportion:** The plan details only documentation decisions and verification commands; it does not prescribe bridge/effect implementation internals, which are separate FDEV requirements.
