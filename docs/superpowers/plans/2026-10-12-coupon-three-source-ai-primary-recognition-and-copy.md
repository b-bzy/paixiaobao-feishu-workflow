# Coupon Three-Source AI-Primary Recognition and Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 P0 三源提报改为 DeepSeek 首选识别、服务端证据校验、规则降级和一张中文第二轮审核卡，并按优惠券提报 Skill 合同生成可编辑活动文案。

**Architecture:** 工作簿 AI、公共日历和活动文案均通过 PostgreSQL durable effect 执行，终态先持久化再投影到当前 revision。AI 负责提出带证据和来源类别的候选，领域层负责坐标、类型、模板、券档和文案事实校验；owner 在统一第二轮卡片确认后，现有确定性模板引擎才生成并回读标准附件。

**Tech Stack:** Nitro、TypeScript、Vitest、Zod、ExcelJS、PostgreSQL、Feishu Base/Drive/Card、DeepSeek Chat Completions API

**Spec:** `docs/superpowers/specs/2026-10-12-coupon-three-source-ai-primary-recognition-and-copy-design.md`

## Implementation Record (2026-10-12)

The implementation keeps public-calendar enrichment and activity-copy proposal
inside the existing durable workbook-recognition effect instead of creating two
additional independently replayable effects and migrations. The calendar
gateway receives only the bounded month/day query; its candidates are passed to
the same DeepSeek recognition request. The terminal recognition result is saved
before Base/Card projection, so projection retries do not repeat the calendar
or DeepSeek calls. This is the smaller implementation of the approved
idempotency boundary and is recorded in ADR-0012 and the current implementation
baseline. The separately listed Task 6 repositories, migrations and copy
gateway are therefore intentionally not created.

Local verification completed with server typecheck, the full Vitest suite and
the Nitro production build. This record does not mean that Preview flags have
been enabled, a deployment has occurred or a Feishu E2E has passed.

## Global Constraints

- DeepSeek 是工作簿识别首选；确定性字段别名和模板指纹只在 AI 失败、无效、关闭或缺项时降级。
- AI 候选必须绑定当前 owner、revision、source SHA-256 和真实工作簿证据；模型置信度不能代替服务端验证。
- `source_explicit`、`ai_derived`、`ai_inferred`、`rule_fallback` 和 `owner_supplied` 必须保持可区分，不能把推测伪装成源事实。
- 无年份日期和公开活动主题可以产生 `ai_inferred` 候选，但必须在第二轮标记“系统推测”并由 owner 确认。
- 公共日历查询只能发送日期窗口、`zh-CN` locale 和查询版本，不得发送员工、SKU、券额或工作簿内容。
- “正常活动”“测试活动”“促销活动”“优惠券活动”“默认活动”“活动名称”“未命名活动”“待补充”等占位名称不得进入确认快照或生成产物。
- 活动背景必须覆盖当前 revision 的全部券档；AI 不得编造预算、GMV、ROI、渠道、商品范围、审批理由、超扣或内部政策。
- 多个“满 X 减 Y”行和名单 Sheet 是同一模板下的多个券档；只有不同已登记模板类型同时成立时才是券型歧义。
- 第二轮只显示中文业务问题；不得显示 Sheet、列号、单元格、内部 key 或字段映射术语。
- AI、公共日历和活动文案不运行在飞书同步入口、卡片回调或 Mac bridge；终态先持久化，再投影和发卡。
- 第二轮确认前不得生成 Excel；确认后只有登记的确定性模板引擎可以生成并回读附件。
- `FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false`，当前能力保持 `draft-only`，不得创建或提交原生 OA。
- feature flag、shadow、kill switch 默认关闭；关闭 AI 后仍使用规则降级和同一张中文人工确认卡。
- 不记录完整 prompt、response、工作簿内容、secret、open ID 或 Base/Drive 标识。
- 保留用户现有未提交修改；任务提交只能暂存本任务文件，未经单独 Git 授权不推送或部署。

## Review Focus

- 无年份日期恰好跨年、处于当前日期前后或多个材料出现冲突年份时，必须显示唯一可解释候选或只追问年份；Task 5 和 Task 8 的测试固定该行为。
- 配券表包含合并单元格、重复标题、隐藏 Sheet、公式缓存值或提示注入时，AI 证据仍必须真实且不能改变权限或 schema；Task 2 覆盖。
- DeepSeek 已成功但公共日历、活动文案或 Base/Card 投影失败重试时，不得再次外发工作簿或产生第二张卡；Task 6 和 Task 7 覆盖。
- owner 修改 AI 文案后来源文件变化、重复点击或旧投影到达时，旧候选不得覆盖修改或进入新 revision；Task 4、Task 7 和 Task 8 覆盖。
- 多券档、多 Sheet、多个 SKU 区域和真正的多模板歧义必须分别处理，不能再次用一个“多券”错误覆盖；Task 3 和 Task 8 覆盖。

---

## File Structure

### New files

- `docs/adr/0012-make-ai-primary-for-p0-three-source-recognition.md` — AI 主识别、规则降级、公共日历软证据与 owner 确认的架构决定。
- `server/lib/coupon-oa/three-source/activity-copy.ts` — 运行时文案合同、占位名称、事实快照、AI proposal 和覆盖校验。
- `server/lib/coupon-oa/three-source/activity-copy.test.ts` — 全券档、占位名称、事实约束和编辑保护测试。
- `server/lib/coupon-oa/three-source/public-calendar.ts` — 日期窗口和公开活动候选 schema、跨年合并规则。
- `server/lib/coupon-oa/three-source/public-calendar.test.ts` — 缺少年份、跨年、冲突与来源校验测试。
- `server/lib/feishu/public-campaign-calendar-gateway.ts` — 默认关闭的 HTTPS JSON 日历 gateway，不接收业务材料。
- `server/lib/feishu/public-campaign-calendar-gateway.test.ts` — URL、超时、大小、内容类型和错误分类测试。
- `server/lib/feishu/deepseek-activity-copy-gateway.ts` — 活动文案 DeepSeek 调用和审计 hash。
- `server/lib/feishu/deepseek-activity-copy-gateway.test.ts` — 文案 gateway 成功、失败、超时和敏感日志测试。
- `infra/postgres/migrations/0007_coupon_public_calendar_runs.sql` — 公共日历 run、结构化结果和投影状态。
- `infra/postgres/migrations/0008_coupon_ai_copy_runs.sql` — 活动文案 run、canonical fact hash、终态和投影状态。
- `server/lib/control-plane/postgres-coupon-public-calendar-repository.ts` — 公共日历 prepare/activate/terminal/projected 原子边界。
- `server/lib/control-plane/postgres-coupon-public-calendar-repository.test.ts` — SQL、语义键和并发幂等测试。
- `server/lib/control-plane/coupon-public-calendar-effect.ts` — 日期查询、终态持久化和当前 revision 投影。
- `server/lib/control-plane/coupon-public-calendar-effect.test.ts` — 失败降级、重试、终态重放和投影测试。
- `server/lib/control-plane/postgres-coupon-ai-copy-repository.ts` — 文案 prepare/activate/terminal/projected 原子边界。
- `server/lib/control-plane/postgres-coupon-ai-copy-repository.test.ts` — fact hash、并发幂等和投影测试。
- `server/lib/control-plane/coupon-ai-copy-effect.ts` — 文案调用、事实校验、一次重生成和终态投影。
- `server/lib/control-plane/coupon-ai-copy-effect.test.ts` — 占位、遗漏券档、幻觉、重试和投影测试。
- `server/lib/feishu/coupon-oa/three-source/ai-batch-projection.ts` — 聚合本 revision 的识别、日历和文案终态，只投影一张第二轮卡。
- `server/lib/feishu/coupon-oa/three-source/ai-batch-projection.test.ts` — 批次终态、旧 revision 和单卡幂等测试。

### Existing files to modify

- `.env.example` — 增加默认关闭的 AI-primary、shadow、公共日历和文案开关。
- `server/lib/coupon-oa/three-source/types.ts` — 候选来源、证据、推测、批次和文案快照类型。
- `server/lib/coupon-oa/three-source/ai-recognition.ts` — 升级 AI-primary schema、合并单元格和完整模板/券档/SKU 区域输出。
- `server/lib/coupon-oa/three-source/ai-recognition.test.ts` — 任意布局、证据、注入、合并单元格和 schema 测试。
- `server/lib/coupon-oa/three-source/recognition.ts` — AI 主结果、本地校验、规则缺项降级和 owner 优先级。
- `server/lib/coupon-oa/three-source/recognition.test.ts` — AI-primary 合并和模板/券档边界测试。
- `server/lib/coupon-oa/three-source/ai-text.ts` — 补充文字允许输出无年份候选标记，不再静默丢失整个日期语义。
- `server/lib/feishu/coupon-oa/three-source/ai-config.ts` — 读取三个独立开关与公共日历配置。
- `server/lib/feishu/coupon-oa/three-source/ai-config.test.ts` — 默认关闭、URL 和 secret 校验测试。
- `server/lib/feishu/coupon-oa/three-source/store.ts` — 持久保存候选来源、识别批次、日历、文案和 owner 确认快照。
- `server/lib/feishu/coupon-oa/three-source/service.ts` — prepare→persist→activate、批次聚合、规则降级和生成 Gate。
- `server/lib/feishu/coupon-oa/three-source/service.test.ts` — 编排、失败、重试和不重复副作用测试。
- `server/lib/feishu/coupon-oa/three-source/ai-projection.ts` — 单文件终态只更新批次，不直接多次发卡。
- `server/lib/feishu/coupon-oa/three-source/cards.ts` — 全中文统一第二轮卡、推测标签和业务摘要。
- `server/lib/feishu/coupon-oa/three-source/cards.test.ts` — 不暴露技术映射、条件字段和预填测试。
- `server/lib/feishu/coupon-oa/three-source/dispatcher.ts` — 中文表单解析、owner 修改与确认快照。
- `server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts` — 重复点击、旧卡、条件字段和优先级测试。
- `server/lib/control-plane/durable-coupon-control-plane-worker.ts` — 注册日历和文案 effect，并按 business task 串行化。
- `server/lib/control-plane/durable-coupon-control-plane-worker.test.ts` — handler 注册和同任务序列化测试。
- `scripts/lib/coupon-activity-copy.mjs` — 改为调用运行时合同或保留兼容薄包装，避免两套规则漂移。
- `scripts/lib/coupon-activity-copy.test.mjs` — 证明本地 Skill 工具与服务端合同使用相同事实和文案规则。
- `server/lib/coupon-oa/three-source/offline.test.ts` — 任意布局、多券档、多 Sheet 和生成 Gate 回归。
- `docs/oa-ticket-reimbursement-materials/current/product/coupon-oa-mvp-prd-v1.3.md` — 当前用户行为和验收。
- `docs/oa-ticket-reimbursement-materials/current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md` — 运行时模块、事实优先级和 effect。
- `docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-direct-http-poc-runbook-v1.md` — Preview 开关、shadow、kill switch、回滚和 E2E。
- `docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md` — 本地 worker、迁移和单用户测试步骤。

## Task Dependencies

```text
Task 1 architecture and gates
  → Task 2 AI-primary proposal contract
  → Task 3 evidence resolver and rule fallback
  → Task 4 activity-copy domain contract
  → Task 5 public-calendar soft evidence
  → Task 6 durable copy/calendar execution
  → Task 7 batch projection and service orchestration
  → Task 8 Chinese second-round interaction
  → Task 9 end-to-end regression and generation gates
  → Task 10 baselines, verification and rollout evidence
```

### Task 1: Record the architecture decision and add default-closed gates

**Files:**
- Create: `docs/adr/0012-make-ai-primary-for-p0-three-source-recognition.md`
- Modify: `.env.example`
- Modify: `server/lib/feishu/coupon-oa/three-source/ai-config.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/ai-config.test.ts`

**Interfaces:**
- Consumes: existing DeepSeek key/base URL/model/timeout and P0 AI recognition flag.
- Produces: `CouponThreeSourceAiConfig`, `CouponPublicCalendarConfig`, `isCouponThreeSourceAiPrimaryEnabled()`, `isCouponThreeSourceAiShadowEnabled()`, `isCouponActivityCopyEnabled()`, `getCouponPublicCalendarConfig()`.

- [ ] **Step 1: Write failing configuration tests**

Assert all new switches default to false; primary requires the existing recognition flag; shadow and primary cannot both mutate user-visible state; enabled calendar requires one exact HTTPS endpoint, a positive timeout up to 30,000 ms and max response bytes up to 262,144; errors never include keys or full URLs with query parameters.

- [ ] **Step 2: Run the config test and verify failure**

Run: `pnpm vitest run server/lib/feishu/coupon-oa/three-source/ai-config.test.ts`  
Expected: FAIL on missing interfaces and switches.

- [ ] **Step 3: Implement exact environment contracts**

Add:

```dotenv
FEISHU_COUPON_THREE_SOURCE_P0_AI_PRIMARY_ENABLED=false
FEISHU_COUPON_THREE_SOURCE_P0_AI_SHADOW_ENABLED=false
FEISHU_COUPON_THREE_SOURCE_P0_ACTIVITY_COPY_ENABLED=false
FEISHU_COUPON_THREE_SOURCE_P0_PUBLIC_CALENDAR_ENABLED=false
FEISHU_COUPON_THREE_SOURCE_P0_PUBLIC_CALENDAR_ENDPOINT=
FEISHU_COUPON_THREE_SOURCE_P0_PUBLIC_CALENDAR_TIMEOUT_MS=5000
```

The calendar endpoint receives only `start_month_day`, `end_month_day`, `locale` and `query_version`. Do not add a general web-search URL or workbook passthrough.

- [ ] **Step 4: Add ADR-0012**

Record AI-primary precedence, owner confirmation, rule fallback, public calendar as soft evidence, no arbitrary browsing, durable effects, single-card projection, kill switches and native-OA exclusion. Do not rewrite ADR-0011.

- [ ] **Step 5: Run focused verification**

Run: `pnpm vitest run server/lib/feishu/coupon-oa/three-source/ai-config.test.ts`  
Expected: PASS.  
Run: `rtk git diff --check -- .env.example docs/adr/0012-make-ai-primary-for-p0-three-source-recognition.md server/lib/feishu/coupon-oa/three-source/ai-config.ts server/lib/feishu/coupon-oa/three-source/ai-config.test.ts`  
Expected: no output.

- [ ] **Step 6: Commit if Git authorization is still active**

Stage only Task 1 files. Suggested message: `docs(coupon-oa): record AI-primary recognition boundary`.

### Task 2: Upgrade the workbook AI proposal to a complete evidence contract

**Files:**
- Modify: `server/lib/coupon-oa/three-source/types.ts`
- Modify: `server/lib/coupon-oa/three-source/ai-recognition.ts`
- Test: `server/lib/coupon-oa/three-source/ai-recognition.test.ts`
- Test: `server/lib/feishu/deepseek-chat-gateway.test.ts`

**Interfaces:**
- Consumes: `OfflineSourceFile`, current `serializeWorkbookForAi()` and `CouponThreeSourceAiGateway`.
- Produces: `CandidateOrigin`, `CandidateEvidence`, `AiFieldProposal`, `AiTemplateProposal`, `AiTierProposal`, `AiSkuRegionProposal`, `ValidatedAiRecognition`; prompt version `coupon-three-source-p0-ai-primary-v1`.

- [ ] **Step 1: Write failing serializer tests**

Create in-memory workbooks covering merged headers, hidden Sheet, duplicate headings, formula/cache values, blank boundaries and a cell containing prompt injection. Assert the serialized payload records merge ranges and data exactly once, does not execute formulas or links, and keeps injected instructions as inert cell text.

- [ ] **Step 2: Write failing proposal-schema tests**

Assert a valid proposal can return file role, template kind, every coupon tier, standard fields, SKU regions and evidence. Assert nonexistent coordinates, out-of-range regions, duplicate tier IDs, unsupported dimensions, unregistered template kinds and activity facts without evidence become issues rather than accepted candidates.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/ai-recognition.test.ts server/lib/feishu/deepseek-chat-gateway.test.ts`  
Expected: FAIL on the new schema and merge metadata.

- [ ] **Step 4: Add exact candidate types**

Define:

```ts
export type CandidateOrigin =
  | "source_explicit"
  | "ai_derived"
  | "ai_inferred"
  | "rule_fallback"
  | "owner_supplied";

export interface CandidateEvidence {
  sourceHash: string;
  sheetName: string;
  cells: string[];
  region?: { startCell: string; endCell: string };
}
```

Every accepted AI proposal carries `origin`, evidence and a stable ID derived from prompt version, source hash, semantic kind and evidence.

- [ ] **Step 5: Implement serialization and strict validation**

Extend `SerializedWorkbookForAi` with merge ranges and safe dimensions. Validate region corners and every evidence cell against the serialized workbook. Preserve valid partial results while recording rejected items in `issues`.

- [ ] **Step 6: Replace the prompt with AI-primary instructions**

Request complete semantic recognition rather than header-coordinate hints. Explicitly define the registered template set, multi-tier semantics, candidate origin rules, prompt-injection boundary and strict JSON schema. Do not ask the model for permission or final approval decisions.

- [ ] **Step 7: Run focused tests**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/ai-recognition.test.ts server/lib/feishu/deepseek-chat-gateway.test.ts`  
Expected: PASS, including response-size, timeout and secret-redaction tests.

- [ ] **Step 8: Commit if authorized**

Stage only Task 2 files. Suggested message: `feat(coupon-oa): add AI-primary workbook evidence contract`.

### Task 3: Make AI the primary resolver and deterministic rules the fallback

**Files:**
- Modify: `server/lib/coupon-oa/three-source/recognition.ts`
- Modify: `server/lib/coupon-oa/three-source/lists.ts`
- Modify: `server/lib/coupon-oa/three-source/types.ts`
- Test: `server/lib/coupon-oa/three-source/recognition.test.ts`
- Test: `server/lib/coupon-oa/three-source/offline.test.ts`

**Interfaces:**
- Consumes: Task 2 `ValidatedAiRecognition` and existing deterministic `WorkbookRecognition`.
- Produces: `resolveAiPrimaryRecognition(input): AiPrimaryRecognitionProjection`, `resolveCouponTemplateFromAi(input): CouponTemplateResolution`, and confirmed sources carrying candidate origin/evidence.

- [ ] **Step 1: Write failing precedence tests**

Assert validated AI results become the primary projection even when header aliases disagree; deterministic candidates fill only absent AI fields or the whole result after AI terminal failure/disable; owner values always win; AI inference never overwrites an explicit workbook value.

- [ ] **Step 2: Write failing template/tier/list tests**

Cover one template with five coupon tiers and five whitelist Sheet regions, one ambiguous SKU region, two genuinely different template kinds, a filename that conflicts with workbook structure and an unsupported template. Assert only genuine multi-template ambiguity requests a template choice.

- [ ] **Step 3: Write Review Focus regressions**

Add tests for repeated headings, multiple possible SKU regions and two materials that expose conflicting explicit dates. Expected output retains both conflict candidates and one Chinese confirmation issue rather than silently selecting the first.

- [ ] **Step 4: Run tests and verify failure**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/recognition.test.ts server/lib/coupon-oa/three-source/offline.test.ts`  
Expected: FAIL because current deterministic candidates have higher effective precedence.

- [ ] **Step 5: Implement the AI-primary projection**

Build canonical candidates from validated AI evidence first. Call the existing deterministic inspection only as `rule_fallback`; merge it into missing slots without changing AI evidence or owner values. Keep all current numeric/date/template/SKU schema checks.

- [ ] **Step 6: Remove business reliance on global Sheet/column selection**

Keep source coordinates internally for audit, but expose ambiguity as business choices containing coupon tier name, role and row count. Preserve current multi-Sheet generation and overlap logic.

- [ ] **Step 7: Run focused tests**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/recognition.test.ts server/lib/coupon-oa/three-source/offline.test.ts`  
Expected: PASS.

- [ ] **Step 8: Commit if authorized**

Stage only Task 3 files. Suggested message: `feat(coupon-oa): prefer validated AI recognition`.

### Task 4: Port the Skill activity-copy rules into a versioned runtime domain module

**Files:**
- Create: `server/lib/coupon-oa/three-source/activity-copy.ts`
- Create: `server/lib/coupon-oa/three-source/activity-copy.test.ts`
- Modify: `scripts/lib/coupon-activity-copy.mjs`
- Test: `scripts/lib/coupon-activity-copy.test.mjs`
- Modify: `server/lib/coupon-oa/three-source/types.ts`

**Interfaces:**
- Consumes: confirmed/validated coupon tiers, dates, business mode, product/model evidence and campaign candidate.
- Produces: `isPlaceholderActivityName(value: string): boolean`, `buildActivityCopyFacts(input): ActivityCopyFacts`, `buildActivityCopyAiRequest(input): ActivityCopyAiRequest`, `validateActivityCopyProposal(input): ValidatedActivityCopy`, `activityCopyPromptVersion`.

- [ ] **Step 1: Write failing placeholder tests**

Assert the eight named placeholders, extension-stripped source filenames and generic unidentifiable phrases are rejected; concrete names such as `9.30-10.10寄卖苹果手机优惠券申请` are accepted.

- [ ] **Step 2: Write failing facts and prompt tests**

Assert the facts snapshot includes all coupon tiers in source order, date provenance, business mode, product/model evidence and a stable `factsHash`. Assert the prompt embeds the Skill contract but excludes secrets, open IDs and source bytes.

- [ ] **Step 3: Write failing proposal-validation tests**

Assert valid copy follows the period/business/product/theme structure and background covers every tier. Reject copy that preserves a placeholder, omits a tier, changes an amount/date, invents budget/GMV/channel/approval reason/over-deduction, or references evidence absent from the fact snapshot.

- [ ] **Step 4: Run tests and verify failure**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/activity-copy.test.ts scripts/lib/coupon-activity-copy.test.mjs`  
Expected: FAIL because the server runtime contract is absent.

- [ ] **Step 5: Implement the runtime contract**

Port business rules from `.claude/skills/OA优惠券提报/` and `scripts/lib/coupon-activity-copy.mjs` into TypeScript without reading Skill files at runtime. Let DeepSeek organize prose; keep tier coverage, provenance, amount/date equality and prohibited-fact checks deterministic.

- [ ] **Step 6: Remove duplicate local behavior**

Make the `.mjs` helper a compatibility wrapper around the same serialized fact/copy contract or update its fixtures to prove byte-equivalent business rules. Do not leave a second independently evolving placeholder list or narrative template.

- [ ] **Step 7: Run focused tests**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/activity-copy.test.ts scripts/lib/coupon-activity-copy.test.mjs`  
Expected: PASS.

- [ ] **Step 8: Commit if authorized**

Stage only Task 4 files. Suggested message: `feat(coupon-oa): add verified activity copy contract`.

### Task 5: Add controlled public-calendar soft evidence and missing-year inference

**Files:**
- Create: `server/lib/coupon-oa/three-source/public-calendar.ts`
- Create: `server/lib/coupon-oa/three-source/public-calendar.test.ts`
- Create: `server/lib/feishu/public-campaign-calendar-gateway.ts`
- Create: `server/lib/feishu/public-campaign-calendar-gateway.test.ts`
- Modify: `server/lib/coupon-oa/three-source/ai-text.ts`
- Test: `server/lib/coupon-oa/three-source/ai-text.test.ts`

**Interfaces:**
- Consumes: month/day window, server `now`, file timestamp hints and optional allowlisted calendar response.
- Produces: `PublicCampaignCalendarGateway.lookup(input)`, `resolveMissingYearCandidate(input): DateInferenceResult`, `mergeCampaignThemeCandidates(input): CampaignInferenceResult`.

- [ ] **Step 1: Write failing date-inference tests**

Cover explicit year, unique year elsewhere in the same revision, no-year window near current date, `12月20日—1月5日` crossing years, conflicting years and invalid dates. Assert any non-explicit result has origin `ai_inferred`, a Chinese confirmation label and no final-confirmed status.

- [ ] **Step 2: Write failing public-calendar gateway tests**

Mock fetch and assert only the permitted query fields are sent; reject non-HTTPS endpoints, redirects to a different origin, private/local targets, non-JSON content, oversized response, timeout, invalid schema and a response without source URL/fetched-at metadata.

- [ ] **Step 3: Write failing campaign-theme tests**

Assert a calendar match can propose `双十一大促` or `年末促销`; conflicting matches remain alternatives; calendar facts cannot create coupon amounts, SKU scope or internal approval facts.

- [ ] **Step 4: Run tests and verify failure**

Run: `pnpm vitest run server/lib/coupon-oa/three-source/public-calendar.test.ts server/lib/feishu/public-campaign-calendar-gateway.test.ts server/lib/coupon-oa/three-source/ai-text.test.ts`  
Expected: FAIL on missing modules and inference metadata.

- [ ] **Step 5: Implement pure inference rules and the gateway**

Keep year selection deterministic over provided evidence: explicit material year first, unique revision year second, current-time/calendar candidate third. Never mutate a source date in place. The gateway returns structured public candidates only and has no workbook/employee input parameter.

- [ ] **Step 6: Update supplement extraction**

When text contains a valid month/day range without year, retain a structured partial date candidate with `needsYearConfirmation: true`; do not drop all date meaning and do not invent a confirmed year.

- [ ] **Step 7: Run focused tests**

Run the Task 5 command again.  
Expected: PASS.

- [ ] **Step 8: Commit if authorized**

Stage only Task 5 files. Suggested message: `feat(coupon-oa): add controlled campaign date inference`.

### Task 6: Persist and execute calendar and activity-copy effects durably

**Files:**
- Create: `infra/postgres/migrations/0007_coupon_public_calendar_runs.sql`
- Create: `infra/postgres/migrations/0008_coupon_ai_copy_runs.sql`
- Create: `server/lib/control-plane/postgres-coupon-public-calendar-repository.ts`
- Create: `server/lib/control-plane/postgres-coupon-public-calendar-repository.test.ts`
- Create: `server/lib/control-plane/coupon-public-calendar-effect.ts`
- Create: `server/lib/control-plane/coupon-public-calendar-effect.test.ts`
- Create: `server/lib/control-plane/postgres-coupon-ai-copy-repository.ts`
- Create: `server/lib/control-plane/postgres-coupon-ai-copy-repository.test.ts`
- Create: `server/lib/control-plane/coupon-ai-copy-effect.ts`
- Create: `server/lib/control-plane/coupon-ai-copy-effect.test.ts`
- Create: `server/lib/feishu/deepseek-activity-copy-gateway.ts`
- Create: `server/lib/feishu/deepseek-activity-copy-gateway.test.ts`
- Modify: `server/lib/control-plane/durable-coupon-control-plane-worker.ts`
- Test: `server/lib/control-plane/durable-coupon-control-plane-worker.test.ts`

**Interfaces:**
- Consumes: Task 4 fact/copy contract, Task 5 calendar gateway and existing `DurableEffect` contract.
- Produces: `CouponPublicCalendarRun`, `PostgresCouponPublicCalendarRepository`, `createCouponPublicCalendarEffectHandler()`, `CouponAiCopyRun`, `PostgresCouponAiCopyRepository`, `createCouponAiCopyEffectHandler()`.

- [ ] **Step 1: Add append-only migrations and migration discovery tests**

Migration `0007` stores date window, locale, provider, query version, status, structured result hashes and projection time. Migration `0008` stores draft/task/owner/revision, canonical fact hash, provider/model/prompt version, status, validated copy, audit hashes and projection time. Neither table stores raw provider response or workbook content.

- [ ] **Step 2: Write failing repository tests**

Cover prepare without effect, persist-then-activate, semantic-key dedupe, concurrent prepare, terminal-result reuse and idempotent `markProjected()` for both repositories.

- [ ] **Step 3: Write failing effect/gateway tests**

Cover success, timeout, 429/5xx, invalid JSON, terminal replay, projection retry, stale revision and no second provider call after terminal persistence. For copy, assert one retry is allowed only when deterministic fact validation rejects the first prose result; the same request may never loop indefinitely.

- [ ] **Step 4: Run focused tests and verify failure**

Run: `pnpm vitest run server/lib/control-plane/postgres-coupon-public-calendar-repository.test.ts server/lib/control-plane/coupon-public-calendar-effect.test.ts server/lib/control-plane/postgres-coupon-ai-copy-repository.test.ts server/lib/control-plane/coupon-ai-copy-effect.test.ts server/lib/feishu/deepseek-activity-copy-gateway.test.ts`  
Expected: FAIL because migrations and handlers are absent.

- [ ] **Step 5: Implement repositories and handlers**

Use semantic keys from the spec exactly. Persist terminal state before projection. Calendar failure is non-blocking soft evidence; copy failure leaves editable fields unresolved. Redact all raw payloads from errors and logs.

- [ ] **Step 6: Register both effects in the worker**

Add optional dependencies to `createDurableCouponControlPlaneWorker()`. Extend its serialization key so recognition, text, calendar and copy effects for one `businessTaskId` execute serially while different drafts remain parallel.

- [ ] **Step 7: Run migration and control-plane tests**

Run: `pnpm test:control-plane`  
Expected: PASS, with PostgreSQL-only tests skipped only when the documented database prerequisite is absent.

- [ ] **Step 8: Commit if authorized**

Stage only Task 6 files. Suggested message: `feat(coupon-oa): add durable calendar and copy effects`.

### Task 7: Aggregate one revision into one AI batch and one card projection

**Files:**
- Create: `server/lib/feishu/coupon-oa/three-source/ai-batch-projection.ts`
- Create: `server/lib/feishu/coupon-oa/three-source/ai-batch-projection.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/store.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/service.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/service.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/ai-projection.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/ai-projection.test.ts`

**Interfaces:**
- Consumes: Task 3 primary projection, Task 4 facts, Task 5 inference and Task 6 durable runs.
- Produces: `CouponRecognitionBatchState`, `advanceCouponRecognitionBatch(input)`, `projectCouponRecognitionBatch(input)` and service prepare→persist→activate orchestration.

- [ ] **Step 1: Write failing batch-state tests**

Assert a revision has one batch ID and expected source slots; individual source completion updates state without sending a mapping card; the final source or deadline moves to calendar/copy; only terminal copy/fallback state makes the second-round card ready.

- [ ] **Step 2: Write Review Focus stale/retry tests**

Cover owner/revision/source hash changes, old calendar/copy results, Base update failure, card projection retry, worker restart and two terminal effects racing. Assert no old result mutates the new revision and the second-round card effect key is stable.

- [ ] **Step 3: Run tests and verify failure**

Run: `pnpm vitest run server/lib/feishu/coupon-oa/three-source/ai-batch-projection.test.ts server/lib/feishu/coupon-oa/three-source/ai-projection.test.ts server/lib/feishu/coupon-oa/three-source/service.test.ts`  
Expected: FAIL because current projector sends a card as soon as all per-file recognition runs finish and has no calendar/copy batch state.

- [ ] **Step 4: Extend stored draft state**

Persist batch ID, revision, expected source hashes, phase, deadline, calendar run, copy run, primary projection and last projected card semantic key. Parse legacy drafts without these fields as pre-batch state; do not rewrite completed/canceled drafts.

- [ ] **Step 5: Implement prepare→persist→activate orchestration**

Prepare all required runs, persist their IDs to Base, then activate effects. Never activate an effect whose run ID is not recoverable from the draft. On AI failure, build the rule fallback projection and continue to the same copy/manual-review phase.

- [ ] **Step 6: Replace per-file card sending with batch projection**

`ai-projection.ts` only persists source terminal status and invokes the batch advancement interface. `ai-batch-projection.ts` owns the single mapping-card effect. Repeated completion and projection are idempotent.

- [ ] **Step 7: Run focused tests**

Run the Task 7 command again.  
Expected: PASS.

- [ ] **Step 8: Commit if authorized**

Stage only Task 7 files. Suggested message: `feat(coupon-oa): aggregate AI recognition into one review card`.

### Task 8: Replace technical mapping UI with one Chinese business review card

**Files:**
- Modify: `server/lib/feishu/coupon-oa/three-source/cards.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/cards.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/dispatcher.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/service.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/service.test.ts`

**Interfaces:**
- Consumes: Task 7 current batch projection and existing supplement text action.
- Produces: `buildCouponThreeSourceReviewCard(draft)`, Chinese form parsing and an immutable owner-confirmed snapshot.

- [ ] **Step 1: Write failing card tests**

Assert serialized JSON contains no `Sheet`、列号、坐标、`activityBackground`、`businessMode` or “映射”; valid fields are prefilled; `ai_inferred` fields display “系统推测，请确认”; activity name/background remain editable; unique multi-Sheet lists render summaries only.

- [ ] **Step 2: Write conditional and copy tests**

Assert “是否超扣=否” hides reason, “是” displays a required Chinese reason field; all business modes are Chinese choices; placeholders never prefill activity name; missing copy becomes one Chinese question rather than `正常活动`.

- [ ] **Step 3: Write dispatcher/service tests**

Cover owner edit precedence, inferred-year confirmation, supplement text with no year, duplicate click, pending batch, stale revision, no-blacklist confirmation, ambiguous template, one ambiguous list region and final confirmation with unresolved inference.

- [ ] **Step 4: Run tests and verify failure**

Run: `pnpm vitest run server/lib/feishu/coupon-oa/three-source/cards.test.ts server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts server/lib/feishu/coupon-oa/three-source/service.test.ts`  
Expected: FAIL because the current card still renders global Sheet/column selectors and internal candidate concepts.

- [ ] **Step 5: Implement field presentation metadata**

Define one server-side Chinese metadata map for label, input type, condition, inference badge and required state. Coordinates remain in audit state only. Use business alternatives such as券档名称和 SKU 数量 when a real ambiguity must be shown.

- [ ] **Step 6: Implement confirmation snapshot rules**

On final submit, deep-merge form values, reject unresolved inference/conflicts, preserve owner edits as `owner_supplied`, bind snapshot to owner/revision/fact hashes and invalidate old artifacts. Do not call DeepSeek synchronously from the callback.

- [ ] **Step 7: Run focused tests**

Run the Task 8 command again.  
Expected: PASS.

- [ ] **Step 8: Commit if authorized**

Stage only Task 8 files. Suggested message: `feat(coupon-oa): add unified Chinese AI review`.

### Task 9: Prove generation remains deterministic and add arbitrary-layout E2E fixtures

**Files:**
- Modify: `server/lib/coupon-oa/three-source/offline.test.ts`
- Modify: `server/lib/coupon-oa/three-source/workflow.ts` only if the confirmation snapshot needs new provenance fields.
- Modify: `server/lib/feishu/coupon-oa/three-source/service.test.ts`
- Test: `server/lib/excel-template-engine/three-source-single.test.ts`
- Add only脱敏 fixtures under: `docs/oa-ticket-reimbursement-materials/reference/fixtures/`

**Interfaces:**
- Consumes: Tasks 2–8 completed recognition and owner confirmation snapshot.
- Produces: full regression evidence from arbitrary source layout to verified standard artifacts without native OA.

- [ ] **Step 1: Add脱敏 arbitrary-layout fixtures**

Include reordered headers, narrative-first layout, merged headers, multi-Sheet whitelist, no-year dates, cross-year dates and five tiers. Do not copy real business files, IDs or employee data.

- [ ] **Step 2: Write failing offline E2E tests**

Stub validated AI proposals and public-calendar/copy results. Assert one second-round snapshot contains all tiers, inferred fields require confirmation, owner edits survive, and generation is blocked until every required confirmation resolves.

- [ ] **Step 3: Add deterministic generation assertions**

After confirmation, assert exact template manifest/version, Sheet collection, formulas, SKU order/text format, source/artifact hashes and no source file used as output. Repeat generation clicks and worker restarts must not duplicate uploads or artifacts.

- [ ] **Step 4: Add native-OA and failure assertions**

Assert no approval effect is created; artifact upload failure leaves the revision failed/repairable without partial success; template hash mismatch and readback mismatch fail closed.

- [ ] **Step 5: Run affected integration tests**

Run: `pnpm test:coupon-three-source:offline`  
Run: `pnpm vitest run server/lib/feishu/coupon-oa/three-source/service.test.ts server/lib/excel-template-engine/three-source-single.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit if authorized**

Stage only Task 9 code/tests/fixtures. Suggested message: `test(coupon-oa): cover AI-primary three-source flow`.

### Task 10: Update current baselines, verify the repository and prepare Preview rollout

**Files:**
- Modify: `docs/oa-ticket-reimbursement-materials/current/product/coupon-oa-mvp-prd-v1.3.md`
- Modify: `docs/oa-ticket-reimbursement-materials/current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md`
- Modify: `docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-direct-http-poc-runbook-v1.md`
- Modify: `docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md`
- Modify: `docs/oa-ticket-reimbursement-materials/claude-code-skill-contract.md` only if the runtime contract mapping is not already described.

**Interfaces:**
- Consumes: implemented behavior and exact migrations/flags from Tasks 1–9.
- Produces: current product/implementation/operations truth, rollback instructions and complete verification evidence.

- [ ] **Step 1: Update the current product baseline**

Document AI-primary recognition, candidate origins, one Chinese second round, no-year and campaign inference, placeholder-name rejection, owner edit precedence, multi-tier semantics and deterministic generation. Do not claim arbitrary web browsing, production readiness or native OA.

- [ ] **Step 2: Update implementation and operations baselines**

Document migrations `0007`/`0008`, semantic keys, prepare→persist→activate, batch/card idempotency, public-calendar data minimization, shadow mode, kill switches, worker health and `/clear` E2E reset.

- [ ] **Step 3: Run affected suites**

Run:

```bash
pnpm test:coupon-activity-copy
pnpm test:coupon-three-source:offline
pnpm test:control-plane
pnpm vitest run server/lib/feishu/coupon-oa/three-source/*.test.ts
```

Expected: all affected tests PASS; PostgreSQL-only tests skip only when the documented local database prerequisite is absent.

- [ ] **Step 4: Run repository verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: lint, typecheck, all tests and Nitro build PASS. Record exact pass/skip counts.

- [ ] **Step 5: Inspect security and diff boundaries**

Confirm no `.env*`, secret, open ID, Base/Drive identifier, raw prompt/response, source workbook, generated business artifact or unrelated dirty file is staged. Confirm migrations `0001`–`0006` are unchanged and new migrations are append-only.

- [ ] **Step 6: Prepare but do not silently execute rollout**

Document exact Preview variables and shadow/primary order. A separate explicit release action is required before push, Vercel deployment, migration against shared PostgreSQL, public-calendar activation or real Feishu E2E. Keep native OA and production flags off.

- [ ] **Step 7: Commit if authorized**

Stage only Task 10 documentation and intentional config changes. Suggested message: `docs(coupon-oa): update AI-primary P0 baseline`.
