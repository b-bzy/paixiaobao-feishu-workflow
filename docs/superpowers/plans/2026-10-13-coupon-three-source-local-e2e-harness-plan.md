# Coupon Three-Source Local E2E Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable local three-source coupon E2E harness with at least 64 manifest-driven cases and more than 100 generated, sanitized Excel files, then verify both the side-effect-free business path and the PostgreSQL/MinIO durable path before any Feishu manual test.

**Architecture:** A typed case catalog drives deterministic workbook generation, AI replay, owner replies, domain orchestration, artifact generation, and read-back assertions. The fast lane runs entirely in memory with fake external gateways; the durable lane runs the same selected scenarios against disposable PostgreSQL schemas and a namespaced MinIO bucket. A report layer merges both lanes without calling Feishu, Drive, Base, Approval, or native OA.

**Tech Stack:** TypeScript, Vitest, ExcelJS, Zod, PostgreSQL 17, MinIO/S3, `@aws-sdk/client-s3`, Nitro control-plane repositories, pnpm, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-13-coupon-three-source-local-e2e-harness-design.md`

## Global Constraints

- Preserve the current product, implementation, ADR, and rollout boundaries. This plan proves a local service-level E2E only; it does not prove Feishu, Vercel, Drive, Base, Approval, or production readiness.
- AI may propose workbook roles, fields, evidence, campaign copy, and SKU regions. Deterministic code must still validate source hashes, coordinates, values, owner, revision, coupon rules, and artifact contents.
- The default fast and durable suites must not access the public network. Only the separately named DeepSeek contract command may make a model request, and only with synthetic redacted inputs plus an explicit opt-in flag.
- All cases must keep `nativeOaCreated: false`. Do not import or call Approval/native-OA clients from the harness.
- Source whitelist/blacklist files are parsing inputs only. They must never be assigned an OA attachment role; only generated, frozen, hash-verified artifacts may be reported as eligible local outputs.
- Fixture generation must use a fixed seed and synthetic identifiers. Do not copy real files from `cases/`, `drafts/`, the Desktop, or prior live Feishu messages into the repository or generated corpus.
- Generated workbooks and reports belong under `outputs/coupon-three-source-e2e/` and must be Git ignored. Small immutable binary seeds needed to represent encrypted or legacy formats may live under `reference/fixtures/three-source-e2e/seeds/` only after confirming they are synthetic and contain no credentials or business data.
- Durable tests must use a disposable PostgreSQL schema and a run-specific MinIO key prefix. They must clean those resources without deleting shared buckets, volumes, schemas, or unrelated local data.
- Use stable error codes and structured results for assertions. Chinese user-facing text is asserted by field/issue identity, not by matching an entire prose paragraph.
- Preserve unrelated working-tree changes. Do not reset, overwrite, stage, commit, deploy, or start the Feishu bridge. Do not create commits unless the user separately authorizes them.

## Review Focus

- A numeric SKU that has already lost leading zeros or exceeds Excel's 15-digit reliable precision must be rejected with evidence, while a text SKU with leading zeros must round-trip unchanged; covered by Tasks 2, 3, and 4.
- The same SKU repeated in one Sheet must deduplicate in first-seen order, while the same SKU on different Sheets must remain independently present; covered by Tasks 2 and 4.
- One upload batch, repeated file delivery, repeated recognition click, and repeated confirmation click must still produce at most one second-round card intent and one artifact set for the current revision; covered by Tasks 4 and 6.
- AI evidence that names a missing Sheet or out-of-range cell must be rejected before any field is promoted, while valid siblings remain available for one combined Chinese clarification; covered by Tasks 3 and 4.
- A worker restart after an immutable object write, and an effect whose response is lost after execution, must not create a second object or outbound effect; covered by Tasks 5 and 6.
- A MinIO hash/content-type mismatch, PostgreSQL lease conflict, stale revision click, or wrong owner action must fail closed and leave `nativeOaCreated` false; covered by Tasks 5 and 6.
- The aggregate command must fail if the durable lane is skipped or unavailable. It must never label a fast-only result as a complete local E2E pass; covered by Task 7.

---

### Task 1: Define the case contract and validate the 64-case catalog

**Files:**
- Create: `server/lib/coupon-oa/three-source/e2e/case-contract.ts`
- Create: `server/lib/coupon-oa/three-source/e2e/case-contract.test.ts`
- Create: `server/lib/coupon-oa/three-source/e2e/case-catalog.ts`
- Create: `server/lib/coupon-oa/three-source/e2e/case-catalog.test.ts`

**Interfaces:**
- Produces `CouponThreeSourceE2eCase`, `CouponThreeSourceE2eExpected`, `E2eTerminalClassification`, `validateCouponThreeSourceE2eCase(value)`, and `couponThreeSourceE2eCases`.
- The catalog contains exactly the approved IDs `F01`–`F08`, `L01`–`L14`, `C01`–`C16`, `S01`–`S16`, and `B01`–`B10`.
- Every case declares generated input roles, AI replay ID, owner replies, expected stable error code or state, expected second-round card count, artifact roles, per-Sheet row counts when applicable, and `nativeOaCreated: false`.

- [ ] **Step 1: Write contract tests before the contract**

  Assert rejection of duplicate IDs, unknown category prefixes, missing expected state, an expected success without artifact roles, an abnormal case without a stable error/clarification code, and any value other than `false` for `nativeOaCreated`.

- [ ] **Step 2: Run the focused test and verify failure**

  Run: `pnpm exec vitest run server/lib/coupon-oa/three-source/e2e/case-contract.test.ts`

  Expected: FAIL because the contract module does not exist.

- [ ] **Step 3: Implement the typed contract with Zod-backed runtime validation**

  Keep file recipes declarative: layout, fields, cells, data types, Sheet behavior, corruption transform, AI replay, owner actions, and expected result. Do not put raw workbook bytes or secrets into the manifest.

- [ ] **Step 4: Add all 64 manifest entries**

  Transcribe the approved matrix from the spec without collapsing variants. Cases such as `L13`, `C09`, `C11`, and `S15` may request multiple generated workbook variants from one manifest; this is how the corpus exceeds 100 `.xlsx` files without inflating the case count.

- [ ] **Step 5: Add catalog completeness tests**

  Assert all expected IDs exist exactly once, each of the five categories has the approved count, every case carries at least one Excel recipe, all success cases declare read-back assertions, and the planned generated `.xlsx` count is greater than 100.

- [ ] **Step 6: Run Task 1 tests**

  Run: `pnpm exec vitest run server/lib/coupon-oa/three-source/e2e/case-contract.test.ts server/lib/coupon-oa/three-source/e2e/case-catalog.test.ts`

  Expected: PASS with `64` valid manifests and a planned workbook count above `100`.

### Task 2: Build the deterministic synthetic Excel corpus generator

**Files:**
- Create: `server/lib/coupon-oa/three-source/e2e/workbook-fixture-builder.ts`
- Create: `server/lib/coupon-oa/three-source/e2e/workbook-fixture-builder.test.ts`
- Create: `scripts/generate-coupon-three-source-e2e-fixtures.mjs`
- Create: `docs/oa-ticket-reimbursement-materials/reference/fixtures/three-source-e2e/seeds/README.md`
- Create: `docs/oa-ticket-reimbursement-materials/reference/fixtures/three-source-e2e/seeds/encrypted-synthetic.xlsx`
- Create: `docs/oa-ticket-reimbursement-materials/reference/fixtures/three-source-e2e/seeds/legacy-synthetic.xls`

**Interfaces:**
- Produces `buildE2eWorkbook(recipe): Promise<GeneratedE2eWorkbook>`, `generateE2eCaseInputs(caseValue, outputDirectory)`, and a manifest index containing role, path, bytes, SHA-256, MIME/signature classification, and recipe hash.
- Uses ExcelJS for valid OOXML workbooks and deterministic byte transforms for empty, truncated, missing-part, HTML/CSV-disguised, and oversized inputs.
- Synthetic seed binaries, if needed, contain only generated labels and IDs and have their SHA-256 documented in the seed README.

- [ ] **Step 1: Write fixture-builder tests**

  Cover header rows 1/2/10, two-level merged headers, vertical key-value layout, matrix coupon layout, two tables on one Sheet, repeated headers, empty/formatted tails, hidden rows/columns/Sheets, randomized Sheet names, SKU columns A/C/Z, and 1/4/5/10-Sheet lists.

- [ ] **Step 2: Add data-type and corruption tests**

  Cover text/numeric/scientific/leading-zero/over-15-digit/formula/formula-prefix/hyperlink/multi-value SKU cells; missing workbook part; false extension; zero bytes; file-size/row-limit boundary; and encrypted/legacy classification.

- [ ] **Step 3: Run the focused tests and verify failure**

  Run: `pnpm exec vitest run server/lib/coupon-oa/three-source/e2e/workbook-fixture-builder.test.ts`

  Expected: FAIL because the builder is absent.

- [ ] **Step 4: Implement deterministic generation**

  Use fixed timestamps, fixed seed data, stable Sheet order, text formatting for identifiers, and recipe-derived file names. Do not require Microsoft Excel, LibreOffice, or network access during a normal test run.

- [ ] **Step 5: Implement the CLI wrapper**

  Accept `--output <absolute-or-repo-relative-path>` and optional `--case <ID>`. Refuse to write outside the requested output root, create files with non-secret permissions, and write `fixture-index.json` only after all files and hashes are complete.

- [ ] **Step 6: Generate and audit the full corpus**

  Run: `pnpm exec node scripts/generate-coupon-three-source-e2e-fixtures.mjs --output outputs/coupon-three-source-e2e/manual-fixture-audit/fixtures`

  Expected: at least 64 case directories, more than 100 `.xlsx` files, no file copied from ignored business-data directories, and identical recipe hashes on a second run. For OOXML files whose ZIP metadata prevents byte-identical output, require semantic fingerprint equality and document the byte-hash exception in the generated index rather than claiming byte determinism.

### Task 3: Add AI replay, combined clarification, and input classification fixtures

**Files:**
- Create: `server/lib/coupon-oa/three-source/e2e/ai-replay.ts`
- Create: `server/lib/coupon-oa/three-source/e2e/ai-replay.test.ts`
- Create: `server/lib/coupon-oa/three-source/e2e/error-classification.ts`
- Create: `server/lib/coupon-oa/three-source/e2e/error-classification.test.ts`
- Create: `server/lib/coupon-oa/three-source/e2e/ai-replays.ts`

**Interfaces:**
- Produces `CouponThreeSourceAiReplayGateway`, `CouponActivityCopyReplayGateway`, `E2eAiReplayScenario`, and `classifyE2eFailure(error): E2eFailureResult`.
- Replay scenarios cover complete, low-confidence, partial-valid, conflicting, missing-Sheet, out-of-range evidence, malformed JSON, wrong schema, timeout, rate limit, authentication failure, provider failure, and deterministic-rule fallback.
- Classification emits stable codes such as file signature, workbook parse, encrypted workbook, unsafe numeric SKU, missing year, invalid date, conflicting field, stale revision, wrong owner, and infrastructure unavailable; exact code names must reuse existing domain codes where they exist.

- [ ] **Step 1: Write failing replay tests**

  Assert one invocation per semantic key, no network access, stable request/response hashes, partial-valid result preservation, invalid evidence rejection, and redacted audit summaries.

- [ ] **Step 2: Write failing classification tests**

  Assert that ExcelJS/provider/validation errors become structured stage + code + Chinese guidance without exposing cell values, SKU lists, full prompts, or provider response bodies.

- [ ] **Step 3: Run Task 3 tests and verify failure**

  Run: `pnpm exec vitest run server/lib/coupon-oa/three-source/e2e/ai-replay.test.ts server/lib/coupon-oa/three-source/e2e/error-classification.test.ts`

- [ ] **Step 4: Implement replay gateways and scenario registry**

  Match production gateway contracts and prompt/schema versions. Replays may propose candidate facts only; pass every candidate through the current source-hash, Sheet, coordinate, type, coupon, and list validators.

- [ ] **Step 5: Implement combined clarification projection**

  Reuse the current second-round dialogue/card projection and assert that all low-confidence, missing, and conflicting business questions are merged into one Chinese owner interaction for the current revision. Do not expose field keys, Sheet coordinates, or mapping implementation terms to the business user.

- [ ] **Step 6: Run Task 3 tests**

  Run: `pnpm exec vitest run server/lib/coupon-oa/three-source/e2e/ai-replay.test.ts server/lib/coupon-oa/three-source/e2e/error-classification.test.ts server/lib/coupon-oa/three-source/second-round-dialogue.test.ts`

  Expected: PASS with `globalThis.fetch`/gateway network calls equal to zero.

### Task 4: Implement the fast in-memory E2E runner

**Files:**
- Create: `server/lib/coupon-oa/three-source/e2e/fast-runner.ts`
- Create: `server/lib/coupon-oa/three-source/e2e/fast-runner.test.ts`
- Create: `server/lib/coupon-oa/three-source/e2e/artifact-assertions.ts`
- Create: `server/lib/coupon-oa/three-source/e2e/artifact-assertions.test.ts`
- Modify: `server/lib/coupon-oa/three-source/offline.ts`
- Modify as failures prove necessary: `server/lib/coupon-oa/three-source/recognition.ts`
- Modify as failures prove necessary: `server/lib/coupon-oa/three-source/lists.ts`
- Modify as failures prove necessary: `server/lib/coupon-oa/three-source/workflow.ts`
- Modify as failures prove necessary: `server/lib/coupon-oa/three-source/owner-input.ts`
- Modify as failures prove necessary: `server/lib/coupon-oa/three-source/task.ts`
- Modify as failures prove necessary: `server/lib/feishu/coupon-oa/three-source/ai-projection.ts`
- Modify as failures prove necessary: `server/lib/feishu/coupon-oa/three-source/cards.ts`

**Interfaces:**
- Produces `runFastE2eCase(input): Promise<CouponThreeSourceE2eCaseResult>` and `assertGeneratedCouponArtifacts(input): Promise<ArtifactAssertionResult>`.
- The runner consumes generated files, replay gateways, current task/domain transitions, current templates, fake card/artifact gateways, and owner actions. It returns state/revision, recognition sources, clarification projection, artifact manifests, read-back facts, effect counters, source hashes before/after, and `nativeOaCreated: false`.
- Successful cases stop at a named local-ready classification backed by the real current domain state, normally `AwaitingFinalConfirmation`; do not invent a persisted production status such as `ReadyForLocalConfirmation` unless the accepted product baseline is separately changed.

- [ ] **Step 1: Write a failing golden-path E2E test**

  Start from `F01`, generate the three source inputs, replay AI recognition/copy, apply owner confirmation, generate standard workbooks/screenshots when required, and reopen every artifact. Assert template/version/fingerprint, Sheet order, row counts, SKU text preservation, revision binding, and zero external calls.

- [ ] **Step 2: Add parameterized coverage for all 64 manifests**

  For each case assert the manifest's state/classification, error/clarification code, revision, one-card maximum, artifact count, source immutability, and `nativeOaCreated: false`. Keep each case's result independently visible so one failure does not hide the remaining matrix.

- [ ] **Step 3: Add operation/idempotency cases**

  Re-deliver equal bytes, replace same-role content with different bytes, click current and stale cards, repeat recognize/confirm/generate operations, clear and restart, use a wrong owner, and run two owners concurrently. Assert one semantic result per operation ID and no old-revision projection.

- [ ] **Step 4: Run the fast runner and record genuine product failures**

  Run: `pnpm exec vitest run server/lib/coupon-oa/three-source/e2e/fast-runner.test.ts`

  Expected before corrections: failures are limited to specific manifest IDs and expose stage/code, not an unclassified exception.

- [ ] **Step 5: Correct only failures that contradict the accepted current product behavior**

  For every production-code correction, first add or retain the narrow owning regression in the existing module test (`recognition.test.ts`, `ai-recognition.test.ts`, `owner-input.test.ts`, `task.test.ts`, `workflow.test.ts`, `cards.test.ts`, or `service.test.ts`). Do not loosen validation simply to turn a negative case green; expected unsafe inputs must remain expected blocks.

- [ ] **Step 6: Run focused owning tests and the full fast matrix**

  Run: `pnpm exec vitest run server/lib/coupon-oa/three-source server/lib/feishu/coupon-oa/three-source server/lib/excel-template-engine`

  Expected: PASS for existing tests plus all fast-manifest assertions, with expected blocks reported as expected outcomes.

### Task 5: Implement and verify the immutable MinIO/S3 object-store adapter

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `server/lib/control-plane/s3-canonical-object-store.ts`
- Create: `server/lib/control-plane/s3-canonical-object-store.test.ts`
- Create: `server/lib/control-plane/s3-canonical-object-store.integration.test.ts`
- Modify: `server/lib/control-plane/object-store.ts`
- Modify: `server/lib/control-plane/runtime-config.ts`
- Modify: `server/lib/control-plane/runtime-config.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Add the direct dependency `@aws-sdk/client-s3`.
- Produces `S3CanonicalObjectStore implements CanonicalObjectStore`, `getCanonicalObjectStoreConfig(environment)`, and `ensureLocalE2eBucket(client, bucket)` for local-test setup only.
- `putImmutable` uses a run/revision/role key, SHA-256 metadata, content type, and an atomic create-only condition. Same key + same bytes is idempotent; same key + different bytes is a conflict.

- [ ] **Step 1: Extend the object-store contract tests**

  Assert valid key normalization, empty bytes rejection, client-side hash verification, same-object replay, different-bytes collision, read-back hash/content-type mismatch, missing object, access denied, timeout, and transient outage classification.

- [ ] **Step 2: Run the unit test and verify failure**

  Run: `pnpm exec vitest run server/lib/control-plane/object-store.test.ts server/lib/control-plane/s3-canonical-object-store.test.ts`

- [ ] **Step 3: Add the AWS S3 client and implement the adapter**

  Support custom endpoint, region, bucket, access key, secret, and path-style mode from the existing `OBJECT_STORE_*` variables. Never log credentials, signed headers, or raw object bytes.

- [ ] **Step 4: Add MinIO integration tests**

  Use `OBJECT_STORE_TEST_*` or locally derived non-production values. Create only the test bucket/prefix, verify immutable put/get/hash/content type, two concurrent create attempts, tampered metadata detection, missing object, and outage behavior.

- [ ] **Step 5: Start infrastructure and run the adapter test**

  Run: `pnpm infra:up`

  Run: `docker compose -f infra/docker-compose.yml ps`

  Run: `OBJECT_STORE_TEST_ENDPOINT=http://127.0.0.1:9000 OBJECT_STORE_TEST_REGION=us-east-1 OBJECT_STORE_TEST_BUCKET=coupon-e2e-local OBJECT_STORE_TEST_ACCESS_KEY_ID=local-aihuishou OBJECT_STORE_TEST_SECRET_ACCESS_KEY=local-development-only-change-before-use OBJECT_STORE_TEST_FORCE_PATH_STYLE=true pnpm exec vitest run server/lib/control-plane/s3-canonical-object-store.integration.test.ts`

  Expected: PostgreSQL and MinIO are healthy; the adapter suite passes. If the pinned MinIO image cannot be pulled, stop and report the registry/image blocker—do not silently substitute an unpinned image or skip durable verification.

### Task 6: Implement the PostgreSQL + MinIO durable E2E lane

**Files:**
- Create: `server/lib/control-plane/coupon-three-source-local-e2e.integration.test.ts`
- Create: `server/lib/control-plane/local-e2e-harness.ts`
- Modify: `server/lib/control-plane/durable-coupon-control-plane-worker.ts`
- Modify as required by proven durable failures: `server/lib/control-plane/postgres-workflow-job-repository.ts`
- Modify as required by proven durable failures: `server/lib/control-plane/postgres-durable-effect-repository.ts`
- Modify as required by proven durable failures: `server/lib/control-plane/runtime-lease.ts`
- Modify as required by proven durable failures: `server/lib/feishu/coupon-oa/three-source/task-repository.ts`

**Interfaces:**
- Produces `createLocalDurableE2eHarness({ databaseUrl, objectStore, runId })` with receipt, task, AI replay, card fake, artifact freeze, worker tick, restart, fault injection, and teardown operations.
- Reuses the real migration files, PostgreSQL repositories, receipt/outbox/effect/lease semantics, task/domain services, and `S3CanonicalObjectStore`.
- The fake Feishu gateway records only redacted semantic keys and counters. It never sends a message.
- No database migration is planned for test-only behavior. If a durable failure proves that the accepted runtime contract lacks a persistence constraint, stop this task, amend the product/implementation plan, and add the next numbered migration instead of hiding the problem in test setup.

- [ ] **Step 1: Create disposable-database setup**

  Follow `postgres-command-intake.integration.test.ts`: create a random schema, apply every migration twice to prove idempotency, bind a schema-specific pool, and drop only that schema during teardown.

- [ ] **Step 2: Write a failing durable golden-path test**

  Persist a normalized synthetic delivery and source manifests, run workers to quiescence, replay AI, apply one owner confirmation, freeze generated artifacts in MinIO, read them back, and assert task/revision/receipt/outbox/effect/object rows and hashes. Assert no native OA attempt/effect exists.

- [ ] **Step 3: Add duplicate, concurrency, and restart scenarios**

  Cover duplicate delivery, equal/different source bytes, repeated card action, stale revision, two owners, same owner concurrent starts, two workers racing one lease, worker restart before and after AI, restart before generation, and restart immediately after object write.

- [ ] **Step 4: Add failure/unknown scenarios**

  Cover database disconnect before commit, MinIO unavailable before write, object written but repository acknowledgement lost, outbound fake effect succeeded but response lost, expired lease, dead-letter boundary, and hash mismatch on read-back. Assert retry or outcome-unknown semantics and no repeated non-idempotent effect.

- [ ] **Step 5: Run migrations and the durable suite**

  Run: `CONTROL_PLANE_TEST_DATABASE_URL=postgresql://aihuishou:local-development-only@127.0.0.1:5432/aihuishou_workflow pnpm db:migrate:control-plane:test`

  Run: `CONTROL_PLANE_TEST_DATABASE_URL=postgresql://aihuishou:local-development-only@127.0.0.1:5432/aihuishou_workflow OBJECT_STORE_TEST_ENDPOINT=http://127.0.0.1:9000 OBJECT_STORE_TEST_REGION=us-east-1 OBJECT_STORE_TEST_BUCKET=coupon-e2e-local OBJECT_STORE_TEST_ACCESS_KEY_ID=local-aihuishou OBJECT_STORE_TEST_SECRET_ACCESS_KEY=local-development-only-change-before-use OBJECT_STORE_TEST_FORCE_PATH_STYLE=true pnpm exec vitest run server/lib/control-plane/coupon-three-source-local-e2e.integration.test.ts`

  Expected: PASS with disposable schema removed and only the run-specific MinIO prefix deleted.

- [ ] **Step 6: Run existing control-plane regressions**

  Run: `CONTROL_PLANE_TEST_DATABASE_URL=postgresql://aihuishou:local-development-only@127.0.0.1:5432/aihuishou_workflow pnpm test:control-plane:postgres`

  Expected: PASS; existing receipt, outbox, lease, and unknown-outcome guarantees remain intact.

### Task 7: Add reports, aggregate commands, and fail-closed orchestration

**Files:**
- Create: `server/lib/coupon-oa/three-source/e2e/report.ts`
- Create: `server/lib/coupon-oa/three-source/e2e/report.test.ts`
- Create: `scripts/run-coupon-three-source-e2e-local.mjs`
- Create: `scripts/run-coupon-three-source-e2e-local.test.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces `CouponThreeSourceE2eRunReport`, `writeCouponThreeSourceE2eReport(...)`, and a CLI supporting `--lane fast|durable|all|deepseek`, `--case <ID>`, and `--keep-infra`.
- Adds scripts:
  - `test:coupon-three-source:e2e-local:fast`
  - `test:coupon-three-source:e2e-local:durable`
  - `test:coupon-three-source:e2e-local`
  - `test:coupon-three-source:e2e-local:deepseek`
- Writes `per-case/<ID>/result.json`, `test-results.json`, and `本地E2E验收报告.md` under a unique run directory.

- [ ] **Step 1: Write report tests**

  Assert grouping into passed, clarification, expected block, unexpected failure, and infrastructure failure. Assert stage/code/expected/actual/revision/artifact/effect identifiers are present and secrets, full payloads, open IDs, prompts, raw AI responses, and SKU lists are absent.

- [ ] **Step 2: Write orchestrator tests**

  Mock child processes and assert fast-only, durable-only, aggregate, and DeepSeek behaviors. The aggregate must return non-zero when Docker health, migration, fixture generation, fast lane, durable lane, or report finalization fails. `deepseek` must require both explicit opt-in and a configured key.

- [ ] **Step 3: Implement report and orchestrator**

  Start Docker only for durable/all, wait for both health endpoints, pass local-test environment explicitly, stop infrastructure in a `finally` block unless `--keep-infra` is set, and preserve partial diagnostics after failure. Never inherit Feishu, Approval, Vercel, or production database/object-store variables into child lanes.

- [ ] **Step 4: Add narrow Git ignore rule**

  Ignore `/outputs/coupon-three-source-e2e/` only. Do not broadly ignore all `outputs/` because existing user artifacts may rely on visibility.

- [ ] **Step 5: Run orchestrator/report tests**

  Run: `pnpm exec vitest run server/lib/coupon-oa/three-source/e2e/report.test.ts scripts/run-coupon-three-source-e2e-local.test.mjs`

  Expected: PASS, including fail-closed aggregate behavior and redaction assertions.

### Task 8: Add the opt-in DeepSeek contract lane

**Files:**
- Create: `server/lib/coupon-oa/three-source/e2e/deepseek-contract.integration.test.ts`
- Modify: `scripts/run-coupon-three-source-e2e-local.mjs`
- Modify: `server/lib/feishu/deepseek-chat-gateway.ts` only if contract failures prove a schema/timeout classification bug
- Modify: `server/lib/feishu/deepseek-activity-copy-gateway.ts` only if contract failures prove a schema/timeout classification bug

**Interfaces:**
- Consumes only synthetic cases selected from `C02`, `C03`, `C04`, `C07`, `L04`, `L06`, `L07`, and `S12`.
- Produces redacted schema/evidence/audit results and never promotes model output directly to a confirmed business fact.

- [ ] **Step 1: Add opt-in and secret guards**

  Without `COUPON_E2E_ALLOW_DEEPSEEK=true`, assert the test exits before constructing the gateway. With opt-in but no key, fail with a stable local configuration error.

- [ ] **Step 2: Add live contract assertions**

  Verify response schema, evidence coordinates against the synthetic workbook, timeout handling, invalid-candidate isolation, request/response hash audit, and activity-copy coverage of all validated coupon tiers. Do not assert exact wording from a nondeterministic model.

- [ ] **Step 3: Run replay tests by default**

  Run: `pnpm test:coupon-three-source:e2e-local:fast`

  Expected: PASS with zero network calls.

- [ ] **Step 4: Run the live lane only when explicitly requested during implementation**

  Run: `COUPON_E2E_ALLOW_DEEPSEEK=true pnpm test:coupon-three-source:e2e-local:deepseek`

  Expected: PASS or an explicit provider/configuration failure; no Feishu, Drive, Base, object storage, or OA call is permitted in this lane.

### Task 9: Document local operation, evidence boundaries, and case logic

**Files:**
- Create: `docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-e2e-runbook-v1.md`
- Create: `docs/oa-ticket-reimbursement-materials/reference/fixtures/three-source-e2e/README.md`
- Modify: `docs/oa-ticket-reimbursement-materials/current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md`
- Modify: `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-three-source-offline-test-plan-v1.md`
- Modify: `docs/README.md`

**Interfaces:**
- The runbook explains prerequisites, four commands, Docker lifecycle, individual-case execution, output locations, expected-block semantics, redaction, cleanup, troubleshooting, and the explicit difference between local E2E and Feishu manual smoke.
- The fixture README lists all 64 cases in Chinese with input shape, simulated abnormality, expected decision, expected stable code/state, and why the case exists so the user can review the test logic without reading source code.

- [ ] **Step 1: Write the runbook and matrix documentation**

  Include MinIO image-pull troubleshooting, port collisions, database migration failures, leftover schema/prefix checks, DeepSeek opt-in, and the rule that fast-only output is never a complete pass.

- [ ] **Step 2: Update the current implementation baseline**

  Describe the harness as local verification tooling, not a new runtime route. State that the local MinIO adapter/evidence does not authorize R2, production object storage, Drive/Base projection, or native OA.

- [ ] **Step 3: Update the test plan and docs navigation**

  Cross-link the spec, implementation plan, runbook, fixture matrix, and latest generated local evidence location. Preserve proposal/current lifecycle wording.

- [ ] **Step 4: Validate documentation links and forbidden claims**

  Run: `node scripts/check-doc-links.mjs`

  If the repository has no `check-doc-links.mjs`, use: `rtk rg -n "已上线|生产可用|自动创建原生 OA|飞书 E2E 已通过" docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-e2e-runbook-v1.md docs/oa-ticket-reimbursement-materials/reference/fixtures/three-source-e2e/README.md`

  Expected: all links resolve and the new documents make no unsupported rollout claim.

### Task 10: Run the complete local acceptance and record evidence

**Files:**
- Create: `docs/oa-ticket-reimbursement-materials/records/<YYYY-MM-DD>-coupon-three-source-local-e2e-verification.md`
- Do not commit generated contents under: `outputs/coupon-three-source-e2e/`

**Interfaces:**
- The evidence record captures the exact Git revision/dirty-tree disclosure, commands, lane status, case counts, expected blocks, unexpected failures, Docker image IDs, migration range, MinIO adapter status, output report path/hash, network-call boundary, and remaining Feishu-only checks.

- [ ] **Step 1: Run static and focused verification**

  Run: `pnpm typecheck`

  Run: `pnpm lint`

  Run: `pnpm exec vitest run server/lib/coupon-oa/three-source/e2e server/lib/control-plane/s3-canonical-object-store.test.ts scripts/run-coupon-three-source-e2e-local.test.mjs`

  Expected: PASS. If unrelated pre-existing files block repository-wide lint, record the exact paths and run Biome against every changed source file; do not misreport the global result.

- [ ] **Step 2: Run the fast lane twice**

  Run: `pnpm test:coupon-three-source:e2e-local:fast`

  Run the same command again.

  Expected: both runs classify all 64 cases identically, generate more than 100 workbooks, report zero network/native-OA calls, and preserve the source hashes.

- [ ] **Step 3: Run the durable lane with fresh local infrastructure**

  Run: `pnpm infra:down`

  Run: `pnpm test:coupon-three-source:e2e-local:durable`

  Expected: the orchestrator starts healthy PostgreSQL/MinIO, applies migrations, passes object-store and durable workflow scenarios, and cleans its disposable schema/prefix. The command stops containers unless `--keep-infra` was explicitly supplied.

- [ ] **Step 4: Run the aggregate command**

  Run: `pnpm test:coupon-three-source:e2e-local`

  Expected: PASS only when both lanes and final report succeed. Record the final `test-results.json` and Markdown report SHA-256.

- [ ] **Step 5: Run broader regression and build checks**

  Run: `pnpm test`

  Run: `pnpm build`

  Expected: PASS, or exact unrelated/pre-existing blockers are recorded separately without changing the local E2E verdict.

- [ ] **Step 6: Review the evidence boundary before Feishu testing**

  Confirm the record says: local business/durable E2E verified; real Feishu tenant, event transport, file token, card rendering, Vercel Protection, Drive/Base permissions, and Approval/native OA remain unverified. A later Feishu smoke test should cover only those platform boundaries and must retain native OA kill switches unless separately authorized.
