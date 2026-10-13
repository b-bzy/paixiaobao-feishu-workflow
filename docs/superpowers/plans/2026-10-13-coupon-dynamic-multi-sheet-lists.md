# Dynamic Multi-Sheet Coupon Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed five-tier whitelist/blacklist model with revision-scoped dynamic Sheet recognition, confirmation, and deterministic one-column workbook generation.

**Architecture:** DeepSeek remains the primary candidate recognizer, while the coupon domain validates workbook evidence and binds each list Sheet to a tier from the same confirmed coupon set. The canonical package carries ordered dynamic Sheet objects, and a new generator creates a clean workbook with the original Sheet names/order and one text-formatted `sku` column per Sheet.

**Tech Stack:** TypeScript, Vitest, ExcelJS, Nitro/Feishu interactive cards, existing three-source domain and control-plane contracts.

**Spec:** `docs/superpowers/specs/2026-10-13-coupon-dynamic-multi-sheet-lists-design.md`

## Global Constraints

- P0 supports SKU lists only; do not add SPU, merchant, or mixed identifier modes.
- AI proposes candidates only; deterministic code validates cells, tier membership, revision, permissions, and generation.
- Do not copy source workbook formulas, styles, relationships, hidden state, images, or columns other than the selected SKU values.
- Preserve valid source Sheet names, Sheet order, and per-Sheet SKU row order in the generated artifact.
- Source files never become OA attachments; only generated and read-back-verified workbooks are eligible for the isolated OA test-draft path.
- Native OA creation remains disabled and out of scope.
- Preserve unrelated working-tree changes; do not reset, overwrite, stage, or commit them. Do not create commits unless the user separately authorizes commits.

## Review Focus

- A valid arbitrary Sheet name such as `100减1` must not be rejected merely because it is absent from the legacy five-name manifest; covered by Task 1 parser tests.
- An AI tier candidate that does not exist in the current confirmed coupon set must become a Chinese confirmation issue rather than a fabricated match; covered by Task 2 matcher tests.
- A workbook with duplicate or Excel-invalid output Sheet names must fail before bytes are frozen; covered by Task 3 generator tests.
- The same SKU on different Sheets must remain a blocking cross-Sheet duplicate, while source row order is preserved; covered by Tasks 1 and 3.
- A stale card action after source/revision change must not apply a dynamic tier selection or generate artifacts; covered by Task 4 service/dispatcher tests.

---

### Task 1: Introduce ordered dynamic list parsing

**Files:**
- Modify: `server/lib/coupon-oa/three-source/types.ts`
- Modify: `server/lib/coupon-oa/three-source/lists.ts`
- Modify: `server/lib/coupon-oa/three-source/recognition.test.ts`

**Interfaces:**
- Produces: `SkuListTierMatch`, `DynamicSkuListSheet`, `DynamicSkuListEntry`, `ParsedDynamicSkuList`, and `parseDynamicSkuList(input): Promise<ParsedDynamicSkuList>`.
- Consumes: existing `WorkbookRecognition`, `AiSkuRegionCandidate`, `SourceProvenance`, and cell-evidence helpers.

- [ ] **Step 1: Add failing parser tests**

Add test cases asserting that four arbitrary Sheets (`100减1`, `2000减20`, `3000减30`, `3000减60`) produce four ordered Sheet records, preserve text SKU values and source row order, reject numeric/formula/multi-value cells, reject cross-Sheet duplicates, and retain issues per Sheet without discarding valid siblings.

- [ ] **Step 2: Run the focused test and verify the fixed-tier assertions fail**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/recognition.test.ts`

Expected: FAIL because current parsing requires `MultiTierSkuSheetName`.

- [ ] **Step 3: Add dynamic types and implement `parseDynamicSkuList`**

Use `sourceSheetName`, `sourceSheetIndex`, `outputSheetName`, `dimension: "SKU"`, ordered entries, evidence, and an unresolved tier-match placeholder. Validate AI evidence coordinates against the actual worksheet; keep the deterministic column candidate fallback without consulting `multiTierSkuSheetNames`.

- [ ] **Step 4: Keep legacy exports only where historical tests/artifacts still require them**

Do not delete the legacy manifest or generator in this task. Mark new-flow call sites for migration in later tasks so historical artifact verification remains possible.

- [ ] **Step 5: Run focused tests**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/recognition.test.ts`

Expected: PASS for dynamic parser cases and existing recognition cases.

### Task 2: Bind dynamic Sheets to the current coupon set

**Files:**
- Modify: `server/lib/coupon-oa/three-source/types.ts`
- Create: `server/lib/coupon-oa/three-source/list-tier-matching.ts`
- Create: `server/lib/coupon-oa/three-source/list-tier-matching.test.ts`
- Modify: `server/lib/coupon-oa/three-source/ai-recognition.ts`
- Modify: `server/lib/coupon-oa/three-source/ai-recognition.test.ts`

**Interfaces:**
- Consumes: `ParsedDynamicSkuList`, `ConfirmedCouponSetSource`, validated AI tier display candidates, and optional owner selections.
- Produces: `matchDynamicSkuListTiers(input): ParsedDynamicSkuList` and stable revision-local `couponTierId` values.

- [ ] **Step 1: Write matcher tests**

Cover exact normalized name match, a unique validated AI match, AI candidate absent from the coupon set, two candidate tiers, two Sheets competing for one tier, one explicitly confirmed tier reused by multiple Sheets, and no positional fallback.

- [ ] **Step 2: Run the matcher test and verify it fails because the module is absent**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/list-tier-matching.test.ts`

- [ ] **Step 3: Implement stable revision-local tier IDs and matching**

Derive the ID from confirmed tier facts already included in the coupon-set snapshot, not from Sheet position. Exact normalized display matches may auto-resolve; similarity only orders candidates. Return `needs_confirmation` or `unmatched` instead of adding a fixed-manifest error.

- [ ] **Step 4: Update the AI contract and validation**

Ensure the prompt asks for per-Sheet `tierDisplayName` evidence without promising that the name is registered globally. Reject candidates that reference a missing Sheet/region or a tier not present in the current coupon set.

- [ ] **Step 5: Run matcher and AI tests**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/list-tier-matching.test.ts server/lib/coupon-oa/three-source/ai-recognition.test.ts`

Expected: PASS.

### Task 3: Generate and verify dynamic one-column workbooks

**Files:**
- Modify: `server/lib/excel-template-engine/template-manifests.ts`
- Create: `server/lib/excel-template-engine/dynamic-sku-list.ts`
- Create: `server/lib/excel-template-engine/dynamic-sku-list.test.ts`
- Modify: `server/lib/excel-template-engine/index.ts`

**Interfaces:**
- Consumes: ordered `DynamicSkuListSheet[]`, activity name, revision, and role.
- Produces: `generateDynamicSkuListWorkbook(input): Promise<DynamicSkuListWorkbook>` and `verifyDynamicSkuListWorkbook(input): Promise<void>` with `rowsBySheet` keyed by output Sheet name.

- [ ] **Step 1: Write generator tests**

Assert exact Sheet names/order, `A1 === "sku"`, text `numFmt` from `A2`, per-Sheet source row order, no extra columns/formulas/hidden Sheets, correct row counts/hash, ten-Sheet support, invalid/duplicate Sheet rejection, formula-prefix rejection, cross-Sheet duplicate rejection, and maximum-row enforcement.

- [ ] **Step 2: Run the focused test and verify it fails because the generator is absent**

Run: `pnpm vitest run server/lib/excel-template-engine/dynamic-sku-list.test.ts`

- [ ] **Step 3: Add the dynamic artifact manifest and generator**

Introduce a new dynamic-list template identity/version for audit metadata without a fixed asset fingerprint or Sheet catalog. Create a clean ExcelJS workbook and write only safe text values.

- [ ] **Step 4: Implement independent read-back verification**

Reload generated bytes and compare Sheet names/order, cell types, normalized text, row counts, and expected entries. Verification must reject any unexpected worksheet or non-empty column after A.

- [ ] **Step 5: Run the generator and existing template-engine suites**

Run: `pnpm vitest run server/lib/excel-template-engine/dynamic-sku-list.test.ts server/lib/excel-template-engine/index.test.ts server/lib/excel-template-engine/three-source-single.test.ts`

Expected: PASS and legacy historical generators remain intact.

### Task 4: Migrate canonical package, overlap handling, and service confirmation

**Files:**
- Modify: `server/lib/coupon-oa/three-source/types.ts`
- Modify: `server/lib/coupon-oa/three-source/lists.ts`
- Modify: `server/lib/coupon-oa/three-source/workflow.ts`
- Modify: `server/lib/coupon-oa/three-source/offline.ts`
- Modify: `server/lib/coupon-oa/three-source/offline.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/store.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/service.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/service.test.ts`

**Interfaces:**
- Consumes: matched `ParsedDynamicSkuList` and explicit owner tier selections.
- Produces: `CanonicalPackage.whitelistSheets`, optional `blacklistSheets`, dynamic source-confirmation hash inputs, and artifacts from `generateDynamicSkuListWorkbook`.

- [ ] **Step 1: Add failing canonical/workflow tests**

Replace fixed-key expectations with ordered Sheet expectations. Add tests for four arbitrary tiers, single Sheet, white/black overlap with Sheet provenance, unresolved tier blocking, confirmed multi-Sheet-to-one-tier, artifact read-back, and source-confirmation hash changes when Sheet mapping changes.

- [ ] **Step 2: Run offline and service tests to capture the fixed-manifest failure**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/offline.test.ts server/lib/feishu/coupon-oa/three-source/service.test.ts`

- [ ] **Step 3: Migrate canonical packaging and overlap filtering**

Remove new-flow calls to `groupIdentifiersByTier`. Preserve entries grouped by source Sheet; when overlap policy removes a SKU, remove it from its owning Sheet without reordering remaining entries.

- [ ] **Step 4: Migrate artifact generation**

Call `generateDynamicSkuListWorkbook` for whitelist and optional blacklist. Store the new dynamic template ID/version in frozen artifact metadata while leaving historical artifact readers unchanged.

- [ ] **Step 5: Make unresolved matches a pre-generation state**

`confirmSourcesAndGenerate` must update the same draft/revision with structured confirmation needs and return before upload/freeze side effects. It must reject stale revisions and duplicate operations through existing owner/revision/idempotency checks.

- [ ] **Step 6: Run offline, service, task, and control-flow tests**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/offline.test.ts server/lib/feishu/coupon-oa/three-source/service.test.ts server/lib/coupon-oa/three-source/task.test.ts`

Expected: PASS with no Base/Drive/OA calls in unresolved cases.

### Task 5: Add one-card Chinese confirmation for ambiguous Sheet matches

**Files:**
- Modify: `server/lib/feishu/coupon-oa/three-source/store.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/cards.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/cards.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/dispatcher.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/mapping-card-delivery.test.ts`

**Interfaces:**
- Consumes: `needs_confirmation` Sheet records and tier display labels from the current coupon set.
- Produces: `selections.listSheetTierIds: Record<string, string>` and form fields named by a stable encoded Sheet identity, not raw internal coordinates.

- [ ] **Step 1: Write failing card and dispatcher tests**

Assert that all ambiguous Sheets appear in one second-round card, all copy is Chinese, no cell coordinate/internal field name is exposed, one select per ambiguous Sheet uses current coupon tier labels, exact matches do not render a selector, and repeated delivery updates the existing message instead of creating another.

- [ ] **Step 2: Run card/dispatcher tests and verify failure**

Run: `pnpm vitest run server/lib/feishu/coupon-oa/three-source/cards.test.ts server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts server/lib/feishu/coupon-oa/three-source/mapping-card-delivery.test.ts`

- [ ] **Step 3: Render and parse dynamic tier confirmations**

Bind selections to the current draft ID, revision, source hash, and stable Sheet identity. Reject an option that is not among the presented current-revision candidates.

- [ ] **Step 4: Re-run generation only after all required matches resolve**

Use the existing mapping-confirm action and operation idempotency. Do not append another second-round card; update the existing mapping message.

- [ ] **Step 5: Run the focused Feishu suites**

Run the Step 2 command and expect PASS.

### Task 6: Add fixtures, regression verification, and current-baseline documentation

**Files:**
- Add/Modify: `docs/oa-ticket-reimbursement-materials/reference/fixtures/` with generated, redacted dynamic-list fixtures only
- Modify: `server/lib/coupon-oa/three-source/local-fixtures.test.ts`
- Modify: `docs/oa-ticket-reimbursement-materials/current/product/` relevant three-source baseline document
- Modify: `docs/oa-ticket-reimbursement-materials/current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md`
- Modify: `docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md`

**Interfaces:**
- Consumes: completed dynamic parsing/matching/generation flow.
- Produces: redacted regression fixtures and accurate current behavior documentation.

- [ ] **Step 1: Generate redacted fixtures**

Create cases for the screenshot’s four arbitrary tiers, ten tiers, ambiguous names, invalid evidence, leading-zero SKU, numeric SKU, formula, duplicate and white/black overlap. Do not copy real business workbooks into Git.

- [ ] **Step 2: Add fixture contract tests**

Assert each fixture’s expected parse/match/generate or blocking result and verify generated workbooks by reopening them.

- [ ] **Step 3: Update current product, implementation, and runbook text**

Document dynamic Sheet behavior, one-card confirmation, AI/validator boundary, source-vs-generated attachment rule, and unchanged draft-only/native-OA boundary.

- [ ] **Step 4: Run full verification**

Run: `pnpm test:coupon-three-source:offline && pnpm typecheck && pnpm lint && pnpm build && git diff --check`

Expected: all commands pass. If full lint reports pre-existing unrelated failures, run Biome on every changed file and report the unrelated baseline separately; do not weaken lint rules.
