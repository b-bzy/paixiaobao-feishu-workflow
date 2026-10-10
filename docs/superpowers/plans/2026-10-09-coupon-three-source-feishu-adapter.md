# Coupon Three-Source Feishu Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the full local `/OA优惠券提报` three-source workflow run in the allowlisted Feishu Bot pilot for the strict-only coupon scenario, then hand its frozen OA test draft to the existing explicit send/readback path.

**Architecture:** Keep business interpretation in `server/lib/coupon-oa/three-source/`, add a compact Base-backed Feishu session adapter for message references, selected mappings, revisioned standard artifacts, and cards, then create the existing `CouponOaDraft` from verified generated Drive files. The existing OA preview, final confirmation, native-submit gates, approval creation, and readback remain unchanged; the new adapter never calls instance creation directly.

**Tech Stack:** Nitro/TypeScript, Vitest, ExcelJS, existing Feishu Bot/Card/Drive/Base/Approval adapters, existing coupon Excel template engine.

**Spec:**
- `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-three-source-workflow-prd-v1.md`
- `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-unified-skill-upgrade-plan-v1.md`

## Global Constraints

- Exact single-chat entry point: `/OA优惠券提报`; do not repurpose `优惠券Excel试点`, `OA优惠券填报`, or `OA优惠券审批`.
- First delivery supports only the registered regular-full-reduction template, SKU whitelist/blacklist format, and `严选` business mode. Reject `寄卖` and `pop` before generation because their mandatory screenshot attachment has no approved server renderer.
- Accept a source coupon workbook, required whitelist, and optional blacklist in any order. File names are hints only; ambiguous role, field, Sheet, column, tier, or ID-dimension choices require an owner card action.
- A missing blacklist is not an empty blacklist: the owner must explicitly select `本次无黑名单`; an invalid uploaded blacklist always blocks progress.
- Source files are never OA attachments. Only current-revision, generated, Drive-frozen files that pass a re-download SHA-256/size check may be uploaded to the existing approval attachment API.
- Any source, mapping, supplement, no-blacklist acknowledgement, or overlap-decision change increments the revision and invalidates outputs and the linked OA test draft.
- The new route is disabled by default and checks the existing coupon-OA server allowlist before it reads a source file or creates state. Native OA creation remains exclusively guarded by the existing native-submit mode, kill switch, dedicated allowlist, owner, definition hash, and readback checks.
- New code must not start a bridge, change Feishu configuration, enable a feature flag, call real Feishu/OA in automated tests, or create cloud resources. Preserve all existing uncommitted work and do not commit unless the user explicitly asks.
- Use pnpm and the repository’s TypeScript/Vitest conventions. Do not introduce a new workflow framework, queue, ORM, renderer service, or a second native-submit implementation.

## Review Focus

1. **Ambiguous workbook input:** a role/field/list-column ambiguity must render an owner selection and never choose a source or generate artifacts; cover in Tasks 1 and 4.
2. **Blacklist semantics:** absent-pending, explicitly absent, uploaded-valid, and uploaded-invalid must remain distinct; an invalid upload cannot be converted to no-blacklist; cover in Tasks 1 and 4.
3. **Stale or unauthorized callbacks:** another user, a replayed operation, or an old revision cannot alter state, generate files, hand off a draft, or send OA; cover in Tasks 2, 4, and 5.
4. **Artifact substitution:** a changed Drive file, wrong artifact role, or missing standard output stops before approval-file upload; cover in Task 3.
5. **Unexpected native OA creation:** command, file reception, mapping, first confirmation, generation, and OA-test-draft handoff all make zero native instance-create calls; only the pre-existing final send callback may call the existing submit service; cover in Tasks 4 and 5.

---

## File Structure

| Path | Responsibility after implementation |
| --- | --- |
| `server/lib/coupon-oa/three-source/recognition.ts` | Applies an explicit field-candidate selection when recognition is ambiguous. |
| `server/lib/coupon-oa/three-source/workflow.ts` | Builds strict-only OA prefill without a screenshot while retaining screenshot requirements for non-strict modes. |
| `server/lib/coupon-oa/three-source/task.ts` | Allows artifact freezing without `calcImage` only when the application layer has derived that the selected business mode does not require one. |
| `server/lib/feishu/coupon-oa/three-source/pilot-config.ts` | Default-closed configuration for the narrow three-source Bot pilot. |
| `server/lib/feishu/coupon-oa/three-source/assets.ts` | Loads the three registered workbook templates from the existing Nitro server-asset namespace. |
| `server/lib/feishu/coupon-oa/three-source/store.ts` | Persists one revisioned Base-backed three-source session per owner, including message references, selections, parsed state, artifacts, and OA-draft handoff. |
| `server/lib/feishu/coupon-oa/three-source/service.ts` | Orchestrates source inspection, owner selections, confirmation, artifact generation/upload, and handoff readiness. |
| `server/lib/feishu/coupon-oa/three-source/handoff.ts` | Re-downloads verified Drive artifacts, obtains approval file codes, maps strict-only prefill data, and creates/reuses a `CouponOaDraft`; never submits native OA. |
| `server/lib/feishu/coupon-oa/three-source/cards.ts` | Renders intake, role/mapping, no-blacklist, overlap, source-confirmation, final-preview, error, and resume cards. |
| `server/lib/feishu/coupon-oa/three-source/dispatcher.ts` | Handles the exact command, file receipt, and card actions using the new service; leaves existing invocations untouched. |
| `server/lib/feishu/events.ts` | Delegates only recognized three-source messages/files/callbacks to the dispatcher before legacy coupon routes. |
| `server/lib/feishu/coupon-oa/frozen-artifact-handoff.ts` | Shared verify-download-and-upload helper used by both the existing Excel pilot and the new three-source handoff. |
| `server/assets/coupon-excel/*.xlsx` | Bundled registered coupon, multi-tier whitelist, and multi-tier blacklist templates. |
| `.env.example` and pilot Base-field manifest/setup script | Documents the disabled-by-default pilot flag, dedicated Base table, and dedicated Drive folder. |

### Task 1: Make the pure three-source contracts support selected mappings and strict-only prefill

**Files:**
- Modify: `server/lib/coupon-oa/three-source/recognition.ts`
- Modify: `server/lib/coupon-oa/three-source/workflow.ts`
- Modify: `server/lib/coupon-oa/three-source/task.ts`
- Modify: `server/lib/coupon-oa/three-source/offline.test.ts`
- Modify: `server/lib/coupon-oa/three-source/task.test.ts`

**Interfaces:**
- Consumes: `WorkbookRecognition`, `CouponFieldKey`, `ParsedTieredIdentifierList`, `CanonicalPackage`, and `RegularFullReductionInput`.
- Produces: `extractRegularFullReductionInput({ recognition, fieldCandidateIds })`, `buildOaPrefillSnapshot({ package, artifacts, screenshot?, activityPointPercent })`, and `saveCouponThreeSourceArtifacts({ task, ownerOpenId, expectedRevision, artifacts, requiresCalcImage })`.

- [ ] **Step 1: Add failing recognition tests for explicit field selection**

In `offline.test.ts`, create a workbook fixture with two valid candidates for one coupon field. Assert that extraction rejects without its selected candidate ID, succeeds with the owner-selected ID, and rejects an ID not belonging to that field.

- [ ] **Step 2: Run the focused failing recognition test**

Run:

```bash
pnpm exec vitest run server/lib/coupon-oa/three-source/offline.test.ts
```

Expected: FAIL because `extractRegularFullReductionInput` does not accept a field-selection object.

- [ ] **Step 3: Add explicit coupon field-selection support**

Change `extractRegularFullReductionInput` to accept an object with `recognition: WorkbookRecognition` and optional `fieldCandidateIds: Partial<Record<CouponFieldKey, string>>`. Use the supplied candidate only when it belongs to the requested field; preserve automatic selection only when there is exactly one candidate. Update existing callers and tests to use the new signature.

- [ ] **Step 4: Add failing strict-only prefill and artifact-freeze tests**

Add tests that:

- build a `严选` canonical package with generated coupon/whitelist artifacts and no screenshot, then assert a valid OA prefill has no `calcImage` attachment;
- reject a `寄卖` or `pop` package without a screenshot;
- allow `saveCouponThreeSourceArtifacts(..., requiresCalcImage: false)` without a `calcImage`, while preserving rejection when `requiresCalcImage: true`.

- [ ] **Step 5: Implement the strict-only no-screenshot path**

Make `screenshot` optional in `buildOaPrefillSnapshot`; derive its necessity from `package.coupon.input.businessMode !== "严选"`. Validate all supplied screenshots as before. Add the explicit `requiresCalcImage` parameter to the aggregate artifact transition and keep the default safety behavior at the application boundary rather than trusting a card value.

- [ ] **Step 6: Run pure three-source regressions**

Run:

```bash
pnpm exec vitest run \
  server/lib/coupon-oa/three-source/offline.test.ts \
  server/lib/coupon-oa/three-source/task.test.ts
```

Expected: PASS, including existing blacklisting, overlap, hash, screenshot, and stale-revision contracts.

- [ ] **Step 7: Leave the task uncommitted**

Do not commit; the user has not authorized a commit. Record the focused command result for the later Test-Plan/QA handoff.

### Task 2: Add disabled-by-default pilot assets, configuration, and persistent session storage

**Files:**
- Create: `server/lib/feishu/coupon-oa/three-source/pilot-config.ts`
- Create: `server/lib/feishu/coupon-oa/three-source/pilot-config.test.ts`
- Create: `server/lib/feishu/coupon-oa/three-source/assets.ts`
- Create: `server/lib/feishu/coupon-oa/three-source/assets.test.ts`
- Create: `server/lib/feishu/coupon-oa/three-source/store.ts`
- Create: `server/lib/feishu/coupon-oa/three-source/store.test.ts`
- Create: `server/assets/coupon-excel/商品明细白名单-多券档SKU-v1.xlsx`
- Create: `server/assets/coupon-excel/商品明细黑名单-多券档SKU-v1.xlsx`
- Create: `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-three-source-pilot-base-fields-v1.json`
- Create: `scripts/create-coupon-three-source-pilot-table.sh`
- Modify: `.env.example`

**Interfaces:**
- Consumes: the existing `assets:server` / `coupon-excel` Nitro asset namespace, `FEISHU_BASE_APP_TOKEN`, `getTenantAccessToken`, and Base/Drive client conventions from `excel-pilot-store.ts`.
- Produces: `isCouponThreeSourcePilotEnabled()`, `getCouponThreeSourcePilotTableId()`, `getCouponThreeSourcePilotFolderToken()`, `loadCouponThreeSourceTemplates()`, and a `CouponThreeSourcePilotStore` with `create`, `get`, `listActiveByOwner`, and revision-checked `update` methods.

- [ ] **Step 1: Write failing config and asset tests**

Test that pilot configuration is false without an exact `FEISHU_COUPON_THREE_SOURCE_PILOT_ENABLED=true`, table IDs reject malformed values, and required folder/table values fail with stable configuration errors. Test that the asset loader retrieves the coupon, multi-tier whitelist, and multi-tier blacklist manifests by their registered asset names from `assets:server`.

- [ ] **Step 2: Run the config/asset tests to verify failure**

Run:

```bash
pnpm exec vitest run \
  server/lib/feishu/coupon-oa/three-source/pilot-config.test.ts \
  server/lib/feishu/coupon-oa/three-source/assets.test.ts
```

Expected: FAIL because the pilot config and asset loader do not exist.

- [ ] **Step 3: Implement pilot configuration and asset loading**

Keep this configuration separate from `FEISHU_COUPON_THREE_SOURCE_R2_*`: add only the disabled-by-default pilot enable flag, dedicated Base-table ID, and dedicated Drive-folder token. Load all three registered templates through `useStorage("assets:server")` under the existing `coupon-excel` prefix. Copy only the registered template fixtures from `docs/oa-ticket-reimbursement-materials/reference/templates/` into `server/assets/coupon-excel/`; do not copy ignored case data.

- [ ] **Step 4: Write failing Base-store tests**

Define a persisted `CouponThreeSourcePilotDraft` that composes:

```ts
{
  recordId: string;
  task: CouponThreeSourceTask;
  sources: Partial<Record<SourceRole, { messageId; fileKey; fileName; bytes; sha256; recognition? }>>;
  selections: { couponFieldCandidateIds?: Partial<Record<CouponFieldKey, string>>; whitelist?: ListColumnSelection; blacklist?: ListColumnSelection; activityPointPercent?: number; overlapDecision?: OverlapDecision };
  artifacts: FrozenDriveArtifact[];
  oaPrefill?: OaPrefillSnapshot;
  oaDraftRecordId?: string;
  processedMessageIds: string[];
  validationIssues: string[];
  failureReason?: string;
}
```

Test create, active-owner lookup, revision increment, stale-update rejection, message-id dedupe, and JSON round-trip. Assert no source bytes are stored in Base fields.

- [ ] **Step 5: Implement the Base-backed store and provisioning contract**

Mirror `excel-pilot-store.ts`’s Base request/error style, but use a dedicated table and one canonical JSON state field plus indexed owner/status/revision/task-ID fields. Implement the setup script to require its Base token from the caller environment rather than embedding one. Add the schema field manifest and `.env.example` entries with all pilot values disabled/empty.

- [ ] **Step 6: Run persistence/config/asset tests**

Run:

```bash
pnpm exec vitest run \
  server/lib/feishu/coupon-oa/three-source/pilot-config.test.ts \
  server/lib/feishu/coupon-oa/three-source/assets.test.ts \
  server/lib/feishu/coupon-oa/three-source/store.test.ts
```

Expected: PASS; no actual Base, Drive, or Feishu request is made.

- [ ] **Step 7: Leave the task uncommitted**

Do not commit; preserve the user’s unrelated working-tree changes.

### Task 3: Reuse verified artifact promotion and add the strict-only three-source OA-draft handoff

**Files:**
- Create: `server/lib/feishu/coupon-oa/frozen-artifact-handoff.ts`
- Create: `server/lib/feishu/coupon-oa/frozen-artifact-handoff.test.ts`
- Modify: `server/lib/feishu/coupon-oa/excel-pilot-oa-handoff.ts`
- Modify: `server/lib/feishu/coupon-oa/excel-pilot-oa-handoff.test.ts`
- Create: `server/lib/feishu/coupon-oa/three-source/handoff.ts`
- Create: `server/lib/feishu/coupon-oa/three-source/handoff.test.ts`

**Interfaces:**
- Consumes: frozen artifact metadata `{ role, fileName, fileToken, bytes, sha256 }`, `downloadFeishuDriveFile`, `uploadCouponApprovalFile`, `createCouponOaDraft`, and the pure `OaPrefillSnapshot`.
- Produces: `uploadVerifiedCouponOaArtifacts(input): Promise<CouponOaAttachment[]>`, `mapThreeSourcePrefillToOaValues(input): CouponOaDraftValues`, and `handoffThreeSourcePilotToOaDraft(input): Promise<CouponOaDraft>`.

- [ ] **Step 1: Write failing shared artifact-promotion tests**

Test that the shared helper downloads each frozen Drive artifact, checks exact byte size and SHA-256 before upload, preserves permitted roles (`couponTable`, `productWhitelist`, optional `productBlacklist`), and performs zero upload calls on any mismatch.

- [ ] **Step 2: Extract and adopt the shared verified artifact helper**

Move the verify-download-upload logic from `excel-pilot-oa-handoff.ts` into `frozen-artifact-handoff.ts`; retain the Excel pilot’s current behavior and test assertions unchanged. The helper must not create a native Approval instance.

- [ ] **Step 3: Write failing three-source handoff tests**

With fake Drive, approval-upload, and draft-store dependencies, assert that a strict-only `OaPrefillSnapshot`:

- maps `JD`/`PAIPAI` to existing OA channel labels;
- creates exactly one draft containing verified coupon/whitelist and optional blacklist file codes;
- contains no `calcImageFileCodes` for `严选`;
- refuses non-严选 input, a missing mandatory generated artifact, a stale/changed artifact, or an unrelated active draft;
- never calls `createCouponApprovalInstance` or `submitConfirmedCouponOaDraft`.

- [ ] **Step 4: Implement three-source-to-draft handoff**

Use only server-derived `OaPrefillSnapshot`, current task owner, and verified generated Drive artifacts. Reuse `listActiveCouponOaDrafts`/`createCouponOaDraft`; retain an existing three-source handoff’s `oaDraftRecordId` rather than creating a duplicate. Do not accept OA field or attachment codes from card values.

- [ ] **Step 5: Run handoff regressions**

Run:

```bash
pnpm exec vitest run \
  server/lib/feishu/coupon-oa/frozen-artifact-handoff.test.ts \
  server/lib/feishu/coupon-oa/excel-pilot-oa-handoff.test.ts \
  server/lib/feishu/coupon-oa/three-source/handoff.test.ts
```

Expected: PASS, including all pre-existing Excel-pilot handoff tests.

- [ ] **Step 6: Leave the task uncommitted**

Do not commit without explicit user authorization.

### Task 4: Implement revisioned three-source service and cards

**Files:**
- Modify: `server/lib/feishu/coupon-oa/three-source/cards.ts`
- Create: `server/lib/feishu/coupon-oa/three-source/cards.test.ts`
- Create: `server/lib/feishu/coupon-oa/three-source/service.ts`
- Create: `server/lib/feishu/coupon-oa/three-source/service.test.ts`

**Interfaces:**
- Consumes: Task 1 pure recognition/list/workflow APIs; Task 2 store/config/assets; Task 3 handoff; existing `uploadFeishuDriveFile`; selected message bytes injected by the dispatcher.
- Produces: `CouponThreeSourcePilotService` methods for `startOrResume`, `receiveSource`, `selectRoleAndMappings`, `confirmNoBlacklist`, `confirmSources`, `confirmFinalPreview`, and `cancel`.

- [ ] **Step 1: Write failing card-contract tests**

Assert cards contain only record/task IDs, current revision, and action/selection values. Cover: intake; ambiguous role; coupon field selection; whitelist/blacklist ID/tier selection; explicit no-blacklist; overlap decision; source confirmation; final strict-only preview; resume/cancel; and no card exposes source bytes, secrets, raw payloads, approval file codes, or native-submit authorization.

- [ ] **Step 2: Write failing service workflow tests**

Use fake store, template loader, Drive uploader, and handoff. Cover this complete strict-only path:

```text
start → receive files in non-fixed order → owner resolves ambiguity
→ no-blacklist or overlap decision → first confirmation
→ generate/upload standard workbooks → final preview
→ create existing OA test draft
```

Also prove that a `寄卖`/`pop` coupon is rejected before artifact generation, invalid blacklists remain blocking, an old revision/non-owner/replayed file cannot mutate state, and all steps through handoff make zero native-submit calls.

- [ ] **Step 3: Implement focused cards and service orchestration**

The service must:

- inspect files with `inspectThreeSourceWorkbook` and retain only message references/hashes plus derived recognition state;
- require explicit owner choices whenever recognition is not unique;
- collect the supplemental `activityPointPercent` required by the existing OA draft contract;
- derive `严选` from the confirmed coupon input and reject other modes with a stable pilot-scope error;
- call the pure first-confirmation, overlap, canonical-package, artifact-generation, and OA-prefill helpers;
- upload only generated `.xlsx` artifacts to the dedicated Drive folder and record file token/size/hash/template metadata;
- call the Task 3 handoff only after the final preview action, then freeze the session with its returned OA draft record ID.

Every mutation must verify owner, expected revision, and a stable operation/message ID at the store boundary.

- [ ] **Step 4: Run service and card tests**

Run:

```bash
pnpm exec vitest run \
  server/lib/feishu/coupon-oa/three-source/cards.test.ts \
  server/lib/feishu/coupon-oa/three-source/service.test.ts
```

Expected: PASS with no real Feishu, Drive, Base, or Approval traffic.

- [ ] **Step 5: Leave the task uncommitted**

Do not commit without user authorization.

### Task 5: Bind the exact command, attachments, and callbacks into the existing event route

**Files:**
- Modify: `server/lib/feishu/coupon-oa/three-source/dispatcher.ts`
- Create: `server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts`
- Modify: `server/lib/feishu/events.ts`
- Modify: `server/lib/feishu/events.test.ts`
- Modify: `server/lib/feishu/events-excel-pilot.test.ts`

**Interfaces:**
- Consumes: `CouponThreeSourcePilotService`, `isCouponThreeSourceInvocation`, `isCouponThreeSourcePilotEnabled`, `getFeishuMessageBody`, `downloadFeishuMessageResource`, and `sendFeishuCard`.
- Produces: a dispatcher that reports whether it handled a text message, file message, or card action; `events.ts` delegates only when handling is affirmative.

- [ ] **Step 1: Write failing dispatcher tests**

Test that:

- disabled mode returns the unavailable card and does not create/read any task;
- a non-allowlisted user is rejected before source download;
- the exact normalized command creates/resumes one task and sends the intake card;
- a file is sent only to an existing three-source session and does not reach the Excel-pilot or legacy direct-attachment path;
- each three-source callback validates owner/revision/operation ID before delegating;
- a three-source final-preview action creates only an OA test draft, while the existing `coupon_oa_submit` action remains the sole event action that invokes `submitConfirmedCouponOaDraft`.

- [ ] **Step 2: Implement dispatcher adapters**

Expand `dispatcher.ts` into small `dispatchCouponThreeSourceText`, `dispatchCouponThreeSourceFile`, and `dispatchCouponThreeSourceAction` functions. Keep message-resource lookup and download inside this adapter, inject service dependencies in tests, and use the existing coupon-OA allowlist helper before any stateful work. Do not alter existing invocation matching or approval submission behavior.

- [ ] **Step 3: Add narrow event-route delegation**

In `events.ts`, call the three-source dispatcher before the Excel-pilot handler for its exact command, active-session file messages, and its namespaced callback actions. If the dispatcher returns `handled: false`, retain the current legacy flow exactly. Extend workflow-conflict checks so a user cannot have a live three-source session plus an active Excel pilot or legacy OA draft.

- [ ] **Step 4: Run adapter and event regressions**

Run:

```bash
pnpm exec vitest run \
  server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts \
  server/lib/feishu/events.test.ts \
  server/lib/feishu/events-excel-pilot.test.ts
```

Expected: PASS. Existing Excel-pilot and direct coupon-OA tests retain their routing and final-send behavior.

- [ ] **Step 5: Leave the task uncommitted**

Do not commit without explicit user authorization.

### Task 6: Full local verification and implementation handoff

**Files:**
- Modify only as required by failing checks from Tasks 1–5.
- Update after actual test results only: `docs/oa-ticket-reimbursement-materials/current/` and operations evidence are deliberately out of scope until an authorized constrained Feishu test has occurred.

**Interfaces:**
- Consumes: completed code/tests from Tasks 1–5.
- Produces: a locally verified, still-default-disabled implementation ready for the independent Test-Plan/QA sequence and separately authorized Feishu test.

- [ ] **Step 1: Run all directly affected tests**

Run:

```bash
pnpm exec vitest run \
  server/lib/coupon-oa/three-source \
  server/lib/feishu/coupon-oa/three-source \
  server/lib/feishu/coupon-oa/frozen-artifact-handoff.test.ts \
  server/lib/feishu/coupon-oa/excel-pilot-oa-handoff.test.ts \
  server/lib/feishu/events.test.ts \
  server/lib/feishu/events-excel-pilot.test.ts
```

Expected: PASS; no test makes an external request.

- [ ] **Step 2: Run project checks**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

Expected: all commands exit 0. If a pre-existing failure is found, record it separately rather than weakening the new tests or claiming a clean result.

- [ ] **Step 3: Inspect default-closed behavior**

Run the three-source config and dispatcher tests with no pilot environment values. Verify that `/OA优惠券提报` creates no task, does not download attachments, uploads no artifact, and creates no OA.

- [ ] **Step 4: Prepare, but do not perform, external validation**

Record the required owner-run setup: dedicated Base table, dedicated Drive folder, allowlisted testing account, existing OA test-draft/native-send configuration, and an explicit test authorization. Do not alter environment variables, invoke Feishu, or call native OA APIs as part of this task.

- [ ] **Step 5: Leave the final changes uncommitted**

Report the exact changed files and test results. Do not commit, push, deploy, or enable the pilot without explicit user authorization.

## Self-Review

- **Spec coverage:** Tasks 1 and 4 cover all full-Skill three-source inputs, ambiguity, no-blacklist and overlap rules, revision invalidation, strict-only behavior, and standard artifact generation. Task 3 covers the canonical-to-existing-OA-draft boundary; Task 5 preserves the existing explicit send/readback path. Tasks 2 and 6 establish default-closed storage/configuration and verification without operational activation.
- **Step scan:** Each code step names a module, input/output contract, and success case; test steps state a named behavior and assertion class. External operations are intentionally only prepared, never automated.
- **Type consistency:** `OaPrefillSnapshot` feeds the new three-source handoff; that returns the existing `CouponOaDraft`; only existing submit-service receives confirmed drafts. `FrozenDriveArtifact` is the one shared artifact shape for Excel-pilot and three-source Drive verification.
- **Review focus:** Ambiguity is tested in Tasks 1/4, blacklist state in Tasks 1/4, callback integrity in Tasks 2/4/5, artifact substitution in Task 3, and native-create isolation in Tasks 4/5.
- **Proportion:** The plan adds focused runtime adapters, not a general queue/worker/renderer/native-submit system. It explicitly limits first delivery to strict-only mode and reuses existing code wherever that provides the required behavior.
