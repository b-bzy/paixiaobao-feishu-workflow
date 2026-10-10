# Coupon Three-Source P0 DeepSeek Recognition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前单用户 P0 三源流程中自动执行一次完整工作簿 DeepSeek 候选识别，在第二轮完成券型、异常和缺失字段确认后，由确定性模板引擎生成单券档标准 Excel。

**Architecture:** 飞书文件事件只保存来源引用并排队；PostgreSQL effect worker 执行一次 DeepSeek 请求、持久化结构化候选，再将候选投影到 P0 Base 草稿和第二轮卡片。第二轮确认冻结单一优惠券、字段和名单映射，随后现有领域服务使用登记模板生成并回读验证标准配券表、单 Sheet 白名单及可选黑名单。

**Tech Stack:** Nitro、TypeScript、Vitest、Zod、ExcelJS、PostgreSQL、Feishu Base/Drive/Card、DeepSeek Chat Completions API

**Spec:** `docs/superpowers/specs/2026-10-10-coupon-three-source-p0-deepseek-recognition-design.md`

## Global Constraints

- P0 只支持 `常规满减券`；其他参考模板不得静默启用。
- DeepSeek 只产生候选；业务事实、模板选择、名单映射和生成许可必须由本地规则与当前 owner 确认。
- 每个 `draft + revision + source role + source SHA-256 + model + prompt version` 最多外发一次完整工作簿请求，不分块、不自动重复外发。
- DeepSeek 不得运行在同步飞书事件入口或 Mac long-connection bridge 中。
- AI 失败必须降级到确定性识别/人工补充；不得返回伪成功。
- 第二轮确认前不得生成标准附件；确认后生成过程不得调用 DeepSeek。
- 一次提报只保留一种优惠券；多券是必须由 owner 选择的异常。
- 仅生成已验证标准附件；原始来源文件不得直接进入 OA 附件。
- `FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false` 和正式三源开关保持关闭。
- 不输出、记录或提交 DeepSeek key、飞书密钥、open ID、Base/Drive token、完整 prompt/response 或真实业务工作簿内容。
- 保留工作区现有修改；不得重置、覆盖或夹带无关文件。
- 未获得明确 Git 授权前不提交；每个任务的 Commit 步骤只记录建议暂存范围和提交信息。

## Review Focus

- 工作簿单元格包含 prompt injection、公式或外部链接时，只能作为不可信数据；Task 2 的测试必须证明其不能改变 schema、券型、模板或副作用。
- 多个优惠券候选名称相似或来自同一 Sheet 时，选择必须绑定 candidate ID 和来源坐标；Task 3 的测试必须证明不会默认第一行。
- DeepSeek 已成功但 Base/Card 投影失败重试时，不能再次外发工作簿；Task 5 的测试必须证明只重试投影。
- 来源文件、revision 或 owner 在 AI 完成前变化时，旧候选必须丢弃；Task 5/6 的测试必须覆盖陈旧结果。
- DeepSeek 上下文过长、429、超时、无效 JSON 或超大响应必须进入同一可审计降级路径；Task 2/5 的测试必须覆盖全部分类。

---

## File Structure

### New files

- `docs/adr/0011-use-deepseek-only-for-p0-candidate-recognition.md` — 架构决定、隐私范围、异步边界和回滚条件。
- `server/lib/coupon-oa/three-source/ai-recognition.ts` — 工作簿序列化、AI proposal schema、坐标验证和候选转换。
- `server/lib/coupon-oa/three-source/ai-recognition.test.ts` — 领域级 AI 候选、prompt injection 和坐标验证测试。
- `server/lib/coupon-oa/three-source/recognition.test.ts` — 单券、多券、类型确认和 owner 补充测试。
- `server/lib/feishu/deepseek-chat-gateway.ts` — DeepSeek HTTP、超时、响应大小和错误分类。
- `server/lib/feishu/deepseek-chat-gateway.test.ts` — HTTP gateway 契约测试。
- `server/lib/feishu/coupon-oa/three-source/ai-config.ts` — P0 AI feature flag 与 DeepSeek 配置读取。
- `server/lib/feishu/coupon-oa/three-source/ai-config.test.ts` — 默认关闭和配置校验测试。
- `infra/postgres/migrations/0005_coupon_ai_recognition_runs.sql` — AI run、结构化结果和投影状态。
- `server/lib/control-plane/postgres-coupon-ai-recognition-repository.ts` — run/effect 原子排队、终态保存和可重试投影读取。
- `server/lib/control-plane/postgres-coupon-ai-recognition-repository.test.ts` — SQL 与幂等契约测试。
- `server/lib/control-plane/coupon-ai-recognition-effect.ts` — 一次 AI 调用、结果持久化、Base/Card 投影和降级处理。
- `server/lib/control-plane/coupon-ai-recognition-effect.test.ts` — 无重复外发、失败降级和陈旧结果测试。
- `server/lib/feishu/coupon-oa/three-source/ai-projection.ts` — 将已持久化 AI 终态安全投影到当前 Base draft 并发送状态卡。
- `server/lib/feishu/coupon-oa/three-source/ai-projection.test.ts` — source/revision/owner 绑定和卡片幂等测试。

### Existing files to modify

- `.env.example` — 增加 P0 AI 默认关闭开关与超时。
- `server/lib/coupon-oa/three-source/types.ts` — 券型状态、单券候选、owner 补充 provenance、AI audit 和单券名单类型。
- `server/lib/coupon-oa/three-source/recognition.ts` — 发现候选数据行、选择单一优惠券、合并 owner 补充值。
- `server/lib/coupon-oa/three-source/lists.ts` — 增加单优惠券名单解析，不再依赖五个固定券档。
- `server/lib/coupon-oa/three-source/offline.test.ts` — 将当前 P0 断言迁移到单券档标准产物。
- `server/lib/coupon-oa/three-source/workflow.ts` — canonical package 改为单一 coupon tier 和单一名单集合。
- `server/lib/excel-template-engine/template-manifests.ts` — 登记以现有名单模板为蓝本的单 Sheet 输出规则。
- `server/lib/excel-template-engine/three-source.ts` — 单 Sheet 白/黑名单生成与回读验证。
- `server/lib/feishu/coupon-oa/three-source/store.ts` — 保存 AI run 摘要、候选、状态和第二轮 owner 选择。
- `server/lib/feishu/coupon-oa/three-source/service.ts` — 排队识别、解析第二轮确认、冻结 canonical package 和生成附件。
- `server/lib/feishu/coupon-oa/three-source/cards.ts` — AI 识别中卡、未知券型、多券异常和缺失字段表单。
- `server/lib/feishu/coupon-oa/three-source/dispatcher.ts` — 第二轮表单解析、异步排队和陈旧 callback 拒绝。
- `server/lib/feishu/coupon-oa/three-source/service.test.ts` — P0 编排、降级和生成顺序测试。
- `server/lib/feishu/coupon-oa/three-source/cards.test.ts` — 第二轮卡片字段和无默认选择测试。
- `server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts` — 回调、revision 和重复事件测试。
- `server/lib/control-plane/durable-coupon-control-plane-worker.ts` — 注册 AI recognition effect handler。
- `server/lib/control-plane/durable-coupon-control-plane-worker.test.ts` — handler 注册和 worker 顺序测试。
- `server/lib/control-plane/runtime-config.ts` — 仅 AI 开启时要求相应数据库/worker 配置。
- `server/lib/control-plane/runtime-config.test.ts` — AI worker 配置 Gate 测试。
- `docs/oa-ticket-reimbursement-materials/current/product/coupon-oa-mvp-prd-v1.3.md` — 第二轮异常确认和单券约束。
- `docs/oa-ticket-reimbursement-materials/current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md` — AI gateway、run/effect 和模板边界。
- `docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md` — P0 开关、worker、回滚和验证步骤。

## Task Dependencies

```text
Task 1 configuration/ADR
  → Task 2 AI recognition contract
  → Task 3 single-coupon resolution
  → Task 4 deterministic template generation
  → Task 5 durable AI execution
  → Task 6 Feishu second-round integration
  → Task 7 end-to-end verification and docs
```

### Task 1: Record the architecture decision and add a default-closed P0 AI gate

**Files:**
- Create: `docs/adr/0011-use-deepseek-only-for-p0-candidate-recognition.md`
- Create: `server/lib/feishu/coupon-oa/three-source/ai-config.ts`
- Create: `server/lib/feishu/coupon-oa/three-source/ai-config.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: existing `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`.
- Produces: `getCouponThreeSourceAiConfig(): CouponThreeSourceAiConfig` and `isCouponThreeSourceAiRecognitionEnabled(): boolean`.

- [ ] **Step 1: Write configuration tests**

Add tests asserting:

- missing `FEISHU_COUPON_THREE_SOURCE_P0_AI_RECOGNITION_ENABLED` returns disabled without reading a key;
- enabled mode requires a non-empty API key, official HTTPS DeepSeek base URL, model and a timeout between 1,000 and 120,000 ms;
- invalid values fail closed without including secrets in the error.

- [ ] **Step 2: Run the configuration tests and verify failure**

Run: `pnpm vitest run server/lib/feishu/coupon-oa/three-source/ai-config.test.ts`  
Expected: FAIL because the config module does not exist.

- [ ] **Step 3: Implement the configuration interface**

Use:

```ts
export interface CouponThreeSourceAiConfig {
  enabled: boolean;
  apiKey?: string;
  baseUrl: "https://api.deepseek.com";
  model: string;
  timeoutMs: number;
  maxResponseBytes: 1_048_576;
}

export function isCouponThreeSourceAiRecognitionEnabled(): boolean;
export function getCouponThreeSourceAiConfig(): CouponThreeSourceAiConfig;
```

Add to `.env.example`:

```dotenv
FEISHU_COUPON_THREE_SOURCE_P0_AI_RECOGNITION_ENABLED=false
FEISHU_COUPON_THREE_SOURCE_P0_AI_TIMEOUT_MS=45000
```

- [ ] **Step 4: Add ADR-0011**

Record full-workbook externalization, user-confirmed privacy scope, one-request-per-workbook policy, asynchronous effect execution, owner confirmation, deterministic generation, fallback and kill switch. Mark native OA and non-P0 environments out of scope.

- [ ] **Step 5: Run focused tests and Markdown checks**

Run: `pnpm vitest run server/lib/feishu/coupon-oa/three-source/ai-config.test.ts`  
Expected: PASS.  
Run: `git diff --check -- .env.example docs/adr/0011-use-deepseek-only-for-p0-candidate-recognition.md server/lib/feishu/coupon-oa/three-source/ai-config.ts server/lib/feishu/coupon-oa/three-source/ai-config.test.ts`  
Expected: no output.

- [ ] **Step 6: Commit only if explicitly authorized**

Suggested scope: the four Task 1 files.  
Suggested message: `docs: record p0 ai recognition boundary`

### Task 2: Build the one-request workbook serializer, DeepSeek gateway and validated candidate contract

**Files:**
- Create: `server/lib/coupon-oa/three-source/ai-recognition.ts`
- Create: `server/lib/coupon-oa/three-source/ai-recognition.test.ts`
- Create: `server/lib/feishu/deepseek-chat-gateway.ts`
- Create: `server/lib/feishu/deepseek-chat-gateway.test.ts`
- Modify: `server/lib/coupon-oa/three-source/types.ts`

**Interfaces:**
- Consumes: `OfflineSourceFile`, `CouponFieldKey`, Task 1 `CouponThreeSourceAiConfig`.
- Produces:
  - `serializeWorkbookForAi(source: OfflineSourceFile): Promise<SerializedWorkbookForAi>`;
  - `validateCouponThreeSourceAiProposal(input: { proposal: unknown; workbook: SerializedWorkbookForAi }): ValidatedAiRecognition`;
  - `CouponThreeSourceAiGateway.recognize(input: AiRecognitionRequest): Promise<AiGatewayResponse>`;
  - `createDeepSeekChatGateway(config, fetchImpl?): CouponThreeSourceAiGateway`.

- [ ] **Step 1: Write serializer and schema tests**

Tests must create in-memory XLSX fixtures and assert:

- one payload contains every non-empty Sheet/cell exactly once with address, safe typed value and source hash;
- formulas are marked as formulas and never executed;
- prompt-like cell text remains workbook data;
- valid role, coupon type, coupon row, field and list candidates retain only existing coordinates;
- nonexistent coordinates, invalid dimensions and unsupported coupon types become issues rather than facts;
- the full request is not chunked.

- [ ] **Step 2: Write gateway failure-classification tests**

Mock `fetch` and assert exact result codes for success, 400/context error, 429, timeout/abort, network error, invalid JSON, missing message content and response larger than 1 MiB. Assert Authorization never appears in thrown messages.

- [ ] **Step 3: Run the new tests and verify failure**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/ai-recognition.test.ts server/lib/feishu/deepseek-chat-gateway.test.ts`  
Expected: FAIL because modules and types do not exist.

- [ ] **Step 4: Add the exact domain types**

Define:

```ts
export type CouponType = "regular_full_reduction";
export type CouponTypeResolutionStatus =
  | "unique"
  | "ambiguous"
  | "unknown"
  | "multiple_coupons"
  | "unsupported";

export interface AiAuditSummary {
  provider: "deepseek";
  model: string;
  promptVersion: string;
  status: "succeeded" | "failed" | "outcome_unknown" | "disabled";
  requestSha256?: string;
  responseSha256?: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  fallbackReason?: string;
}
```

Add structured candidate types that carry stable IDs plus `sheetName` and exact evidence cells. Do not store raw prompt/response.
Extend `CouponFieldKey` with `activityPointPercent`, but keep its final value owner-confirmed; AI must not derive it from threshold, face value or discount ratio.

- [ ] **Step 5: Implement serialization and local validation**

Port only the safe cell serialization and coordinate-validation ideas from `scripts/recognize-coupon-three-source-deepseek.mjs`. Remove chunk/aggregate behavior. Use a strict Zod proposal schema and a prompt version constant `coupon-three-source-p0-ai-v1`.

- [ ] **Step 6: Implement the DeepSeek gateway**

POST once to `/chat/completions` with `temperature: 0` and `response_format: { type: "json_object" }`. Apply `AbortController`, size checking and typed failure codes. Return content plus request/response hashes and timings; never return or log the API key.

- [ ] **Step 7: Run focused tests**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/ai-recognition.test.ts server/lib/feishu/deepseek-chat-gateway.test.ts`  
Expected: PASS.

- [ ] **Step 8: Commit only if explicitly authorized**

Suggested scope: Task 2 files.  
Suggested message: `feat: add validated p0 workbook ai recognition`

### Task 3: Resolve exactly one coupon and support owner-confirmed missing fields

**Files:**
- Modify: `server/lib/coupon-oa/three-source/types.ts`
- Modify: `server/lib/coupon-oa/three-source/recognition.ts`
- Create: `server/lib/coupon-oa/three-source/recognition.test.ts`
- Modify: `server/lib/coupon-oa/three-source/lists.ts`
- Modify: `server/lib/coupon-oa/three-source/offline.test.ts`

**Interfaces:**
- Consumes: Task 2 validated AI candidates and existing deterministic candidates.
- Produces:
  - `discoverRegularFullReductionCoupons(input): Promise<CouponCandidate[]>`;
  - `resolveCouponType(input): CouponTypeResolution`;
  - `confirmRegularFullReductionCoupon(input): Promise<ConfirmedCouponSource>`;
  - `parseSingleCouponIdentifierList(input): Promise<ParsedSingleCouponIdentifierList>`.

- [ ] **Step 1: Write coupon-resolution tests**

Cover:

- one source row returns `unique`;
- two populated coupon rows return `multiple_coupons` and no default selection;
- selected candidate ID binds exact source row and cannot be substituted by another row with the same display name;
- unknown type can become `regular_full_reduction` only through `ownerConfirmed` selection;
- unsupported types stay blocked;
- AI candidates cannot overwrite deterministic or owner-confirmed values.

- [ ] **Step 2: Write owner-supplement tests**

Assert missing fields can be supplied through:

```ts
ownerFieldValues?: Partial<Record<CouponFieldKey, unknown>>
```

Each supplement must record owner, revision and `ownerSupplement` provenance. Invalid dates, ratios, enums or amounts must still fail the regular full-reduction schema. Explicit overrides of non-missing source values require a non-empty reason.
Add a test proving an AI-proposed `activityPointPercent` remains pending until the owner confirms it and cannot be substituted with `discountAmountYuan / thresholdYuan`.

- [ ] **Step 3: Write single-coupon list tests**

Assert a selected identifier candidate selects exactly one Sheet; every accepted SKU is text, non-empty and one-per-cell; formulas, numeric IDs, separators and duplicates remain blockers. The confirmed coupon display name is metadata, not inferred from the five template Sheet names.

- [ ] **Step 4: Run tests and verify failure**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/recognition.test.ts server/lib/coupon-oa/three-source/offline.test.ts`  
Expected: FAIL on missing single-coupon APIs.

- [ ] **Step 5: Implement coupon discovery and confirmation**

Use stable candidate IDs derived from rule version, source hash, Sheet and row. Replace “first row with ten populated fields” with explicit candidate discovery. `confirmRegularFullReductionCoupon` must require a candidate ID when more than one coupon exists and then merge only validated owner supplements.

- [ ] **Step 6: Implement the single-coupon list parser**

Define `ParsedSingleCouponIdentifierList` with role, source hash, dimension, selected Sheet/column, confirmed coupon name, entries, provenance and issues. Keep legacy multi-tier helpers only where tests or non-P0 proposal code still require them; the P0 service must stop calling them.

- [ ] **Step 7: Run focused tests**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/recognition.test.ts server/lib/coupon-oa/three-source/offline.test.ts`  
Expected: PASS.

- [ ] **Step 8: Commit only if explicitly authorized**

Suggested scope: Task 3 files.  
Suggested message: `feat: require one confirmed coupon per p0 draft`

### Task 4: Generate and verify single-Sheet whitelist and blacklist workbooks

**Files:**
- Modify: `server/lib/excel-template-engine/template-manifests.ts`
- Modify: `server/lib/excel-template-engine/three-source.ts`
- Modify: `server/lib/coupon-oa/three-source/workflow.ts`
- Modify: `server/lib/coupon-oa/three-source/offline.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/assets.test.ts`

**Interfaces:**
- Consumes: Task 3 `ConfirmedCouponSource` and `ParsedSingleCouponIdentifierList`.
- Produces:
  - `generateSingleCouponSkuListWorkbook(input): Promise<SingleCouponSkuListWorkbook>`;
  - `verifySingleCouponSkuListWorkbook(input): Promise<void>`;
  - canonical package fields `couponName`, `whitelist`, optional `blacklist`;
  - `generateOfflineArtifacts` returning one coupon workbook, one single-Sheet whitelist and optional single-Sheet blacklist.

- [ ] **Step 1: Write generator tests**

Using the registered V1 list assets, assert:

- output contains exactly one Sheet named `满100减1`;
- A1 is `sku`, A2 onward exactly matches confirmed source order and all cells use `@` format;
- unused example Sheets are absent;
- whitelist and blacklist use role-specific filenames;
- template fingerprint mismatch, more rows than the registered data area, invalid Sheet name and output round-trip mismatch fail closed.

- [ ] **Step 2: Write workflow tests**

Assert second-round confirmed input produces exactly two artifacts without blacklist and three with blacklist. Confirm no source workbook is returned as an artifact and `requiresCalcImage` remains false for P0.

- [ ] **Step 3: Run tests and verify failure**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/offline.test.ts server/lib/feishu/coupon-oa/three-source/assets.test.ts`  
Expected: FAIL because the single-Sheet generator is absent.

- [ ] **Step 4: Register single-Sheet blueprint manifests**

Keep the existing asset names and SHA-256 values immutable. Add manifest semantics for blueprint Sheet, header, data start/end and dynamic output Sheet. Do not change the binary templates.

- [ ] **Step 5: Implement deterministic list generation and verification**

Load the asset, verify its fingerprint, retain/rename one blueprint Sheet, remove the others, clear the registered data area, write safe text IDs, then reopen and compare exact Sheet/header/order/format/count.

- [ ] **Step 6: Update canonical generation**

Replace P0 `whitelistByTier`/`blacklistByTier` generation with the Task 3 single-list objects. Keep overlap computation ID-based and preserve current revision/snapshot hashing.

- [ ] **Step 7: Run focused tests**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/offline.test.ts server/lib/feishu/coupon-oa/three-source/assets.test.ts`  
Expected: PASS.

- [ ] **Step 8: Commit only if explicitly authorized**

Suggested scope: Task 4 files.  
Suggested message: `feat: generate single-coupon standard lists`

### Task 5: Persist and execute one durable AI recognition run per workbook revision

**Files:**
- Create: `infra/postgres/migrations/0005_coupon_ai_recognition_runs.sql`
- Create: `server/lib/control-plane/postgres-coupon-ai-recognition-repository.ts`
- Create: `server/lib/control-plane/postgres-coupon-ai-recognition-repository.test.ts`
- Create: `server/lib/control-plane/coupon-ai-recognition-effect.ts`
- Create: `server/lib/control-plane/coupon-ai-recognition-effect.test.ts`
- Modify: `server/lib/control-plane/durable-coupon-control-plane-worker.ts`
- Modify: `server/lib/control-plane/durable-coupon-control-plane-worker.test.ts`
- Modify: `server/lib/control-plane/runtime-config.ts`
- Modify: `server/lib/control-plane/runtime-config.test.ts`

**Interfaces:**
- Consumes: Task 1 config, Task 2 gateway/validation and existing durable effect worker.
- Produces:
  - `CouponAiRecognitionRepository.enqueue(input): Promise<CouponAiRecognitionRun>`;
  - `CouponAiRecognitionRepository.saveTerminalResult(input): Promise<CouponAiRecognitionRun>`;
  - `createCouponAiRecognitionEffectHandler(input): DurableEffectHandler`;
  - `CouponAiRecognitionProjector.project(input: { run: CouponAiRecognitionRun; idempotencyKey: string }): Promise<void>`;
  - effect kind `coupon_three_source_ai_recognition`.

- [ ] **Step 1: Write migration and repository tests**

The migration must create a run table keyed by semantic key with pilot record ID, business task ID, revision, source slot (`couponTable | whitelist | blacklist | pending`), source reference/hash, provider/model/prompt version, status, request/response hashes, timings, structured validated result, fallback code and projection timestamp. Enqueue must atomically insert/reuse the run and a unique `effect_receipts` intent. The timeboxed Base-backed P0 effect uses a nullable `effect_receipts.task_id`; its business task ID remains mandatory inside the run/payload and must not be confused with a migrated PostgreSQL task row.

- [ ] **Step 2: Write handler tests before implementation**

Assert:

- pending run calls DeepSeek once, saves the terminal result, then projects it;
- terminal succeeded/failed/outcome-unknown run retries only projection and never calls DeepSeek again;
- 400/context, 429, timeout, invalid JSON and invalid coordinates persist a fallback result rather than retrying the provider;
- source hash/revision/owner mismatch causes stale projection rejection;
- duplicate effects share one semantic run.

- [ ] **Step 3: Run tests and verify failure**

Run: `pnpm vitest run server/lib/control-plane/postgres-coupon-ai-recognition-repository.test.ts server/lib/control-plane/coupon-ai-recognition-effect.test.ts`  
Expected: FAIL because migration/repository/handler do not exist.

- [ ] **Step 4: Implement the additive migration and repository**

Use an append-only `0005` migration. Store only validated structured candidates and audit summary, never the complete prompt/response/workbook. Use `ON CONFLICT` for effect/run semantic idempotency.

- [ ] **Step 5: Implement the effect handler**

When run state is pending, download and hash-check the file, serialize it, call the gateway once, validate candidates and save a terminal result before projection. On a retry, read the stored terminal result and skip external AI. Provider failures are business fallbacks, not automatic provider retries.

- [ ] **Step 6: Register the handler in the worker**

Extend `createDurableCouponControlPlaneWorker` dependencies so tests can inject the AI gateway/projector. Register the handler only when the P0 AI gate is enabled; otherwise no AI effect may execute.

- [ ] **Step 7: Run focused and PostgreSQL tests**

Run: `pnpm vitest run server/lib/control-plane/postgres-coupon-ai-recognition-repository.test.ts server/lib/control-plane/coupon-ai-recognition-effect.test.ts server/lib/control-plane/durable-coupon-control-plane-worker.test.ts`  
Expected: PASS.  
When local infrastructure is available: `pnpm test:control-plane:postgres`  
Expected: PASS; otherwise record the environment blocker without claiming integration success.

- [ ] **Step 8: Commit only if explicitly authorized**

Suggested scope: migration and Task 5 files.  
Suggested message: `feat: run p0 ai recognition durably`

### Task 6: Integrate AI status and the second-round confirmation card into the P0 Feishu flow

**Files:**
- Modify: `server/lib/feishu/coupon-oa/three-source/store.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/service.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/cards.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/dispatcher.ts`
- Create: `server/lib/feishu/coupon-oa/three-source/ai-projection.ts`
- Create: `server/lib/feishu/coupon-oa/three-source/ai-projection.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/service.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/cards.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5 candidates, single-coupon confirmation/generator and AI run projector.
- Produces:
  - stored per-source `aiStatus`, validated candidates and `AiAuditSummary`;
  - `buildCouponThreeSourceRecognizingCard(draft)`;
  - revised `buildCouponThreeSourceMappingCard(draft)` with type/coupon/missing-field inputs;
  - service methods `enqueueAiRecognition`, `applyAiRecognitionProjection`, `confirmSourcesAndGenerate`;
  - `createCouponThreeSourceAiProjector(dependencies): CouponAiRecognitionProjector`.

- [ ] **Step 1: Write store/service state tests**

Assert uploaded source records deterministic recognition immediately, stores AI status as pending when enabled, and enqueues by current source hash/revision. Applying AI results requires matching record, owner, revision, message ID and hash. Disabled/failed AI leaves deterministic/manual flow available.

- [ ] **Step 2: Write card tests**

Assert:

- pending AI shows “AI 识别中” without a generate button;
- unknown/ambiguous type shows an unselected required `couponType` control;
- multiple coupons shows an unselected required `couponCandidateId` control with source coordinates;
- missing fields render owner input controls;
- normal single-coupon recognition is prefilled but still included in overall source confirmation;
- stale revision is embedded in every callback;
- unresolved blockers suppress “确认来源并生成标准附件”.

- [ ] **Step 3: Write dispatcher tests**

Cover duplicate file events, repeated callbacks, stale cards, another owner, malformed form values, selected coupon not in candidates, unsupported type, AI failure fallback and successful confirmation/generation order.

- [ ] **Step 4: Run tests and verify failure**

Run: `pnpm vitest run server/lib/feishu/coupon-oa/three-source/store.test.ts server/lib/feishu/coupon-oa/three-source/service.test.ts server/lib/feishu/coupon-oa/three-source/cards.test.ts server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts`  
Expected: FAIL on missing AI/card state.

- [ ] **Step 5: Extend the stored draft contract**

Persist validated candidates and audit summary only. Add owner selection fields for coupon type, coupon candidate ID, field candidate IDs, owner supplements/override reasons, activity point, whitelist/blacklist identifiers and overlap decision. Bump the P0 pilot schema version and add backward parsing/defaults for existing drafts or explicitly fail them with a restart message.

- [ ] **Step 6: Split recognition from generation in the service**

`receiveSource` performs safe deterministic inspection and schedules AI, but never calls DeepSeek. `confirmSourcesAndGenerate` must first resolve the selected coupon and owner supplements, validate the selected list Sheet, freeze the source confirmation, and only then call Task 4 generation.

- [ ] **Step 7: Implement the second-round card and dispatcher parsing**

Keep coupon selection and any resulting missing-field refresh inside the same second-round stage. No option is preselected for unknown type or multiple coupons. Reject unsupported/unknown selections and old revisions before generation.

- [ ] **Step 8: Implement idempotent AI projection/card delivery**

Project the Task 5 terminal result only onto the matching current source. Send the updated state card with the stable effect ID as Feishu UUID so retries cannot create duplicate cards. If projection/card delivery fails, retry projection only.

- [ ] **Step 9: Run focused tests**

Run the Task 6 Vitest command from Step 4.  
Expected: PASS.

- [ ] **Step 10: Commit only if explicitly authorized**

Suggested scope: Task 6 files.  
Suggested message: `feat: confirm ai candidates before p0 generation`

### Task 7: Update operating baselines and verify the complete P0 implementation

**Files:**
- Modify: `docs/oa-ticket-reimbursement-materials/current/product/coupon-oa-mvp-prd-v1.3.md`
- Modify: `docs/oa-ticket-reimbursement-materials/current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md`
- Modify: `docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md`
- Modify: `docs/superpowers/specs/2026-10-10-coupon-three-source-p0-deepseek-recognition-design.md`
- Test: all files from Tasks 1–6

**Interfaces:**
- Consumes: complete implementation.
- Produces: current product/implementation/operations truth and reproducible test evidence.

- [ ] **Step 1: Add a no-network P0 integration test**

Use fake DeepSeek, Feishu, Base, Drive and PostgreSQL adapters to exercise:

```text
upload coupon + whitelist
→ enqueue one AI run per workbook
→ project candidates
→ second-round confirm one coupon and missing fields
→ generate and round-trip verify two standard Excel files
→ final preview only
```

Assert zero native OA calls and zero source-file attachments.

- [ ] **Step 2: Add failure-path integration cases**

Cover AI timeout fallback, multi-coupon unresolved, unknown type selection, invalid SKU, duplicate click, worker restart, lost lease, stale projection, template hash mismatch and partial upload failure.

- [ ] **Step 3: Update current product and implementation baselines**

Document one-coupon-per-submission, second-round type/coupon/field/list confirmation, AI non-fact-source status, deterministic generation and P0-only limitations. Do not state that DeepSeek or native OA is enabled until environment verification exists.

- [ ] **Step 4: Update the P0 runbook**

Add default-off environment variables, PostgreSQL migration/tick prerequisites, kill switch, allowlist, no-secret logging checks, rollback to deterministic recognition, and the exact safe order for a later real P0 test. Do not include real values.

- [ ] **Step 5: Run focused suites**

Run:

```bash
pnpm vitest run server/lib/coupon-oa/three-source server/lib/feishu/coupon-oa/three-source server/lib/control-plane/coupon-ai-recognition-effect.test.ts server/lib/control-plane/postgres-coupon-ai-recognition-repository.test.ts server/lib/control-plane/durable-coupon-control-plane-worker.test.ts server/lib/feishu/deepseek-chat-gateway.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run repository validation**

Run: `pnpm lint`  
Expected: PASS.  
Run: `pnpm typecheck`  
Expected: PASS.  
Run: `pnpm test`  
Expected: PASS.  
Run: `pnpm build`  
Expected: PASS.  
Run: `git diff --check`  
Expected: no output.

- [ ] **Step 7: Verify safety invariants**

Search the diff and test output to confirm there are no `.env` values, API keys, open IDs, Base/Drive identifiers, full prompts/responses, raw workbook data or native OA create calls. Confirm the AI feature flag defaults false.

- [ ] **Step 8: Mark design implemented only after all checks pass**

Change the design status from `用户已确认；待实施` to `已实现；待 P0 外部验证`. Do not claim real DeepSeek/Feishu E2E without a separately authorized run.

- [ ] **Step 9: Commit only if explicitly authorized**

Suggested scope: all task-owned files after reviewing staged contents.  
Suggested message: `feat: add confirmed deepseek recognition to coupon p0`
