# Coupon Three-Source Business Modes and Screenshots Implementation Plan

> **Implementation status (2026-10-12):** Implemented and verified locally. Not committed, deployed, enabled in Feishu, or approved for native OA submission.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/OA优惠券提报` support 严选、寄卖、POP, prefer ordered user-uploaded calculation images, and generate deterministic PNG tables from the final coupon workbook when 寄卖/POP has no user image.

**Architecture:** Normalize Feishu `image` messages and PNG/JPEG `file` messages into one revisioned user-image collection. Keep image validation/rendering in a pure coupon-domain module, freeze all selected/generated images beside the existing Excel artifacts, then re-download and hash-check them before uploading to the OA image control. The route remains draft-only and reuses the existing OA draft handoff.

**Tech Stack:** TypeScript 7, Nitro/H3, ExcelJS, Sharp, Zod, Vitest, Feishu IM/Drive/Approval adapters, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-12-coupon-three-source-business-modes-and-screenshots-design.md`

## Global Constraints

- `严选` never writes `calcImageFileCodes`; `寄卖` and `pop` require at least one verified image.
- Confirmed user images win; automatic rendering runs only when a non-严选 task has no confirmed user image.
- Accept direct Feishu `image` messages and actual PNG/JPEG `file` messages; reject content that only masquerades by extension or declared MIME.
- Preserve multiple images in confirmed upload order; a pending batch is committed with `append` or `replace_all`.
- Automatic images read final displayed cell values from the generated `couponTable` workbook and never recalculate financial values.
- Source Excel files and unconfirmed images never become OA attachments.
- Keep native OA submission disabled; no task performs real Feishu/Base/Drive/Approval writes during tests.
- Use pnpm, Biome formatting, explicit types, stable error codes/messages, and no `any`, `@ts-ignore`, or `@ts-expect-error`.
- Do not modify or discard unrelated dirty-worktree changes.
- Commit steps are conditional: run them only after the user explicitly authorizes commits.

## Review Focus

- A `.png` file whose bytes are not PNG must be rejected while the current image collection remains unchanged; Task 2 pins this.
- A repeated callback with the same message ID or image hash must not append a duplicate; Task 3 pins this.
- A `replace_all` batch containing one invalid image must leave the previous confirmed collection intact; Tasks 3 and 5 pin this.
- A long workbook that spans multiple PNG pages must preserve every row and page order in `calcImageFileCodes`; Tasks 2 and 6 pin this.
- A Drive object that changes after final confirmation must stop all OA draft creation, including when only the second of several images changes; Task 6 pins this.

---

## File Map

**Create**

- `server/lib/coupon-oa/three-source/calc-image.ts` — image inspection, final-workbook table extraction, pagination, SVG layout, and PNG rendering.
- `server/lib/coupon-oa/three-source/calc-image.test.ts` — pure validation, extraction, deterministic rendering, and pagination tests.

**Modify**

- `package.json`, `pnpm-lock.yaml` — add `sharp` as the only new runtime dependency.
- `server/lib/coupon-oa/three-source/types.ts` — ordered user/generated image and screenshot-page contracts.
- `server/lib/coupon-oa/three-source/task.ts`, `task.test.ts` — v2 aggregate state, pending-batch merge rules, revision invalidation, and artifact validation.
- `server/lib/coupon-oa/three-source/workflow.ts`, `offline.ts`, `offline.test.ts` — array-based screenshot snapshot contract and automatic-render fallback.
- `server/lib/feishu/coupon-oa/three-source/store.ts`, `store.test.ts` — v1-to-v2 state normalization in Base JSON.
- `server/lib/feishu/coupon-oa/three-source/service.ts`, `service.test.ts` — image intake, user-first selection, automatic rendering, freezing, and three-mode generation.
- `server/lib/feishu/coupon-oa/three-source/dispatcher.ts`, `dispatcher.test.ts` — route image/file resources and append/replace callbacks.
- `server/lib/feishu/coupon-oa/three-source/cards.ts`, `cards.test.ts` — counts, pending-batch decision, 严选 ignore warning, and final preview ordering.
- `server/lib/feishu/events.ts`, `events.test.ts` — forward both Feishu message types to the three-source dispatcher.
- `server/lib/feishu/coupon-oa/frozen-artifact-handoff.ts`, `frozen-artifact-handoff.test.ts` — multiple image artifacts and role-specific Approval upload type/MIME.
- `server/lib/feishu/coupon-oa/three-source/handoff.ts`, `handoff.test.ts` — three-mode mapping and ordered `calcImageFileCodes`.
- `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-three-source-workflow-prd-v1.md` — record the newly approved three-mode/image behavior without claiming rollout.
- `docs/oa-ticket-reimbursement-materials/current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md` — replace strict-only code description after implementation.
- `docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md` — add draft-only test cases and keep deployment/Gate caveats.

## Task Dependencies

```text
Task 1 state contracts
  ├─> Task 2 image validator/renderer
  ├─> Task 3 persistent image intake
  │     └─> Task 4 Feishu messages/cards
  └─> Task 5 generation orchestration
        └─> Task 6 OA handoff
              └─> Task 7 docs and full verification
```

### Task 1: Version the ordered image and artifact contracts

**Files:**
- Modify: `server/lib/coupon-oa/three-source/types.ts`
- Modify: `server/lib/coupon-oa/three-source/task.ts`
- Test: `server/lib/coupon-oa/three-source/task.test.ts`

**Interfaces:**
- Produces: `UserCalcImageSource`, `CalcImageMergeMode`, `RenderedCouponScreenshot`, `CouponThreeSourceArtifact` v2, `stageCouponThreeSourceCalcImage()`, and `commitCouponThreeSourceCalcImageBatch()`.
- Consumes: existing owner/revision guards and `nextRevision()` invalidation behavior.

- [ ] **Step 1: Write failing aggregate tests**

Add tests named:

- `stages ordered image sources without changing the confirmed collection`;
- `deduplicates repeated message ids and sha256 values`;
- `appends or atomically replaces a pending image batch`;
- `invalidates confirmations and artifacts when the image collection changes`;
- `accepts many ordered calcImage artifacts but still rejects duplicate Excel roles`;
- `requires generated images to bind the current couponTable hash`.

Assert merge values are exactly `append` and `replace_all`, and assert a failed replacement leaves the prior confirmed array unchanged.

- [ ] **Step 2: Run the aggregate tests and verify the new cases fail**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/task.test.ts`

Expected: FAIL because the new contracts and transition functions do not exist.

- [ ] **Step 3: Add v2 image contracts**

Define these stable shapes:

```ts
export type CalcImageMergeMode = "append" | "replace_all";

export interface UserCalcImageSource {
  artifactId: string;
  messageId: string;
  resourceKey: string;
  resourceType: "image" | "file";
  fileName: string;
  mimeType: "image/png" | "image/jpeg";
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  receivedOrder: number;
}
```

Change screenshot results and frozen artifact metadata to carry `artifactId`, `order`, `mimeType`, `origin: "user" | "generated"`, and generated-only workbook provenance. Make screenshot inputs/outputs arrays everywhere rather than one optional screenshot.

- [ ] **Step 4: Implement aggregate transitions**

Add exact signatures:

```ts
export function stageCouponThreeSourceCalcImage(input: {
  task: CouponThreeSourceTask;
  ownerOpenId: string;
  expectedRevision: number;
  image: UserCalcImageSource;
}): CouponThreeSourceTask;

export function commitCouponThreeSourceCalcImageBatch(input: {
  task: CouponThreeSourceTask;
  ownerOpenId: string;
  expectedRevision: number;
  mode: CalcImageMergeMode;
}): CouponThreeSourceTask;
```

Store `confirmedCalcImages` and `pendingCalcImages` on the task. Limit each image to 10 MiB, each decoded image to 40,000,000 pixels, and the confirmed collection to 20 images. Deduplicate by message ID and SHA-256 while preserving first-seen order.

- [ ] **Step 5: Run the aggregate tests**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/task.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit only if explicitly authorized**

```bash
git add server/lib/coupon-oa/three-source/types.ts server/lib/coupon-oa/three-source/task.ts server/lib/coupon-oa/three-source/task.test.ts
git commit -m "feat(coupon-oa): add revisioned calculation images"
```

### Task 2: Validate user images and render final workbook values

**Files:**
- Create: `server/lib/coupon-oa/three-source/calc-image.ts`
- Create: `server/lib/coupon-oa/three-source/calc-image.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `OfflineArtifact` and `RenderedCouponScreenshot` from Task 1.
- Produces: `inspectUserCalcImage()`, `extractCouponScreenshotTable()`, `paginateCouponScreenshotTable()`, and `renderCouponArtifactScreenshots()`.

- [ ] **Step 1: Add `sharp` with pnpm**

Run: `pnpm add sharp`

Expected: `package.json` and `pnpm-lock.yaml` contain one new runtime dependency and no npm/yarn lockfile appears.

- [ ] **Step 2: Write failing image-validation tests**

Cover real PNG, real JPEG, extension spoofing, empty bytes, corrupt bytes, 10 MiB limit, 40,000,000-pixel limit, and unsupported GIF/SVG. Assert invalid input returns no metadata and throws a stable Chinese validation error.

- [ ] **Step 3: Write failing workbook-render tests**

Build an in-memory final `满减券` workbook containing cached formula results and enough rows to span pages. Assert:

- extraction returns every non-empty header and every displayed data value;
- `预估ROI`, `预计费用`, and `预计引入GMV` equal the workbook cell text;
- pagination contains every row exactly once and preserves row order;
- repeated rendering returns the same display-value hash and ordered metadata;
- every output starts with the PNG signature and binds the input workbook SHA-256.

- [ ] **Step 4: Run the new test file and verify failure**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/calc-image.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 5: Implement validation and final-workbook extraction**

Add exact signatures:

```ts
export async function inspectUserCalcImage(input: {
  bytes: Uint8Array;
  fileName?: string;
}): Promise<{
  fileName: string;
  mimeType: "image/png" | "image/jpeg";
  bytes: number;
  width: number;
  height: number;
  sha256: string;
}>;

export async function extractCouponScreenshotTable(
  couponArtifact: OfflineArtifact,
): Promise<CouponScreenshotTable>;
```

Use Sharp metadata for decoded type/dimensions and byte signatures for fail-closed type agreement. Use ExcelJS to load only the generated `couponTable`, verify its SHA-256, read `满减券`, and consume `cell.text`; never evaluate formulas.

- [ ] **Step 6: Implement deterministic SVG-to-PNG pagination**

Add:

```ts
export function paginateCouponScreenshotTable(
  table: CouponScreenshotTable,
): CouponScreenshotPage[];

export async function renderCouponArtifactScreenshots(input: {
  couponArtifact: OfflineArtifact;
  revision: number;
}): Promise<RenderedCouponScreenshot[]>;
```

Use a fixed renderer version, 1600-pixel canvas, escaped SVG text, fixed numeric alignment, a maximum of 24 data rows per vertical page, and horizontal column groups that repeat the activity/coupon identity columns. Preserve every non-empty workbook column and include page/group numbering; Sharp rasterizes SVG to PNG.

- [ ] **Step 7: Run and format the new module**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/calc-image.test.ts && pnpm biome check --write server/lib/coupon-oa/three-source/calc-image.ts server/lib/coupon-oa/three-source/calc-image.test.ts`

Expected: tests PASS and Biome reports no remaining errors.

- [ ] **Step 8: Commit only if explicitly authorized**

```bash
git add package.json pnpm-lock.yaml server/lib/coupon-oa/three-source/calc-image.ts server/lib/coupon-oa/three-source/calc-image.test.ts
git commit -m "feat(coupon-oa): render calculation images"
```

### Task 3: Persist and service the pending image batch

**Files:**
- Modify: `server/lib/feishu/coupon-oa/three-source/store.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/store.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/service.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/service.test.ts`

**Interfaces:**
- Consumes: Task 1 aggregate transitions and Task 2 `inspectUserCalcImage()`.
- Produces: v1-to-v2 state normalization, `receiveCalcImage()`, and `commitCalcImageBatch()` service methods for Task 4.

- [ ] **Step 1: Write failing store compatibility tests**

Assert a stored `coupon-three-source-r2-v1`/pilot-v1 JSON record loads as v2 with empty confirmed/pending arrays, while a v2 record round-trips ordered image metadata. Assert unknown schema versions still fail closed.

- [ ] **Step 2: Write failing service intake tests**

Cover direct-image and file-image references, duplicate message/hash idempotency, ordered staging, append, atomic replacement, owner failure, stale revision, invalid image bytes, and unchanged prior images after failed replacement.

- [ ] **Step 3: Run the focused tests and verify failure**

Run: `pnpm vitest run server/lib/feishu/coupon-oa/three-source/store.test.ts server/lib/feishu/coupon-oa/three-source/service.test.ts`

Expected: FAIL on missing v2 normalization and service methods.

- [ ] **Step 4: Implement compatibility normalization**

Bump task/pilot schema constants to v2. Add a pure `normalizeStoredThreeSourceState()` that accepts only the known v1 and v2 shapes, supplies empty image arrays to v1, and writes v2 on the next update without adding a new Base column.

- [ ] **Step 5: Implement image intake methods**

Add:

```ts
async receiveCalcImage(input: {
  draft: CouponThreeSourcePilotDraft;
  ownerOpenId: string;
  expectedRevision: number;
  messageId: string;
  resourceKey: string;
  resourceType: "image" | "file";
  fileName?: string;
  bytes: Uint8Array;
}): Promise<CouponThreeSourcePilotDraft>;

async commitCalcImageBatch(input: {
  draft: CouponThreeSourcePilotDraft;
  ownerOpenId: string;
  expectedRevision: number;
  mode: CalcImageMergeMode;
  operationId: string;
}): Promise<CouponThreeSourcePilotDraft>;
```

`receiveCalcImage()` validates bytes before updating Base. `commitCalcImageBatch()` delegates to the aggregate and remains idempotent by operation/message identity.

- [ ] **Step 6: Run the store/service tests**

Run: `pnpm vitest run server/lib/feishu/coupon-oa/three-source/store.test.ts server/lib/feishu/coupon-oa/three-source/service.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit only if explicitly authorized**

```bash
git add server/lib/feishu/coupon-oa/three-source/store.ts server/lib/feishu/coupon-oa/three-source/store.test.ts server/lib/feishu/coupon-oa/three-source/service.ts server/lib/feishu/coupon-oa/three-source/service.test.ts
git commit -m "feat(coupon-oa): persist user calculation images"
```

### Task 4: Accept both Feishu image entry points and expose merge controls

**Files:**
- Modify: `server/lib/feishu/events.ts`
- Modify: `server/lib/feishu/events.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/dispatcher.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/cards.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/cards.test.ts`

**Interfaces:**
- Consumes: Task 3 `receiveCalcImage()` and `commitCalcImageBatch()`.
- Produces: `dispatchResource()` support for `file | image`, callback actions `coupon_three_source_calc_images_append` and `coupon_three_source_calc_images_replace_all`, and card copy/counts.

- [ ] **Step 1: Write failing event and dispatcher tests**

Assert `image` content reads `image_key` and downloads with `type=image`; PNG/JPEG file content reads `file_key`/`file_name` and downloads with `type=file`; `.xlsx` still follows source recognition; unrelated images without an active three-source task remain ignored; duplicates do not send duplicate cards.

- [ ] **Step 2: Write failing card/callback tests**

Assert cards show confirmed/pending counts and ordered filenames, offer append/replace only when both collections are non-empty, warn that 严选 ignores images, and include image order in final preview. Assert stale-card, non-owner, repeated-click, and missing-pending-batch callbacks fail closed.

- [ ] **Step 3: Run the focused tests and verify failure**

Run: `pnpm vitest run server/lib/feishu/events.test.ts server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts server/lib/feishu/coupon-oa/three-source/cards.test.ts`

Expected: FAIL because image resources and merge actions are not routed.

- [ ] **Step 4: Generalize the dispatcher resource contract**

Replace the file-only dependency with:

```ts
downloadResource(input: {
  messageId: string;
  resourceKey: string;
  type: "file" | "image";
}): Promise<Uint8Array>;
```

Parse `image_key` only for image messages. For file messages, download once: `.xlsx` candidates preserve the existing workbook path, while every other file is inspected by decoded content and accepted only when it is a real PNG/JPEG. Never accept image truth from filename alone, and never pass a corrupt `.png`/`.jpg` into workbook recognition.

- [ ] **Step 5: Add merge actions and cards**

Stage image messages silently like existing unambiguous Excel uploads during initial collection. If the mapping card already exists, update it in place after each new image so it shows current pending/confirmed counts. When both collections exist, require the owner to choose append or replace before source generation; when only the first pending batch exists, commit it as append during source confirmation. Bind both actions to record ID and revision.

- [ ] **Step 6: Run the event/dispatcher/card tests**

Run: `pnpm vitest run server/lib/feishu/events.test.ts server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts server/lib/feishu/coupon-oa/three-source/cards.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit only if explicitly authorized**

```bash
git add server/lib/feishu/events.ts server/lib/feishu/events.test.ts server/lib/feishu/coupon-oa/three-source/dispatcher.ts server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts server/lib/feishu/coupon-oa/three-source/cards.ts server/lib/feishu/coupon-oa/three-source/cards.test.ts
git commit -m "feat(coupon-oa): accept Feishu calculation images"
```

### Task 5: Generate and freeze the correct image set for all three modes

**Files:**
- Modify: `server/lib/coupon-oa/three-source/workflow.ts`
- Modify: `server/lib/coupon-oa/three-source/offline.ts`
- Modify: `server/lib/coupon-oa/three-source/offline.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/service.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/service.test.ts`

**Interfaces:**
- Consumes: Task 2 renderer and Task 3 confirmed user image metadata.
- Produces: array-based `buildOaPrefillSnapshot({ screenshots })` and three-mode `confirmSourcesAndGenerate()`.

- [ ] **Step 1: Replace the old rejection test with a three-mode matrix**

Add service cases for:

- 严选 with no image: two/three Excel artifacts only and renderer not called;
- 严选 with confirmed user images: warning retained, no `calcImage` frozen;
- 寄卖 and pop with confirmed user images: user order preserved and renderer not called;
- 寄卖 and pop without user images: renderer called once with the final `couponTable` and every returned page frozen;
- invalid re-download of one user image: no image/Excel artifact state is saved;
- renderer failure and partial Drive upload failure: no final snapshot or OA draft exists;
- repeated operation ID: no duplicate generated pages or Drive uploads.

- [ ] **Step 2: Write failing workflow tests for image arrays**

Assert the prefill snapshot hash changes with image order, rejects duplicate artifact IDs, rejects non-严选 without images, rejects generated images bound to another workbook hash, and rejects 严选 with images.

- [ ] **Step 3: Run the workflow/service tests and verify failure**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/offline.test.ts server/lib/feishu/coupon-oa/three-source/service.test.ts`

Expected: FAIL on the current strict-only guard and singular screenshot contract.

- [ ] **Step 4: Make workflow snapshots array-based**

Change the exact input to:

```ts
export interface BuildOaPrefillSnapshotInput {
  package: CanonicalPackage;
  artifacts: OfflineArtifact[];
  screenshots: RenderedCouponScreenshot[];
  activityPointPercent: number;
}
```

Hash ordered screenshot metadata, validate unique IDs/orders, and enforce the mode matrix before returning the snapshot.

- [ ] **Step 5: Implement user-first service orchestration**

Remove the hard-coded non-严选 rejection. After standard Excel generation:

1. resolve the pending batch decision;
2. for 严选, select no images;
3. for non-严选 with confirmed user images, re-download every message resource and verify bytes/hash/type;
4. otherwise call `renderCouponArtifactScreenshots()` on the generated coupon artifact;
5. upload Excel with XLSX MIME and images with their image MIME;
6. save all metadata with `requiresCalcImage = businessMode !== "严选"`;
7. build one ordered OA prefill snapshot.

Do not persist a successful final state until all required uploads have returned stable Drive tokens.

- [ ] **Step 6: Run the workflow/service tests**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/offline.test.ts server/lib/feishu/coupon-oa/three-source/service.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit only if explicitly authorized**

```bash
git add server/lib/coupon-oa/three-source/workflow.ts server/lib/coupon-oa/three-source/offline.ts server/lib/coupon-oa/three-source/offline.test.ts server/lib/feishu/coupon-oa/three-source/service.ts server/lib/feishu/coupon-oa/three-source/service.test.ts
git commit -m "feat(coupon-oa): generate three-mode screenshot artifacts"
```

### Task 6: Upload ordered images to the OA draft safely

**Files:**
- Modify: `server/lib/feishu/coupon-oa/frozen-artifact-handoff.ts`
- Modify: `server/lib/feishu/coupon-oa/frozen-artifact-handoff.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/handoff.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/handoff.test.ts`

**Interfaces:**
- Consumes: Task 5 ordered frozen artifacts and prefill snapshot.
- Produces: verified OA attachment uploads and three-mode `CouponOaDraftValues` with ordered `calcImageFileCodes`.

- [ ] **Step 1: Write failing frozen-handoff tests**

Assert Excel roles remain unique; several unique `calcImage` artifacts are allowed; images upload with `type=image` and their actual MIME; Excel uploads use `type=attachment`; result order matches artifact order; duplicate image artifact IDs/orders fail before any Drive read; a changed second image prevents every Approval upload.

- [ ] **Step 2: Write failing OA mapping tests**

Assert 严选 maps with no image codes; 寄卖 and pop map all image codes in order; non-严选 missing an image fails; 严选 containing an image fails; prefill/frozen/uploaded image count or order mismatch fails; existing active OA draft still blocks all uploads.

- [ ] **Step 3: Run handoff tests and verify failure**

Run: `pnpm vitest run server/lib/feishu/coupon-oa/frozen-artifact-handoff.test.ts server/lib/feishu/coupon-oa/three-source/handoff.test.ts`

Expected: FAIL because frozen artifacts exclude `calcImage` and the mapper rejects non-严选.

- [ ] **Step 4: Generalize verified artifact upload**

Expand `FrozenCouponOaArtifact` to include image artifacts. Validate all Drive downloads first, in order, before starting any Approval upload. Then upload Excel as attachments and PNG/JPEG as images. Preserve artifact ID/order in `CouponOaAttachment` so mapping can compare the result to the prefill snapshot.

- [ ] **Step 5: Implement the mode-aware OA mapper**

Remove strict-only rejection and compute ordered `calcImageFileCodes` from verified image attachments. Reuse `couponApplicationValuesSchema` as the final validation boundary so non-严选 cannot escape the existing image requirement.

- [ ] **Step 6: Run handoff and Approval schema tests**

Run: `pnpm vitest run server/lib/feishu/coupon-oa/frozen-artifact-handoff.test.ts server/lib/feishu/coupon-oa/three-source/handoff.test.ts server/lib/feishu/coupon-oa/approval-schema.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit only if explicitly authorized**

```bash
git add server/lib/feishu/coupon-oa/frozen-artifact-handoff.ts server/lib/feishu/coupon-oa/frozen-artifact-handoff.test.ts server/lib/feishu/coupon-oa/three-source/handoff.ts server/lib/feishu/coupon-oa/three-source/handoff.test.ts
git commit -m "feat(coupon-oa): hand off ordered calculation images"
```

### Task 7: Align product/operations docs and run the full verification gate

**Files:**
- Modify: `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-three-source-workflow-prd-v1.md`
- Modify: `docs/oa-ticket-reimbursement-materials/current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md`
- Modify: `docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md`
- Verify: all files changed in Tasks 1–6

**Interfaces:**
- Consumes: completed behavior and verification evidence from Tasks 1–6.
- Produces: truthful product/implementation/runbook boundaries and a release-ready local change set.

- [ ] **Step 1: Update the product and implementation boundaries**

Document all three modes, both image entry points, ordered append/replace, user-first fallback, simple final-workbook rendering, and the unchanged draft-only/native-submit Gate. Remove only strict-only statements that the implementation has actually superseded; retain proposal/POC status language.

- [ ] **Step 2: Update the POC runbook**

Add separate test cases for 严选 no-image, 寄卖 user-image, POP automatic-image, multi-image append/replace, duplicate callback, corrupt image, render failure, changed Drive bytes, and native-submit non-invocation. Do not add real credentials or imply deployment approval.

- [ ] **Step 3: Run the affected suites**

Run:

```bash
pnpm vitest run \
  server/lib/coupon-oa/three-source \
  server/lib/feishu/coupon-oa/three-source \
  server/lib/feishu/coupon-oa/frozen-artifact-handoff.test.ts \
  server/lib/feishu/events.test.ts \
  server/lib/feishu/coupon-oa/approval-schema.test.ts
```

Expected: all tests PASS; no real network call occurs.

- [ ] **Step 4: Run repository quality gates**

Run: `pnpm lint && pnpm typecheck && pnpm build`

Expected: every command exits 0.

- [ ] **Step 5: Inspect the final diff and dirty-worktree boundaries**

Run: `git diff --check && git status --short && git diff --stat`

Expected: no whitespace errors; only planned files plus the user's pre-existing unrelated changes are present; no `.env*`, build output, real case data, screenshots, tokens, or credentials are added.

- [ ] **Step 6: Commit only if explicitly authorized**

```bash
git add package.json pnpm-lock.yaml server/lib/coupon-oa/three-source server/lib/feishu/coupon-oa/three-source server/lib/feishu/coupon-oa/frozen-artifact-handoff.ts server/lib/feishu/coupon-oa/frozen-artifact-handoff.test.ts server/lib/feishu/events.ts server/lib/feishu/events.test.ts docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-three-source-workflow-prd-v1.md docs/oa-ticket-reimbursement-materials/current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md docs/superpowers/specs/2026-10-12-coupon-three-source-business-modes-and-screenshots-design.md docs/superpowers/plans/2026-10-12-coupon-three-source-business-modes-and-screenshots.md
git commit -m "feat(coupon-oa): support three-mode calculation images"
```

## Completion Criteria

- The previous `三源 Bot 首期仅支持严选业务模式` failure is gone from both generation and OA mapping.
- All three modes reach the same system OA draft handoff under their image rules.
- User images from both Feishu message forms are ordered, deduplicated, revisioned, and preferred.
- Non-严选 without user images receives complete PNG page(s) derived from the final generated workbook display values.
- Every frozen image is re-downloaded and hash-checked before ordered Approval image upload.
- Tests prove duplicate delivery, stale callbacks, retries, replacement atomicity, partial failures, and changed Drive bytes do not create duplicate or incomplete drafts.
- Docs state capability accurately without claiming deployment, permission, rollout approval, or native OA submission.
