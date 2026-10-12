# Coupon Three-Source Local AI Preflight Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一套在进入飞书手工测试前可重复运行的本地测试用例、真实 DeepSeek 预检和明确的 go/no-go Gate。

**Architecture:** 单元测试验证 AI 严格 schema、证据坐标、文案事实合同与服务端纠偏；控制面集成测试使用 fake gateway 验证一次外发、终态持久化和投影重试；显式启用的 live test 使用用户指定的本地 Excel 和生产同路径 DeepSeek gateway，但不连接飞书、Base、Drive、对象存储或 OA。真实文件、密钥、完整 prompt、响应和 SKU 值不进入仓库或日志。

**Tech Stack:** TypeScript、Vitest、ExcelJS、Zod、DeepSeek official HTTPS gateway、pnpm

**Spec:** `docs/superpowers/specs/2026-10-12-coupon-three-source-ai-primary-recognition-and-copy-design.md`

## Global Constraints

- DeepSeek 是第一轮工作簿识别首选；规则映射只在 AI 失败或关闭时降级。
- AI 只提供候选；服务端验证 source hash、Sheet、坐标、类型、券档和 SKU 区域。
- 第二轮确认前不得生成标准 Excel、创建 OA 或产生飞书/Base/Drive 写入。
- 源白名单只作为解析输入，绝不成为 OA 附件。
- live test 必须显式传入两个本地文件路径和开关，默认 `pnpm test` 不外发。
- 日志只允许文件 basename、hash 前缀、Sheet、坐标、候选数量、审计状态和活动文案；禁止打印密钥、open ID、完整 prompt/response 或 SKU 值。
- 无年份日期只能产生 `ai_inferred` 候选，并在后续第二轮要求 owner 确认。
- 活动文案必须覆盖全部券档，不得保留占位名称或编造预算、GMV、ROI、审批理由、超扣等事实。

## Review Focus

- 工作表总行数由其他列拉长时，SKU 区域末行应校正到标识列最后一个真实非空单元格；Task 1 覆盖。
- 同一字段跨多行包含多个渠道时，应保留全部去重渠道而不是只取首行；Task 2 覆盖。
- DeepSeek 返回部分合法、部分非法候选时，应保留合法候选并把非法部分转为 issue；Task 1 覆盖。
- durable effect 已有终态但投影重试时，不得再次调用 DeepSeek 或重新生成活动文案；Task 2 覆盖。
- live test 失败、缺少文件或缺少显式开关时必须 fail closed，且不得意外连接飞书或产生 OA 副作用；Task 3 覆盖。

---

## Test Matrix

| ID | 层级 | 输入 | 关键断言 | 是否外发 |
| --- | --- | --- | --- | --- |
| U01 | 单元 | 多券档配券候选 | 同一模板保留全部券档，不触发“多券型” | 否 |
| U02 | 单元 | `channels` 多行不同值 | 全部去重值进入文案事实 | 否 |
| U03 | 单元 | ISO 日期值 | 文案周期只显示 `YYYY-MM-DD` | 否 |
| U04 | 单元 | 占位活动名“正常活动” | 占位值被拒绝，不进入活动草稿 | 否 |
| U05 | 单元 | 活动背景遗漏任一券档 | 文案校验失败 | 否 |
| U06 | 单元 | SKU `endCell` 使用工作表总行数 | 自动校正到标识列真实末行并记录 issue | 否 |
| U07 | 单元 | SKU 起止列不同或起点不存在 | 候选被拒绝 | 否 |
| U08 | 单元 | 单元格中含 prompt injection | 只作为数据，不改变 schema 或权限 | 否 |
| I01 | 集成 | 主识别成功 + 专用文案成功 | 终态含名称、背景、全部券档和审计摘要 | fake |
| I02 | 集成 | 文案超时/无效 | 工作簿候选保留，文案为空并显示稳定失败码 | fake |
| I03 | 集成 | effect 已终态后投影重试 | gateway 调用次数保持 1 | fake |
| I04 | 集成 | 多渠道与 ISO 日期 | gateway 收到去重渠道和业务日期格式 | fake |
| L01 | 本地 live | 用户提供的配券表 | 8 行配置、4 个唯一券档、2 个渠道、文案成功 | DeepSeek |
| L02 | 本地 live | 用户提供的多 Sheet 白名单 | 4 个名单、4 个 SKU 区域，`3000减30` 为 `A2:A121` | DeepSeek |
| L03 | 本地 live | 无年份 `9.30-10.10` | 年份候选标记为推测，不伪装来源明确值 | DeepSeek |
| G01 | Gate | 全部本地验证 | 测试、类型、构建、diff check 全部通过才允许飞书测试 | 否 |

### Task 1: Complete deterministic recognition and evidence regression tests

**Files:**
- Modify: `server/lib/coupon-oa/three-source/ai-recognition.test.ts`
- Modify: `server/lib/coupon-oa/three-source/activity-copy.test.ts`
- Test: `server/lib/coupon-oa/three-source/ai-recognition.test.ts`
- Test: `server/lib/coupon-oa/three-source/activity-copy.test.ts`

**Interfaces:**
- Consumes: `validateCouponThreeSourceAiProposal({ proposal, workbook })` and `validateActivityCopyProposal({ facts, proposal })`.
- Produces: U01、U04–U08 的稳定回归测试；不新增运行时外部依赖。

- [ ] **Step 1: Add the missing failing evidence tests**

  Add named tests for a cross-column SKU range, a missing start cell, and a proposal containing valid and invalid candidates together. Assert that invalid candidates become explicit `issues` while valid candidates remain.

- [ ] **Step 2: Run the focused tests and verify the new assertions fail where coverage is missing**

  Run: `pnpm exec vitest run server/lib/coupon-oa/three-source/ai-recognition.test.ts`

  Expected: the new test demonstrates any missing fail-closed behavior before implementation; existing tests remain green.

- [ ] **Step 3: Implement only the minimal validator changes required by the failing tests**

  Keep AI as the semantic recognizer. Deterministic code may verify or narrow source coordinates but must not invent SKU values, channels, dates or coupon facts.

- [ ] **Step 4: Add activity-copy negative cases**

  Assert rejection of placeholder names, missing tiers, unknown fact IDs, forbidden facts and malformed background structure.

- [ ] **Step 5: Run Task 1 tests**

  Run: `pnpm exec vitest run server/lib/coupon-oa/three-source/ai-recognition.test.ts server/lib/coupon-oa/three-source/activity-copy.test.ts`

  Expected: PASS with no network access.

### Task 2: Complete control-plane integration and idempotency tests

**Files:**
- Modify: `server/lib/control-plane/coupon-ai-recognition-effect.test.ts`
- Test: `server/lib/control-plane/coupon-ai-recognition-effect.test.ts`

**Interfaces:**
- Consumes: `createCouponAiRecognitionEffectHandler(...)`, fake recognition/activity-copy gateways and in-memory repository doubles.
- Produces: I01–I04 proof that recognition, activity copy, persistence and projection preserve one-call semantics.

- [ ] **Step 1: Add a failing terminal-run retry test**

  Arrange an already-succeeded run, retry the same durable effect, and assert both AI gateways are called zero additional times while projection runs once.

- [ ] **Step 2: Add multi-channel/date normalization assertions**

  Return `京东商城` and `拍拍二手` from distinct evidence cells plus ISO start/end values. Assert activity-copy facts contain `京东商城、拍拍二手` and `2026-09-30至2026-10-10`.

- [ ] **Step 3: Add failure-classification tests**

  Cover activity-copy timeout and invalid proposal. Assert the workbook recognition result remains available, activity copy is absent, and audit exposes a stable failure code without leaking response data.

- [ ] **Step 4: Run Task 2 tests**

  Run: `pnpm exec vitest run server/lib/control-plane/coupon-ai-recognition-effect.test.ts`

  Expected: PASS; fake gateways only, no network.

### Task 3: Add an opt-in redacted local DeepSeek preflight

**Files:**
- Create: `server/lib/control-plane/coupon-ai-local-preflight.live.test.ts`
- Modify: `package.json`
- Test: `server/lib/control-plane/coupon-ai-local-preflight.live.test.ts`

**Interfaces:**
- Consumes: environment variables `COUPON_PREFLIGHT_COUPON_PATH`, `COUPON_PREFLIGHT_WHITELIST_PATH`, `RUN_COUPON_AI_LIVE_PREFLIGHT=true`, existing `DEEPSEEK_API_KEY`, production serializer, DeepSeek gateways and effect handler.
- Produces: command `pnpm test:coupon-three-source:ai-preflight` and a redacted pass/fail report for L01–L03.

- [ ] **Step 1: Write the skipped-by-default live test**

  Use `it.skipIf(process.env.RUN_COUPON_AI_LIVE_PREFLIGHT !== "true")`. When enabled, require both explicit absolute file paths, read only those files, and never enumerate directories.

- [ ] **Step 2: Bind the real production path without Feishu adapters**

  Run the coupon workbook through `createCouponAiRecognitionEffectHandler` with the official DeepSeek gateways and an in-memory repository/projector. Run the whitelist through the same serializer, gateway and validator. Do not instantiate Feishu, Base, Drive, object-store or OA clients.

- [ ] **Step 3: Add exact assertions for the supplied test pair**

  Assert coupon recognition succeeds, dedicated activity copy succeeds, 8 coupon rows collapse to the four displays `满100减1`、`满2000减20`、`满3000减30`、`满3000减60`, channels include `京东商城` and `拍拍二手`, and the copy covers all four tiers. Assert four whitelist candidates and exact regions `A2:A1167`, `A2:A252`, `A2:A121`, `A2:A88`.

- [ ] **Step 4: Emit only a redacted summary**

  Print basename, Sheet names, coordinate ranges, counts, activity copy, prompt/audit status and issues. Do not print source cell values, SKU identifiers, full proposals, prompts, responses, hashes, secrets or employee identifiers.

- [ ] **Step 5: Add the explicit package script**

  Add `test:coupon-three-source:ai-preflight` that only invokes the live test. The test remains skipped unless the explicit environment switch is true.

- [ ] **Step 6: Run the supplied files**

  Run with:

  ```bash
  RUN_COUPON_AI_LIVE_PREFLIGHT=true \
  COUPON_PREFLIGHT_COUPON_PATH='/Users/jacob/Desktop/配券型号表9.30-10.10.xlsx' \
  COUPON_PREFLIGHT_WHITELIST_PATH='/Users/jacob/Desktop/商品明细白名单9.30-10.10.xlsx' \
  pnpm test:coupon-three-source:ai-preflight
  ```

  Expected: L01–L03 PASS; no Feishu message, Base/Drive write, generated attachment or OA effect.

### Task 4: Record and enforce the pre-Feishu Gate

**Files:**
- Create: `docs/oa-ticket-reimbursement-materials/records/2026-10-12-coupon-three-source-local-ai-preflight.md`
- Modify: `docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md`

**Interfaces:**
- Consumes: Task 1–3 command results and redacted audit output.
- Produces: G01 go/no-go evidence and a reusable operator checklist.

- [ ] **Step 1: Write the evidence record**

  Record commit/revision if available, prompt versions, commands, pass counts, workbook basenames, redacted recognition summary, known inferred-year caveat, and confirmation that no Feishu/Base/Drive/OA client ran.

- [ ] **Step 2: Add the runbook Gate**

  Require all of the following before starting the bridge or asking the user to test in Feishu: focused unit/integration tests pass; live preflight passes; `pnpm typecheck` passes; `pnpm build` passes; scoped Biome check passes; `git diff --check` passes; native OA and generation effects remain disabled.

- [ ] **Step 3: Run final verification**

  Run: `pnpm exec vitest run server/lib/coupon-oa/three-source/ai-recognition.test.ts server/lib/coupon-oa/three-source/activity-copy.test.ts server/lib/control-plane/coupon-ai-recognition-effect.test.ts`

  Run: `pnpm typecheck`

  Run: `pnpm build`

  Run: `pnpm exec biome check <changed TypeScript files>`

  Run: `git diff --check`

  Expected: all commands PASS. Repository-wide `pnpm lint` may only be reported separately if an unrelated nested worktree configuration blocks it; that blocker must not be hidden.

- [ ] **Step 4: Stop at the Feishu boundary**

  Report either `LOCAL_PREFLIGHT_PASS` or `LOCAL_PREFLIGHT_BLOCKED` with exact failed assertions. Do not deploy, start the bridge or send Feishu messages in this plan.

