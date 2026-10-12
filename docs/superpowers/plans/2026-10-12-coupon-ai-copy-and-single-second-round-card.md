# Coupon AI Copy And Single Second-Round Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DeepSeek-backed activity copy and supplement recognition visibly populate the second-round form while keeping exactly one second-round Feishu card message per pilot revision.

**Architecture:** DeepSeek remains the primary adapter from arbitrary workbooks or Chinese supplement text into the existing validated canonical JSON. Deterministic code validates evidence and business rules, then the fixed template engine consumes only owner-confirmed values. The first second-round render creates one updateable Feishu card; every later AI or owner state transition patches that message instead of appending another card.

**Tech Stack:** Nitro, TypeScript, Vitest, PostgreSQL durable effects, Feishu IM v1 cards, DeepSeek chat completions.

**Spec:** `docs/oa-ticket-reimbursement-materials/current/product/coupon-oa-mvp-prd-v1.3.md`

## Global Constraints

- Keep the P0 route `draft-only`; do not enable native OA creation or submission.
- AI proposes candidates only; deterministic server validation and the current owner remain authoritative.
- Source workbooks and supplement text may be sent to DeepSeek only under the already-enabled P0 external-processing gate.
- Do not log or expose source payloads, credentials, open IDs, Base/Drive identifiers, or provider responses.
- One `recordId + revision` may have only one second-round card message; retries and repeated callbacks must update it idempotently.
- Source files never become OA attachments; only frozen, hash-verified standard artifacts may proceed.

## Review Focus

- Three source-recognition effects completing separately must still create only one second-round card message.
- Repeated owner actions and worker retries must patch the stored message rather than append cards.
- AI supplement values fill blank fields but never overwrite a non-empty owner-confirmed value.
- Activity copy that references valid canonical coupon facts must survive validation; unsupported or fabricated facts remain blocked.
- A failed or timed-out provider call must show a Chinese status and preserve manual completion without pretending AI succeeded.

---

### Task 1: Updateable Second-Round Card Gateway

**Files:**
- Modify: `server/lib/feishu/client.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/store.ts`
- Create: `server/lib/feishu/coupon-oa/three-source/mapping-card-delivery.ts`
- Test: `server/lib/feishu/client.test.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/mapping-card-delivery.test.ts`

**Interfaces:**
- Produces: `sendFeishuCardWithReceipt(openId, card, idempotencyKey): Promise<{ messageId: string }>`.
- Produces: `updateFeishuCard(messageId, card): Promise<void>` using `PATCH /im/v1/messages/:message_id`.
- Produces: `deliverCouponThreeSourceMappingCard({ draft, idempotencyKey }): Promise<CouponThreeSourcePilotDraft>`.
- Stores: `mappingCardDelivery?: { messageId: string; revision: number }` in the P0 draft state.

- [ ] **Step 1: Write failing gateway and delivery tests**

Assert that create returns the Feishu `message_id`, update sends serialized card content with PATCH, first delivery stores the message ID, and later delivery for the same revision calls update without calling create.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm vitest run server/lib/feishu/client.test.ts server/lib/feishu/coupon-oa/three-source/mapping-card-delivery.test.ts`

- [ ] **Step 3: Implement the card receipt, patch client and delivery coordinator**

Use the same tenant token identity for create and patch. Require both old and new cards to keep `config.update_multi=true`; reject a create response without `message_id`.

- [ ] **Step 4: Run focused tests and verify pass**

Run: `pnpm vitest run server/lib/feishu/client.test.ts server/lib/feishu/coupon-oa/three-source/mapping-card-delivery.test.ts`

### Task 2: Route Every Second-Round Transition Through One Delivery

**Files:**
- Modify: `server/lib/feishu/coupon-oa/three-source/dispatcher.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/ai-projection.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/ai-text-projection.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/ai-projection.test.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/ai-text-projection.test.ts`

**Interfaces:**
- Consumes: `deliverCouponThreeSourceMappingCard` from Task 1.
- Produces: all mapping-stage owner selections and AI projections update one stored message for the current revision.

- [ ] **Step 1: Write failing duplicate-suppression tests**

Cover final source recognition, no-blacklist confirmation, over-deduction selection, supplement success, repeated callback and projector retry. Assert one create and subsequent updates only.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm vitest run server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts server/lib/feishu/coupon-oa/three-source/ai-projection.test.ts server/lib/feishu/coupon-oa/three-source/ai-text-projection.test.ts`

- [ ] **Step 3: Replace direct mapping-card sends with the delivery coordinator**

Keep non-mapping cards on the existing send path. Preserve stale revision checks and durable effect idempotency; do not create a replacement card automatically when PATCH has an unknown outcome.

- [ ] **Step 4: Run focused tests and verify pass**

Run the command from Step 2 and require all tests to pass.

### Task 3: Repair AI Activity Copy And Supplement Autofill

**Files:**
- Modify: `server/lib/coupon-oa/three-source/ai-recognition.ts`
- Modify: `server/lib/coupon-oa/three-source/ai-text.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/ai-text-projection.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/cards.ts`
- Test: `server/lib/coupon-oa/three-source/ai-recognition.test.ts`
- Test: `server/lib/coupon-oa/three-source/ai-text.test.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/ai-text-projection.test.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/cards.test.ts`

**Interfaces:**
- Produces: prompt version `coupon-three-source-p0-ai-primary-v2` so existing source hashes receive a fresh AI run.
- Produces: validated `activityCopyCandidates` whose prose is checked against canonical coupon facts rather than requiring duplicate evidence on every generated sentence.
- Produces: blank-only supplement merge and Chinese AI status/suggestion text in the single second-round card.

- [ ] **Step 1: Write failing activity-copy, merge and card-status tests**

Assert that a valid all-tier copy candidate is retained, an incomplete/fabricated candidate is rejected, blank fields receive supplement output, non-empty owner fields win, and success/failure is visible without technical keys or coordinates.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/ai-recognition.test.ts server/lib/coupon-oa/three-source/ai-text.test.ts server/lib/feishu/coupon-oa/three-source/ai-text-projection.test.ts server/lib/feishu/coupon-oa/three-source/cards.test.ts`

- [ ] **Step 3: Implement the v2 canonical facts contract and blank-only autofill**

Continue to reject placeholders, missing tiers and forbidden invented facts. Show accepted candidates as editable defaults; show provider failure or validation rejection as a Chinese manual-review message.

- [ ] **Step 4: Run focused tests and verify pass**

Run the command from Step 2 and require all tests to pass.

### Task 4: Baseline, Documentation And Preview Deployment

**Files:**
- Modify: `docs/oa-ticket-reimbursement-materials/current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md`
- Modify: `docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: tested Preview deployment with native OA disabled and a manual Feishu E2E handoff.

- [ ] **Step 1: Update implementation and rollout documentation**

Record one-message second-round delivery, PATCH prerequisites, AI status visibility and the v2 canonical mapping contract without claiming production readiness.

- [ ] **Step 2: Run repository verification**

Run: `pnpm lint`, `pnpm typecheck`, affected Vitest suites, `pnpm test:coupon-three-source:offline`, `pnpm test:coupon-activity-copy`, and `pnpm build`.

- [ ] **Step 3: Review the exact diff and deployment gates**

Confirm no secrets, real cases, unrelated dirty files, native OA enablement, or production configuration changes are included.

- [ ] **Step 4: Commit, push and deploy the approved Preview branch**

Use Conventional Commits, verify the deployed revision, keep native submit disabled, and provide only the Preview URL plus the manual Feishu test steps.
