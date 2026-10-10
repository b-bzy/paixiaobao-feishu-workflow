# Coupon Three-Source P0 Second-Round Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 P0 第二轮卡片的券档误判、单 Sheet 限制和英文输入问题，并增加可编辑中文补充文字的耐久 DeepSeek 候选回填。

**Architecture:** 先把“模板类型”和“同一模板下的券档集合”拆成独立领域概念，再复用现有多券档名单生成器输出全部已登记 Sheet。飞书卡片只提交中文结构化值和业务员已检查的补充文字；补充文字通过新的 PostgreSQL run + durable effect 异步识别，终态持久化后再投影同一轮卡片。

**Tech Stack:** TypeScript、Nitro、Vitest、ExcelJS、PostgreSQL、飞书 Card JSON、DeepSeek Chat Completions、pnpm

**Spec:** `docs/superpowers/specs/2026-10-11-coupon-three-source-p0-second-round-input-design.md`

## Global Constraints

- 当前范围只允许 P0 `draft-only`；`FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false`，不得调用飞书原生 OA 创建接口。
- 配券表、名单文件和当前 owner 确认是事实源；DeepSeek 输出只能保存为 `aiProposed` 候选。
- 不接收、下载或保存音频；“语音输入”仅指业务员使用飞书客户端、手机键盘或操作系统听写后提交的可编辑文字。
- 多个 `满 X 减 Y` 行或名单 Sheet 是同一模板类型下的券档集合，不触发“选择唯一优惠券”。
- 只有不同模板类型存在歧义时才显示类型选择；文件名只能作为低优先级提示，不能单独决定模板。
- 生成必须使用 Skill 登记且运行时 manifest 已开放的模板，并校验模板 SHA-256、结构和回读结果。
- 第二轮所有用户可见字段、占位提示和错误必须使用中文；内部 key 不得直接展示。
- 业务模式只允许 `严选`、`寄卖`、`POP`；结构化 owner 选择优先于 AI 文字候选。
- 保留当前 owner、revision、source hash、语义幂等、prepare→persist→activate、同任务串行投影和旧卡失效规则。
- 使用 pnpm；不得新增第二套 HTTP 框架、ORM、配置库、队列或日志框架。

## Review Focus

- 同一常规满减模板含五个不同门槛/面额行时，应识别为一个模板类型和五个券档，不能显示“选择唯一优惠券”；Task 2 必须覆盖。
- 白名单有五个合法 Sheet，但其中一个 Sheet 使用错误 SKU 列时，应只阻断该 Sheet，不能丢弃另外四个；Task 3 必须覆盖。
- 配券表文件名写“常规满减”但表头是折扣券结构时，应以结构指纹为准并标为不支持/歧义，不能按文件名生成；Task 1 必须覆盖。
- 补充文字识别成功后发生 worker 重试、重复点击或 Base 投影失败时，不能再次外发 DeepSeek，也不能覆盖 owner 已确认值；Task 5 必须覆盖。
- DeepSeek 生成的活动背景只描述第一档或包含源表未提供事实时，应丢弃该候选并保留人工输入路径；Task 4 必须覆盖。

---

## File Structure

- `server/lib/coupon-oa/three-source/template-classification.ts`：确定性模板类型指纹、开放状态和券档/模板分层。
- `server/lib/coupon-oa/three-source/types.ts`：模板解析、券档集合、多 Sheet 映射和文字候选的领域类型。
- `server/lib/coupon-oa/three-source/recognition.ts`：把同模板多行合并为已确认券档集合，不再抛出伪多券异常。
- `server/lib/coupon-oa/three-source/lists.ts`：逐 Sheet 识别 SKU 列并映射已登记券档。
- `server/lib/excel-template-engine/index.ts`：生成多券档、多渠道的常规满减配券表。
- `server/lib/excel-template-engine/three-source.ts`：复用多 Sheet 白/黑名单模板并回读验证。
- `server/lib/coupon-oa/three-source/ai-recognition.ts`：在现有整本工作簿请求中增加活动文案候选及来源校验。
- `server/lib/coupon-oa/three-source/ai-text.ts`：业务员补充文字的严格 schema、prompt 和本地校验。
- `server/lib/feishu/deepseek-text-gateway.ts`：有超时、大小限制和分类错误的 DeepSeek 文字请求适配器。
- `infra/postgres/migrations/0006_coupon_ai_text_runs.sql`：文字候选 run、语义唯一键、终态与投影状态。
- `server/lib/control-plane/postgres-coupon-ai-text-repository.ts`：prepare/activate/terminal/projected 持久化。
- `server/lib/control-plane/coupon-ai-text-effect.ts`：一次外发、终态持久化和可重试投影。
- `server/lib/feishu/coupon-oa/three-source/ai-text-projection.ts`：把文字候选投影到当前 owner/revision 草稿并发送最新卡片。
- `server/lib/feishu/coupon-oa/three-source/cards.ts`：精简第一轮、第二轮全中文组合输入。
- `server/lib/feishu/coupon-oa/three-source/dispatcher.ts`：解析中文结构化表单与“识别并填入”动作。
- `server/lib/feishu/coupon-oa/three-source/service.ts`：编排模板、券档、多 Sheet、文字 AI 与标准产物。
- 当前产品/实现/运行文档：同步已批准行为和测试步骤。

### Task 1: Template Type Classification

**Files:**
- Create: `server/lib/coupon-oa/three-source/template-classification.ts`
- Modify: `server/lib/coupon-oa/three-source/types.ts`
- Test: `server/lib/coupon-oa/three-source/template-classification.test.ts`

**Interfaces:**
- Consumes: `OfflineSourceFile` and workbook Sheet/header/value structure.
- Produces: `CouponTemplateKind`, `CouponTemplateResolution`, and `classifyCouponTemplate(source: OfflineSourceFile): Promise<CouponTemplateResolution>` for Task 2 and Task 6.

- [ ] **Step 1: Write failing classification tests**

Add tests named:

- `groups different threshold and discount rows under one regular-full-reduction template`;
- `uses structural fingerprint over a misleading file name`;
- `returns unsupported for a recognized reference template without a runtime generator`;
- `returns ambiguous only when two different template fingerprints remain plausible`.

Assert that five `满 X 减 Y` rows produce `status: "unique_template"`, `templateKind: "regular_full_reduction"`, and five tier rows—not five template candidates.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/template-classification.test.ts`

Expected: FAIL because the classifier and types do not exist.

- [ ] **Step 3: Add the template classification types**

In `types.ts`, define:

```ts
type CouponTemplateKind =
  | "regular_full_reduction"
  | "regular_discount"
  | "plus_full_reduction"
  | "plus_discount"
  | "campaign_regular_full_reduction"
  | "campaign_regular_discount"
  | "campaign_plus_full_reduction"
  | "campaign_plus_discount"
  | "redemption_full_reduction"
  | "redemption_discount";

interface CouponTemplateResolution {
  status:
    | "unique_template"
    | "ambiguous_template"
    | "unknown_template"
    | "unsupported_template";
  templateKind?: CouponTemplateKind;
  candidates: CouponTemplateCandidate[];
  tierRows: CouponTierRowReference[];
  issues: string[];
}
```

`CouponTemplateCandidate` must record structural evidence, score, support status and optional filename hint. `CouponTierRowReference` must record Sheet, row and evidence cells.

- [ ] **Step 4: Implement `classifyCouponTemplate`**

Use deterministic header/value fingerprints from the Skill templates. Require the registered runtime manifest before `supported: true`; treat filename only as a score hint. Do not call DeepSeek and do not open macros/external links.

- [ ] **Step 5: Run focused tests**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/template-classification.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add server/lib/coupon-oa/three-source/template-classification.ts server/lib/coupon-oa/three-source/template-classification.test.ts server/lib/coupon-oa/three-source/types.ts
git commit -m "feat(coupon-oa): classify coupon templates and tiers"
```

### Task 2: Confirm a Coupon Tier Set Instead of One Row

**Files:**
- Modify: `server/lib/coupon-oa/three-source/recognition.ts`
- Modify: `server/lib/coupon-oa/three-source/types.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/store.ts`
- Test: `server/lib/coupon-oa/three-source/recognition.test.ts`

**Interfaces:**
- Consumes: `CouponTemplateResolution`, deterministic/AI field candidates, owner values and current revision.
- Produces: `ConfirmedCouponSetSource` and `confirmRegularFullReductionCouponSet(input): Promise<ConfirmedCouponSetSource>` for Tasks 3, 4 and 6.

- [ ] **Step 1: Write failing coupon-set tests**

Add tests asserting:

- five full-reduction data rows become five ordered tiers under one template;
- repeated AI and deterministic candidates for the same Sheet/row are deduplicated;
- a real `ambiguous_template` requires one template choice;
- common owner fields apply to every tier, while threshold/discount remain row-specific;
- owner override of a non-empty workbook fact still requires a reason.

- [ ] **Step 2: Run the focused recognition test**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/recognition.test.ts`

Expected: FAIL on the existing `MultipleCouponCandidatesError` behavior.

- [ ] **Step 3: Add the coupon-set contract**

Define `ConfirmedCouponSetSource` with `templateKind`, common confirmed fields/provenance, ordered `tiers`, source hash and activity point. Each tier must contain its own stable ID, row provenance, `RegularFullReductionInput` and computed display name.

- [ ] **Step 4: Implement `confirmRegularFullReductionCouponSet`**

Replace “more than one row means multiple coupons” with “different template kinds mean ambiguity.” Parse every tier row from the selected template. Keep the old single-row function only as a compatibility wrapper for tests/callers outside P0 until Task 6 migrates them.

- [ ] **Step 5: Persist the new selection shape**

Update `CouponThreeSourcePilotDraft` to store `couponSet`, `templateKind`, optional `ownerConfirmedTemplateKind`, and common/tier provenance. Increment `couponThreeSourcePilotSchemaVersion` only if the existing parser cannot safely default old P0 drafts; otherwise add backward-compatible defaults and test deserialization.

- [ ] **Step 6: Run focused tests**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/recognition.test.ts server/lib/feishu/coupon-oa/three-source/store.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add server/lib/coupon-oa/three-source/recognition.ts server/lib/coupon-oa/three-source/recognition.test.ts server/lib/coupon-oa/three-source/types.ts server/lib/feishu/coupon-oa/three-source/store.ts server/lib/feishu/coupon-oa/three-source/store.test.ts
git commit -m "refactor(coupon-oa): confirm coupon tier sets"
```

### Task 3: Parse and Generate Multi-Sheet SKU Lists

**Files:**
- Modify: `server/lib/coupon-oa/three-source/lists.ts`
- Modify: `server/lib/coupon-oa/three-source/types.ts`
- Modify: `server/lib/excel-template-engine/three-source.ts`
- Modify: `server/lib/coupon-oa/three-source/workflow.ts`
- Test: `server/lib/coupon-oa/three-source/recognition.test.ts`
- Create: `server/lib/excel-template-engine/three-source.test.ts`
- Test: `server/lib/coupon-oa/three-source/offline.test.ts`

**Interfaces:**
- Consumes: `ConfirmedCouponSetSource`, per-Sheet owner selections, registered multi-tier manifest.
- Produces: `parseMultiSheetTieredIdentifierList(input): Promise<ParsedTieredIdentifierList>` and canonical `whitelistByTier`/`blacklistByTier` for Task 6.

- [ ] **Step 1: Write failing multi-Sheet parser tests**

Cover all five registered Sheet names, arbitrary Sheet order, one ambiguous SKU column limited to one Sheet, an unregistered Sheet, duplicate tier mapping, formula SKU, numeric leading-zero risk and duplicate SKU within one tier.

- [ ] **Step 2: Run parser tests and verify failure**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/recognition.test.ts`

Expected: FAIL because current P0 selects exactly one candidate and one Sheet.

- [ ] **Step 3: Implement `parseMultiSheetTieredIdentifierList`**

Accept:

```ts
interface MultiSheetListSelection {
  sheets: Record<string, {
    templateTier: MultiTierSkuSheetName;
    identifierCandidateId?: string;
  }>;
}
```

Automatically fill selections when Sheet name and one SKU candidate uniquely map. Return issues scoped to the exact Sheet/cell; do not discard valid sibling Sheets.

- [ ] **Step 4: Write failing generator round-trip tests**

Assert that generated white/blacklist workbooks retain all five registered Sheets, populate each selected tier, keep `sku` in A1, force text formatting, leave unused tiers empty and reject a template hash mismatch.

- [ ] **Step 5: Switch the P0 workflow to `generateMultiTierSkuListWorkbook`**

Remove the P0 call to `generateSingleCouponSkuListWorkbook`; preserve the single-Sheet generator for other callers. Pass the canonical tier maps and verify per-Sheet/total row counts after export.

- [ ] **Step 6: Run multi-Sheet tests**

Run: `pnpm vitest run server/lib/excel-template-engine/three-source.test.ts server/lib/coupon-oa/three-source/offline.test.ts server/lib/coupon-oa/three-source/recognition.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add server/lib/coupon-oa/three-source/lists.ts server/lib/coupon-oa/three-source/types.ts server/lib/excel-template-engine/three-source.ts server/lib/coupon-oa/three-source/workflow.ts server/lib/coupon-oa/three-source/recognition.test.ts server/lib/excel-template-engine/three-source.test.ts server/lib/coupon-oa/three-source/offline.test.ts
git commit -m "feat(coupon-oa): preserve multi-sheet SKU lists"
```

### Task 4: Generate Multi-Tier Coupon Workbooks and Safe Activity Copy

**Files:**
- Modify: `server/lib/excel-template-engine/index.ts`
- Modify: `server/lib/coupon-oa/three-source/workflow.ts`
- Modify: `server/lib/coupon-oa/three-source/ai-recognition.ts`
- Create: `server/lib/coupon-oa/three-source/ai-text.ts`
- Create: `server/lib/excel-template-engine/index.test.ts`
- Modify: `server/lib/coupon-oa/three-source/ai-recognition.test.ts`
- Create: `server/lib/coupon-oa/three-source/ai-text.test.ts`

**Interfaces:**
- Consumes: `ConfirmedCouponSetSource` from Task 2 and validated workbook coordinates.
- Produces: `generateRegularFullReductionWorkbookSet(input)`, validated activity-copy candidates on `ValidatedAiRecognition`, and supplement-text schema helpers for Tasks 5 and 6.

- [ ] **Step 1: Write failing multi-tier coupon workbook tests**

Assert that two tiers × two channels produce four rows in stable tier/channel order, formulas reference their own rows, future-backfill columns remain empty, template instructions are removed and round-trip validation rejects a missing formula.

- [ ] **Step 2: Run the focused workbook test**

Run: `pnpm vitest run server/lib/excel-template-engine/index.test.ts`

Expected: FAIL because the generator currently accepts one coupon input.

- [ ] **Step 3: Implement `generateRegularFullReductionWorkbookSet`**

Signature:

```ts
generateRegularFullReductionWorkbookSet(input: {
  templateBytes: Uint8Array;
  tiers: Array<{
    data: RegularFullReductionInput;
    computed: RegularFullReductionComputedValues;
  }>;
  revision: number;
}): Promise<GeneratedWorkbook>
```

Reuse blueprint-row copying and row-local formulas. Keep the existing one-tier function as a wrapper.

- [ ] **Step 4: Write failing activity-copy validation tests**

Cover: all tier names included in the background, valid source coordinates, invented GMV/date/channel rejected, first-tier-only background rejected, oversized text rejected and malformed JSON rejected.

- [ ] **Step 5: Extend workbook AI recognition with activity-copy candidates**

Extend the existing `couponThreeSourceAiProposalSchema` with optional `activityCopyCandidates` for `activityName` and `activityBackground`. Each candidate contains a generated `value` plus workbook evidence coordinates. Update the existing prompt version, validate every coordinate and require the background to cover every discovered tier. Return `aiProposed` candidates only; do not mutate confirmed facts.

- [ ] **Step 6: Add the owner-supplement text schema**

In `ai-text.ts`, define `couponSupplementTextPromptVersion`, `couponSupplementTextProposalSchema` and `validateCouponSupplementTextProposal`. Only allow registered `CouponFieldKey` values and reject invalid enums, dates, numbers and unsupported keys.

- [ ] **Step 7: Run focused tests**

Run: `pnpm vitest run server/lib/excel-template-engine/index.test.ts server/lib/coupon-oa/three-source/ai-recognition.test.ts server/lib/coupon-oa/three-source/ai-text.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add server/lib/excel-template-engine/index.ts server/lib/excel-template-engine/index.test.ts server/lib/coupon-oa/three-source/workflow.ts server/lib/coupon-oa/three-source/ai-recognition.ts server/lib/coupon-oa/three-source/ai-recognition.test.ts server/lib/coupon-oa/three-source/ai-text.ts server/lib/coupon-oa/three-source/ai-text.test.ts
git commit -m "feat(coupon-oa): generate multi-tier activity artifacts"
```

### Task 5: Durable Supplement-Text AI Recognition

**Files:**
- Create: `infra/postgres/migrations/0006_coupon_ai_text_runs.sql`
- Create: `server/lib/feishu/deepseek-text-gateway.ts`
- Create: `server/lib/control-plane/postgres-coupon-ai-text-repository.ts`
- Create: `server/lib/control-plane/coupon-ai-text-effect.ts`
- Create: `server/lib/feishu/coupon-oa/three-source/ai-text-projection.ts`
- Modify: `server/lib/control-plane/durable-coupon-control-plane-worker.ts`
- Modify: `server/api/internal/control-plane/tick.post.ts`
- Test: matching `.test.ts` files beside each created/modified module.

**Interfaces:**
- Consumes: validated owner supplement text, current draft owner/revision, DeepSeek config, durable effect repository.
- Produces: `CouponAiTextRun`, `PostgresCouponAiTextRepository`, `createCouponAiTextEffectHandler`, and `createCouponAiTextProjector` for Task 6.

- [ ] **Step 1: Write the append-only migration**

Create `coupon_ai_text_runs` with semantic key uniqueness, pilot record/task/owner/revision, `supplement_text`, `text_sha256`, provider/model/prompt version, pending/terminal status, request/response hashes, validated result, fallback code and `projected_at`. The table remains inside the existing access-controlled PostgreSQL boundary; logs and errors must never print `supplement_text`. Do not modify migration `0005`.

- [ ] **Step 2: Add migration checksum/runner tests and run them**

Run: `pnpm test:control-plane`

Expected before repository code: migration passes syntax/checksum discovery; new repository tests still fail.

- [ ] **Step 3: Write failing repository tests**

Cover prepare without effect, persist-then-activate ordering, semantic-key dedupe, terminal result reuse, mark-projected idempotency and concurrent prepare of the same key.

- [ ] **Step 4: Implement `PostgresCouponAiTextRepository`**

Mirror the existing workbook AI repository transaction boundaries. Semantic key must bind `draft_id + revision + text_sha256 + model + prompt_version`.

- [ ] **Step 5: Write failing gateway/effect tests**

Cover success, 429, timeout, network unknown, response limit, invalid JSON, schema invalid, duplicate effect, terminal replay, projection failure/retry and no second provider call after terminal persistence.

- [ ] **Step 6: Implement the DeepSeek text gateway and effect handler**

The gateway accepts owner supplement text and returns strict JSON. The effect must save terminal state before projection, use the existing timeout/response-limit conventions and redact text/secrets from errors. Activity-copy candidates continue to arrive in the existing workbook recognition run from Task 4.

- [ ] **Step 7: Implement current-revision projection**

Project only when pilot record, owner, revision and text hash still match. Merge only missing/editable `aiProposed` fields; never overwrite owner selections or workbook facts. On terminal failure, retain original text and add a Chinese fallback warning.

- [ ] **Step 8: Register the effect and serialization key**

Register the handler in `durable-coupon-control-plane-worker.ts`. Serialize workbook and text AI effects by the same `businessTaskId` so Base whole-state writes cannot race. Keep different tasks parallel.

- [ ] **Step 9: Run durable control-plane tests**

Run: `pnpm vitest run server/lib/control-plane/postgres-coupon-ai-text-repository.test.ts server/lib/control-plane/coupon-ai-text-effect.test.ts server/lib/feishu/coupon-oa/three-source/ai-text-projection.test.ts server/lib/control-plane/durable-coupon-control-plane-worker.test.ts server/lib/control-plane/durable-effect-worker.test.ts`

Expected: PASS, including worker restart and projection retry without repeated DeepSeek calls.

- [ ] **Step 10: Commit Task 5**

```bash
git add infra/postgres/migrations/0006_coupon_ai_text_runs.sql server/lib/feishu/deepseek-text-gateway.ts server/lib/feishu/deepseek-text-gateway.test.ts server/lib/control-plane/postgres-coupon-ai-text-repository.ts server/lib/control-plane/postgres-coupon-ai-text-repository.test.ts server/lib/control-plane/coupon-ai-text-effect.ts server/lib/control-plane/coupon-ai-text-effect.test.ts server/lib/feishu/coupon-oa/three-source/ai-text-projection.ts server/lib/feishu/coupon-oa/three-source/ai-text-projection.test.ts server/lib/control-plane/durable-coupon-control-plane-worker.ts server/lib/control-plane/durable-coupon-control-plane-worker.test.ts server/api/internal/control-plane/tick.post.ts
git commit -m "feat(coupon-oa): add durable text candidate recognition"
```

### Task 6: Chinese Combined Second-Round Card and Service Orchestration

**Files:**
- Modify: `server/lib/feishu/coupon-oa/three-source/cards.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/dispatcher.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/service.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/store.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/cards.test.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/service.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5 template, coupon-set, multi-Sheet, generation and AI text interfaces.
- Produces: the complete P0 intake/mapping interaction and `coupon_three_source_supplement_recognition_start` action.

- [ ] **Step 1: Write failing card copy/shape tests**

Assert:

- intake card omits the two long lines requested by the user;
- no internal field key appears in serialized card JSON;
- business mode is a required select with `严选`, `寄卖`, `POP`;
- unique multi-Sheet recognition renders a summary and no global Sheet selector;
- only real template ambiguity renders a template-type selector;
- text area label is `语音或文字补充说明` and explains external dictation/editing;
- separate buttons exist for `识别并填入` and `确认来源并生成标准附件`.

- [ ] **Step 2: Run card tests and verify failure**

Run: `pnpm vitest run server/lib/feishu/coupon-oa/three-source/cards.test.ts`

Expected: FAIL on existing English labels, free-text business mode and single-Sheet selector.

- [ ] **Step 3: Implement the Chinese field metadata and card**

Create one `CouponFieldKey` metadata map containing label, input kind, required/conditional rule and placeholder. Use it for every second-round field and error message. Keep the card within Feishu component limits; render only missing, ambiguous or editable fields plus summaries.

Display `POP` to the user but submit the existing internal enum value `pop`. Remove the P0-only rejection of non-`严选` values; preserve the existing requirement that `寄卖` and `pop` must produce and verify the standard coupon screenshot before draft handoff.

- [ ] **Step 4: Write failing dispatcher tests**

Cover Chinese select values, supplement text trimming/hash, owner/revision validation, stale card, duplicate click, recognition pending, AI disabled/failure fallback and direct confirm while a text run is pending.

- [ ] **Step 5: Implement dispatcher actions**

`识别并填入` must call `prepareAiText`, persist the pending run/text hash into the draft, then activate the effect. `确认来源并生成标准附件` must reject while a text run is pending and must use owner structured selections over AI candidates.

The service method is `startSupplementRecognition({ draft, ownerOpenId, expectedRevision, text })`. It creates a new revision for changed supplement text, prepares the run against that new revision, persists pending state to Base, and only then activates the durable effect.

- [ ] **Step 6: Migrate service orchestration to set/multi-Sheet generation**

Use `classifyCouponTemplate`, `confirmRegularFullReductionCouponSet`, `parseMultiSheetTieredIdentifierList`, `generateRegularFullReductionWorkbookSet` and `generateMultiTierSkuListWorkbook`. Preserve overlap decisions, artifact hashing, Drive/Base boundaries and draft-only handoff.

- [ ] **Step 7: Add service regressions**

Cover five tiers end-to-end, all three business modes, the screenshot Gate for `寄卖`/`pop`, one ambiguous source Sheet, no-blacklist confirmation, overlap choice, unsupported template, text candidate precedence, repeated generation click and artifact upload failure without partial success.

- [ ] **Step 8: Run card/service tests**

Run: `pnpm vitest run server/lib/feishu/coupon-oa/three-source/cards.test.ts server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts server/lib/feishu/coupon-oa/three-source/service.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit Task 6**

```bash
git add server/lib/feishu/coupon-oa/three-source/cards.ts server/lib/feishu/coupon-oa/three-source/cards.test.ts server/lib/feishu/coupon-oa/three-source/dispatcher.ts server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts server/lib/feishu/coupon-oa/three-source/service.ts server/lib/feishu/coupon-oa/three-source/service.test.ts server/lib/feishu/coupon-oa/three-source/store.ts
git commit -m "feat(coupon-oa): simplify Chinese second-round input"
```

### Task 7: Baseline Documentation and Full Verification

**Files:**
- Modify: `docs/oa-ticket-reimbursement-materials/current/product/coupon-oa-mvp-prd-v1.3.md`
- Modify: `docs/oa-ticket-reimbursement-materials/current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md`
- Modify: `docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-direct-http-poc-runbook-v1.md`
- Modify: `docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md`
- Modify: `.env.example` only if Task 5 introduces a new non-secret feature flag or timeout.

**Interfaces:**
- Consumes: completed behavior from Tasks 1–6.
- Produces: current product/implementation/operations truth and full release evidence.

- [ ] **Step 1: Update the current product baseline**

Replace the obsolete “multiple rows means multiple coupons” and “single Sheet list output” text. Record template-type ambiguity, tier sets, multi-Sheet output, Chinese combined input, external dictation boundary and candidate-only AI rules.

- [ ] **Step 2: Update implementation and runbooks**

Document the `0006` migration, text-run semantic key, prepare→persist→activate, terminal-before-projection, same-task serialization, multi-Sheet artifact verification and P0 test steps. Do not claim built-in voice, production, native OA or unsupported templates.

- [ ] **Step 3: Run affected test groups**

Run:

```bash
pnpm test:coupon-three-source:offline
pnpm test:control-plane
pnpm vitest run server/lib/feishu/coupon-oa/three-source/*.test.ts
```

Expected: all affected tests PASS; PostgreSQL-only tests may skip only when the documented local database prerequisite is absent.

- [ ] **Step 4: Run repository verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: lint, typecheck, all tests and Nitro build PASS. Record exact counts and any documented skips.

- [ ] **Step 5: Inspect the final diff and security boundaries**

Verify no `.env`, secret, open ID, Base/Drive identifier, source workbook, generated business attachment or unrelated dirty file is staged. Confirm migration `0005` is unchanged and `0006` is append-only.

- [ ] **Step 6: Commit Task 7**

```bash
git add docs/oa-ticket-reimbursement-materials/current/product/coupon-oa-mvp-prd-v1.3.md docs/oa-ticket-reimbursement-materials/current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-direct-http-poc-runbook-v1.md docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md .env.example
git commit -m "docs(coupon-oa): update P0 multi-tier input baseline"
```

Only include `.env.example` in this commit if it was actually and intentionally modified for Task 5; otherwise leave the user's existing unrelated change untouched.
