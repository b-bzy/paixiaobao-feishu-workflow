# 三源商家 ID 名单支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **⚠️ 整合裁定（2026-10-16）：本计划不得单独执行。** 与「模版缺项提醒」方案（2026-10-16 事故修复）存在 PRD 版本号、`cards.ts`/`dispatcher.ts`、rule version 升版时机冲突，已并入[整合实施计划](2026-10-16-coupon-three-source-gap-reminder-and-merchant-id-integrated.md)作为其阶段二执行。两处修订：PRD 版本号顺延为 **v1.7**（v1.6 由缺口提醒方案占用）；`recognition.ts` 行号引用改符号定位（原 :1106/:1286 已漂移）。冲突裁定与阶段门禁以整合计划为准。

**Goal:** 无表头单列数字名单（如文件名「商家ID」）由 DeepSeek 封闭集判定 SKU/商家ID，owner 双选项确认后按确认维度生成忠实冻结产物与「限商家ID」配券表。

**Architecture:** 识别层只改 AI 提示词合同（v7），owner 确认门泛化为双选项并把确认维度贯穿解析与生成；产物引擎维度化（表头/文件名/模板 id），配券表「限品类型」按确认维度写入。无新副作用面。

**Tech Stack:** Nitro + TypeScript、zod、ExcelJS、Vitest（现有栈，零新依赖）。

**Spec:** `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-three-source-merchant-id-whitelist-design-v1.md`

## Global Constraints

- AI 只提候选：无表头来源的名单**无论 AI 判定结果**都必须 owner 显式确认（双选项 + ≥2 字依据）。
- AI 不改写任何单元格值；名单值全部由服务端逐格重读校验（数字、无公式前缀、无分隔符、去重、空标记）。
- 白黑名单维度不一致必须硬阻断；单券 legacy 路径对商家 ID 显式报「暂不支持」。
- P1-1 隔离：`server/lib/feishu/coupon-oa/excel-pilot-schema.ts` 与 `excel-pilot-service.ts` 不改。
- `threeSourceRuleVersion` 升为 `"three-source-offline-v2"`；AI prompt 版本升为 `"coupon-three-source-p0-ai-primary-v7"`。
- draft-only、native kill switch、附件 Gate、事件入口、控制面全部不动；源文件不进 OA 附件。
- 代码风格遵 `biome.json`；禁 `any`/`@ts-ignore`；类型导入用 `import type`。

## Review Focus

1. **AI 判 SKU 的无表头名单静默放行** → 卡片仍出双选项确认（Task 3 测试 `mapping card requires dimension choice even when AI says SKU for headerless list`）。
2. **AI 越集返回 SPU/UNKNOWN 或坐标伪造** → 候选被拒/降级，卡片走人工双选项，不阻断不伪造（Task 3 卡片测试 + Task 4 gate 测试）。
3. **白黑名单维度混用**（白=商家ID，黑=SKU）→ 明确阻断文案（Task 5 测试）。
4. **商家 ID 值校验回归**：公式前缀、分隔符、重复、空标记仍逐格拒绝（Task 4 测试）。
5. **旧 revision 确认记录（`confirmedAs:"SKU"` 旧语义/`confirmAsSku` 旧键）** → 升版后失效 fail closed，不留半兼容分支（Task 3、Task 6 grep 验证）。

---

### Task 1: 文档基线（ADR-0014 + PRD v1.6 + runbook + rollout）

**Files:**
- Create: `docs/adr/0014-merchant-id-whitelist-closed-set-dimension-recognition.md`
- Create: `docs/oa-ticket-reimbursement-materials/current/product/coupon-oa-mvp-prd-v1.6.md`（以 v1.5 为底本）
- Move: `git mv docs/oa-ticket-reimbursement-materials/current/product/coupon-oa-mvp-prd-v1.5.md docs/oa-ticket-reimbursement-materials/history/product/`
- Modify: `docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md:159-162`
- Modify: `docs/oa-ticket-reimbursement-materials/current/operations/coupon-oa-internal-pilot-rollout-plan-v1.md`（变更记录节）

**Interfaces:** 无代码接口；产出后续任务的产品依据。

- [ ] **Step 1: 写 ADR-0014**

结构对齐 ADR-0011：背景（商家ID 无表头真实案例）→ 决策（封闭集判定 SKU|MERCHANT_ID、owner 双选项确认门、忠实产物「限商家ID」、rule v2 升版失效）→ Gate 与失败处理（越集/失败降级人工选择；AI 无值改写权）→ 范围外（SPU、P1-1、native）→ 后果与回滚（R3 一处常量回滚）。状态：「已接受；待 P0 外部验证，不构成生产或原生 OA 授权」。

- [ ] **Step 2: PRD v1.5 → v1.6**

底本复制 v1.5，仅改识别段落（v1.5 第 70 行所在段）中：「无表头单列数字不能仅凭文件名或数值确定标识维度；……由 owner 确认原值实际按 SKU 使用及填写依据」替换为设计文档 §3.1–3.2 的规则原文（封闭集判定 + 无表头一律双选项确认 + 判定依据展示）。版本号与变更记录同步更新；`git mv` 旧版入 `history/product/`。

- [ ] **Step 3: runbook 与 rollout 同步**

runbook §4 第 161 行段改为：「无表头单列数字由 AI 封闭集判定 SKU 或商家 ID 并展示依据；owner 从双选项确认实际类型后按确认维度生成，商家 ID 名单产物表头为 `商家id`，配券表限品类型为「限商家ID」。系统不改写任何值。」rollout 计划追加变更记录：`three-source-offline-v2` 升版使在途草稿失效需重传。

- [ ] **Step 4: 链接与边界校验**

Run: `grep -rn "coupon-oa-mvp-prd-v1.5" docs/ README.md` → 逐个更新指向 v1.6（history 内部互引除外）。
Run: `pnpm exec vitest run docs`（若仓库无 docs 测试则跳过，改为人工核对链接）。
Expected: 无断链；`git status` 仅含上述文档。

- [ ] **Step 5: Commit**

```bash
git add docs/adr/0014-*.md docs/oa-ticket-reimbursement-materials/
git commit -m "docs(coupon-three-source): add merchant-id whitelist design baseline (ADR-0014, PRD v1.6)"
```

---

### Task 2: AI 合同 v7（封闭集判定提示词）

**Files:**
- Modify: `server/lib/coupon-oa/three-source/ai-recognition.ts:25-26`（版本常量）、`:1024-1026`（system prompt 三行）
- Test: `server/lib/coupon-oa/three-source/ai-recognition.test.ts`

**Interfaces:**
- Produces: `couponThreeSourceAiPromptVersion === "coupon-three-source-p0-ai-primary-v7"`（Task 3 卡片、Task 5 e2e 断言引用）。

- [ ] **Step 1: 写失败测试**

在 `ai-recognition.test.ts` 新增：
`prompt v7 requires closed-set dimension judgment for headerless numeric lists`：断言 `buildCouponThreeSourceAiRequest(...).system` 包含「SKU 或 MERCHANT_ID」封闭集指令、包含「reason 必须引用可核验证据」、**不再包含**「dimension 必须返回 UNKNOWN」与「不得因文件名含‘商家ID’」旧禁令；并断言 `promptVersion` 为 v7。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run server/lib/coupon-oa/three-source/ai-recognition.test.ts`
Expected: FAIL（仍为 v6 文案）。

- [ ] **Step 3: 实现**

版本常量改 `"coupon-three-source-p0-ai-primary-v7"`；将第 1024–1026 行三条 system 规则替换为：
1. 「材料角色（whitelist/blacklist）与标识维度是两个独立判断，不得混淆。」（保留）
2. 「文件名只可作为低权重角色与维度线索：含‘白名单/黑名单’提示角色，含‘商家ID’提示维度；工作簿内容证据优先，文件名不得单独决定判定。」
3. 「无表头单列数字名单必须做意图判定，dimension 只能返回 SKU 或 MERCHANT_ID；reason 必须引用可核验证据（数值位数与格式模式、Sheet 名、文件名标注、活动上下文）。headerCell 使用该列第一个真实数据单元格作为区域锚点，startCell 与 headerCell 相同。」
schema 与坐标校验不动。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run server/lib/coupon-oa/three-source/ai-recognition.test.ts`
Expected: PASS（含既有全部用例）。

- [ ] **Step 5: Commit** `git commit -m "feat(coupon-three-source): closed-set dimension judgment in AI prompt v7"`

---

### Task 3: 确认语义泛化（types/store/dispatcher/cards）

**Files:**
- Modify: `server/lib/coupon-oa/three-source/types.ts:10`（rule version）
- Modify: `server/lib/feishu/coupon-oa/three-source/store.ts:77-86`（selections 类型）
- Modify: `server/lib/feishu/coupon-oa/three-source/dispatcher.ts:402-434`（表单解析）
- Modify: `server/lib/feishu/coupon-oa/three-source/cards.ts:538-550`（触发判定）、`:968-995`、`:1006-1033`（白/黑名单确认 UI）
- Test: `server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts`、`cards.test.ts`

**Interfaces:**
- Produces: `IdentifierDimensionChoice = { detected: "SKU" | "MERCHANT_ID" | "UNKNOWN"; requiresChoice: boolean }`，由 `cards.ts` **导出**函数 `identifierDimensionChoice(recognition: StoredWorkbookRecognition | undefined): IdentifierDimensionChoice | undefined` 计算（`detected` 优先确定性候选，其次 AI region；`requiresChoice = 存在 header === "" 的 identifier 候选 || detected !== "SKU"`）。`dispatcher.ts` 复用同一函数取 `detected`，规则单一来源，禁止两处各写一份。
- Produces: selections 类型 `confirmedAs: "SKU" | "MERCHANT_ID"`、`detectedDimension: "SKU" | "SPU" | "MERCHANT_ID" | "UNKNOWN"`（Task 4/5 消费）。
- Produces: 表单键 `whitelist_identifierDimension` / `blacklist_identifierDimension`（值 `SKU` | `MERCHANT_ID`）+ `*_dimensionReason`。

- [ ] **Step 1: 写失败测试（dispatcher）**

`dispatcher.test.ts` 新增：
`parses identifier dimension confirmation with merchant option`：表单含 `whitelist_identifierDimension="MERCHANT_ID"`、`whitelist_dimensionReason="文件名与位数"` → selections 得 `confirmedAs:"MERCHANT_ID"`；
`rejects missing reason for dimension confirmation`：理由 1 字 → 抛「请填写确认依据（至少 2 个字）」；
`no confirmation recorded when identifier has sku header`：有表头 SKU 列 → 无确认条目。

- [ ] **Step 2: 写失败测试（cards）**

`cards.test.ts` 新增：
`mapping card requires dimension choice even when AI says SKU for headerless list`：headerless 候选（`header:""`）+ AI region `dimension:"SKU"` → 卡片仍含双选项 select_static（`商家 ID` / `SKU` 两 option）与理由输入；
`mapping card shows AI merchant judgment with evidence`：AI region `dimension:"MERCHANT_ID"`、reason 含「文件名标注」→ markdown 含「系统判定该名单为【商家 ID】」与依据文案；
`mapping card omits dimension choice for headed sku column`：不出现选择器；
`headed spu column still requires explicit confirmation`：有表头 SPU 列（`detected:"SPU"` 经映射归一为非 SKU）→ 卡片仍出双选项确认门（审计 A4 回归：任何非 SKU 识别结果都不得静默放行）。

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm exec vitest run server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts server/lib/feishu/coupon-oa/three-source/cards.test.ts`
Expected: FAIL。

- [ ] **Step 4: 实现**

`types.ts`：`threeSourceRuleVersion = "three-source-offline-v2"`。
`store.ts`：按 Interfaces 放宽两字段类型。
`dispatcher.ts`：`detectedDimension` 改为复用 `cards.ts` 导出的 `identifierDimensionChoice(recognition).detected`（规则单一来源）；表单键换为 `*_identifierDimension`，值必须是 `SKU`/`MERCHANT_ID`，否则抛「标识类型请从商家 ID 或 SKU 中选择」；删除 `confirmAsSku` 旧键解析。
`cards.ts`：以导出的 `identifierDimensionChoice` 替换 `unresolvedIdentifierDimension`；白/黑两段 UI 换为统一文案（设计文档 §3.2 原文），select_static 两个 option（`商家 ID`→`MERCHANT_ID`、`SKU`→`SKU`）。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run server/lib/feishu/coupon-oa/three-source/`
Expected: PASS（含 store/service 等受 rule version 影响用例——如有快照断言旧版本号，同步更新断言值，不改语义）。

- [ ] **Step 6: Commit** `git commit -m "feat(coupon-three-source): two-option identifier dimension confirmation"`

---

### Task 4: 解析层维度泛化（lists.ts，pilot 与离线切片同语义）

**Files:**
- Modify: `server/lib/coupon-oa/three-source/lists.ts:288-507`（`parseMultiSheetTieredIdentifierList`，pilot 路径）
- Modify: `server/lib/coupon-oa/three-source/lists.ts:155-194`（`parseTieredIdentifierList`，离线单 Sheet 切片；`offline.test.ts` 主要测试载体，须同语义泛化，否则 Task 4/5 的商家流离线测试会被旧 guard 卡死）
- Modify: `server/lib/coupon-oa/three-source/lists.ts:538-545`（`parseSingleCouponIdentifierList` 单券 legacy 显式拒绝）
- Test: `server/lib/coupon-oa/three-source/offline.test.ts`

**Interfaces:**
- Consumes: Task 3 的确认类型（`confirmedAs: "SKU" | "MERCHANT_ID"`、`detectedDimension` 含 `"SPU"`）与共享的 `identifierDimensionChoice` 语义。
- Produces: **确认有效性判定**（单一 helper，两个 parse 函数共用）：`confirmation 有效 ⟺ sourceSha256 匹配 && confirmation.detectedDimension ∈ { 实际识别维度, "UNKNOWN" } && confirmedAs ∈ { "SKU", "MERCHANT_ID" } && reason.trim().length ≥ 2`。有效确认时**解析维度 = confirmedAs**——允许把检测到的 MERCHANT_ID 推翻按 SKU 使用，也允许反向；无有效确认且识别维度 ≠ SKU 时 push issue 阻断（文案「当前只支持 SKU 或商家 ID 名单，请先确认标识类型」）。
- Produces: `parseMultiSheetTieredIdentifierList` 与 `parseTieredIdentifierList` 返回值 `dimension` 均为**确认后维度**（无确认时为识别维度）；`groupIdentifiersByTier` 接受 `SKU | MERCHANT_ID`。

- [ ] **Step 1: 写失败测试（offline.test.ts）**

新增（沿用该文件既有 fixture 构造方式，两个 parse 函数各覆盖）：
`parses headerless merchant list after owner confirms merchant id`：确认 `confirmedAs:"MERCHANT_ID"` → entries 逐格原值、`dimension:"MERCHANT_ID"`；
`owner may override detected merchant id back to sku`：检测 MERCHANT_ID + `confirmedAs:"SKU"` → `dimension:"SKU"`（推翻路径，审计修正点）；
`rejects merchant list without confirmation`：issues 含「请先确认标识类型」；
`ai region with out-of-set dimension stays blocked until manual confirmation`：AI region `dimension:"SPU"` 无确认 → issue；有 `detectedDimension:"SPU"、confirmedAs:"SKU"` 的有效确认 → 按 SKU 解析（越集降级路径）；
`still rejects formula separator and duplicate merchant ids`：公式前缀/分隔符/重复值逐格拒绝（回归）；
`offline single-sheet slice parses merchant dimension with confirmation`：`parseTieredIdentifierList` 同语义；
`single coupon path rejects merchant dimension explicitly`：`parseSingleCouponIdentifierList` 对 `MERCHANT_ID` 抛「暂不支持商家 ID 名单」。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run server/lib/coupon-oa/three-source/offline.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

在 `lists.ts` 顶部新增确认有效性 helper（Interfaces 中的定义），`parseMultiSheetTieredIdentifierList` 的两处 gate（`:339` AI region、`:450` 确定性列）与 `parseTieredIdentifierList` 的 `:190-194` guard 全部改为消费该 helper；三处返回 `dimension` 改为确认后维度。`:540` 单券 guard 改为显式「暂不支持商家 ID 名单」错误。`groupIdentifiersByTier` 维度断言放宽。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run server/lib/coupon-oa/three-source/offline.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit** `git commit -m "feat(coupon-three-source): dimension-aware list parsing with owner override"`

---

### Task 5: 产物与配券表维度化（引擎 + workflow + schema）

**Files:**
- Modify: `server/lib/excel-template-engine/dynamic-sku-list.ts`（dimension 参数、表头/文件名/错误文案、verify）
- Modify: `server/lib/coupon-oa/three-source/workflow.ts:44-57`（`assertListIsUsable`）、`:313-352`（产物生成与模板 id）
- Modify: `server/lib/coupon-oa/calculation.ts:36`（productLimitType 枚举）
- Modify: `server/lib/coupon-oa/three-source/recognition.ts:1106`、`:1286`（safeParse 输入参数化）
- Test: `server/lib/excel-template-engine/index.test.ts`、`server/lib/coupon-oa/three-source/offline.test.ts`

**Interfaces:**
- Produces: `generateDynamicSkuListWorkbook(input: { tiers; activityName; revision; role; dimension: "SKU" | "MERCHANT_ID" })`；表头映射 `{ SKU: "sku", MERCHANT_ID: "商家id" }`；文件名前缀 `{ SKU: 商品明细白名单/黑名单, MERCHANT_ID: 商家ID白名单/黑名单 }`；模板 id `coupon-dynamic-merchant-{whitelist|blacklist}-v1`（SKU id 不变）。
- Produces: `regularFullReductionInputSchema` 的 `productLimitType: z.enum(["限SKU", "限商家ID"]).default("限SKU")`。
- Consumes: Task 4 的解析返回 `dimension`。

- [ ] **Step 1: 写失败测试（引擎）**

`index.test.ts` 新增：`generates merchant whitelist workbook with merchant header and filename`：A1 为 `商家id`、文件名前缀「商家ID白名单」、回读 verify 通过、值仍为文本格式 `@`；`verification rejects sku header for merchant dimension`：dimension MERCHANT_ID 时 A1=`sku` 抛错。

- [ ] **Step 2: 写失败测试（offline.test.ts）**

`merchant flow produces faithful artifacts and limit type`：确认商家 ID 后走 `createCanonicalPackage` + `generateOfflineArtifacts` → 白名单产物 A1=`商家id`、模板 id `coupon-dynamic-merchant-whitelist-v1`、配券表 Y 列为「限商家ID」；
`dimension mismatch between whitelist and blacklist is blocked`：白 MERCHANT_ID + 黑 SKU → 抛「白黑名单 ID 维度不一致」。

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm exec vitest run server/lib/excel-template-engine/index.test.ts server/lib/coupon-oa/three-source/offline.test.ts`
Expected: FAIL。

- [ ] **Step 4: 实现**

引擎按 Interfaces 加 `dimension`；`assertRows` 错误文案「SKU 必须是一格一个的安全文本」按维度替换为「名单 ID」。`workflow.ts`：`assertListIsUsable` 接受两维度；白黑维度一致性交给 `computeOverlap` 既有校验；产物生成传 `dimension` 并按维度选模板 id。`calculation.ts` 放宽枚举。`recognition.ts` 两处 safeParse 输入 `productLimitType` 改为由新可选参数 `productLimitType?: "限SKU" | "限商家ID"` 注入（默认 `"限SKU"`）。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run server/lib/excel-template-engine/ server/lib/coupon-oa/`
Expected: PASS。

- [ ] **Step 6: Commit** `git commit -m "feat(coupon-three-source): dimension-aware frozen artifacts and product limit type"`

---

### Task 6: service 集成、e2e 用例与全量验证

**Files:**
- Modify: `server/lib/feishu/coupon-oa/three-source/service.ts:736-775`（productLimitType 注入）
- Modify: `server/lib/coupon-oa/three-source/e2e/case-catalog.ts`、`e2e/workbook-fixture-builder.ts`、`e2e/artifact-assertions.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/service.test.ts`、e2e runner

**Interfaces:**
- Consumes: Task 5 的 `productLimitType` 参数、Task 3 的 selections。
- Produces: e2e 新用例 `merchant-id-headerless-whitelist`（fixture：无表头单列数字 + 文件名含「商家ID」）。

- [ ] **Step 1: 写失败测试（service）**

`service.test.ts` 新增：`generation honors merchant dimension confirmation`：selections 含 `identifierDimensionConfirmations.whitelist.confirmedAs="MERCHANT_ID"` → `confirmRegularFullReductionCouponSet` 收到 `productLimitType:"限商家ID"`，产物校验同 Task 5；
`missing confirmation blocks generation with actionable message`：未确认 → validationIssues 含「标识类型」字样（来自解析 issue 链「白名单存在未解决的数据问题：…请先确认标识类型」，断言匹配实际链路文案而非杜撰短句）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run server/lib/feishu/coupon-oa/three-source/service.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

`service.ts`：在 `:736` 调用前计算 `const whitelistLimitType = input.draft.selections.identifierDimensionConfirmations?.whitelist?.confirmedAs === "MERCHANT_ID" ? "限商家ID" as const : "限SKU" as const;` 传入 couponSet 确认；名单解析调用不变（Task 4 已泛化）。e2e：fixture builder 加无表头数字列工厂；case-catalog 注册用例；artifact-assertions 增加 dimension 感知断言（A1、文件名、模板 id、Y 列）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run server/lib/feishu/coupon-oa/three-source/service.test.ts` 及 e2e 相关 runner
Expected: PASS。

- [ ] **Step 5: 全量验证与残留检查**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:coupon-three-source:offline && pnpm build`
Expected: 全绿。
Run: `grep -rn "confirmAsSku" server/` → 0 命中；`grep -rn "限SKU" server/lib/feishu/coupon-oa/excel-pilot-schema.ts server/lib/feishu/coupon-oa/excel-pilot-service.ts` → 原样保留（P1-1 隔离验证）。
Expected: 满足上述两条件。

- [ ] **Step 6: Commit** `git commit -m "feat(coupon-three-source): wire merchant dimension through pilot service and e2e"`

---

## 范围外与后续（不属本计划步骤）

- **真飞试点重放**：合入后按 runbook §4（Task 1 已更新段落）重放「商家ID」无表头文件 E2E；部署走 `p0-preview-deploy` skill，pilot flag 仍按既有开关纪律开合。
- **「限商家ID」官方枚举确认**（设计文档 R3）：由产品侧与审批 Owner 确认；若被拒，回滚为常量「限SKU」+ 名单降级参考件属产品决定，不在本计划内。
- SPU 名单生成、P1-1 路线、native submit、附件 Gate 一律不动。
