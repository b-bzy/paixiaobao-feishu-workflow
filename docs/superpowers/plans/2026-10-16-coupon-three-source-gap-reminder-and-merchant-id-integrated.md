# 三源「模版缺项提醒 + 商家 ID 白名单」整合实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一条执行线先后落地方案 B（第二轮表单模版缺项提醒与 11310 事故三缺陷修复）与方案 A（商家 ID 名单封闭集判定与维度化产物），消除两方案在 PRD 版本号、`cards.ts`/`dispatcher.ts`、rule version 升版时机上的冲突。

**来源方案（均待评审，本计划同样是评审对象，未获批不执行）：**

- 方案 A：[商家 ID 名单设计 v1](../../oa-ticket-reimbursement-materials/proposals/three-source/coupon-three-source-merchant-id-whitelist-design-v1.md) + [原实施计划](2026-10-16-coupon-three-source-merchant-id-whitelist.md)（6 task）
- 方案 B：[模版缺项提醒设计 v1](../../oa-ticket-reimbursement-materials/proposals/three-source/coupon-three-source-template-gap-reminder-design-v1.md)（尚无实施计划，本计划阶段一即其实施计划）

**整合动机：** 两方案同日产出、同轮合入，在 4 处真实相遇（见 §0.1）；B 设计 §8 已预留「版本号顺延协调」，本计划把协调结果与全部冲突裁定固化成单一执行顺序，任何子任务不得单独抢跑。

## 0. 冲突消解（整合核心，先读再动工）

### 0.1 冲突矩阵与裁定

| # | 冲突资源 | 方案 A 的主张 | 方案 B 的主张 | 裁定 |
| --- | --- | --- | --- | --- |
| C1 | PRD 版本号 | Task 1 把 v1.5 升 v1.6（改识别段落） | §8 把 v1.5 升 v1.6（加表单条件必填与降级消息说明） | **B 取 v1.6，A 顺延 v1.7**。两次独立 bump、两次 `git mv` 入 `history/product/`；`current/` 每一刻只描述已合入行为，不出现「PRD 宣称但代码未上线」的窗口 |
| C2 | `cards.ts` | Task 3 改确认 UI（`unresolvedIdentifierDimension` 现位于 :538 附近、白黑确认块 :968–1033） | 改动 1 改渲染区（`fieldsForOwnerReview` :588/:900、可选补充区过滤 :940） | **阶段隔离：B 先改、A 后改**。A 的卡片任务（A3）开工时以 B 合入后的文件为基底；A 不得回退 B 的「排除已渲染 key」过滤；A 新增组件必须过 B5 的唯一性门禁 |
| C3 | `dispatcher.ts` | Task 3 改表单解析（:402–434，删 `confirmAsSku` 旧键） | 改动 2/3 改 `assertMappingFormReady`（:473 附近）与 `restoreMappingFormAfterFailure`（:572 附近，末尾 `.catch(() => undefined)` 在 :595–597） | 不同函数、零文本重叠。**A3 删旧键时不得触碰这两个函数**；B 的预检函数在 A3 之后语义不变 |
| C4 | `recognition.ts` | Task 5 的 safeParse 输入参数化：原计划写 :1106/:1286，**已漂移到 :1160/:1352** | 不直接改动 | 计划内一律**按符号定位**（`grep -n 'productLimitType: "限SKU"' server/lib/coupon-oa/three-source/recognition.ts`），不写死行号；漂移原因见 §0.3 |
| C5 | `calculation.ts` | Task 5 放宽 :36 的 `productLimitType` 枚举 | 改动 2 只读引用 :81–90 的公开渠道规则，判定函数如需共享从领域层导出 | 无冲突。B3 若新增导出 helper，放在导出区，不碰 :36；`excel-pilot-schema.ts:37` 的同款 `z.literal("限SKU")` 属 P1-1，**两方案都不改**（A Task 6 grep 验证保留） |
| C6 | rule version | 升 `three-source-offline-v1` → `v2`，在途草稿识别候选与确认快照全部失效（fail closed） | §6 承诺死局草稿 `CTS-b5f7cd48` 部署后重发口令**复用识别、零损失恢复** | **顺序硬约束：A 的 v2 bump 必须晚于 B 修复部署且用户已恢复死局草稿**。若 A 先升版，B 的解锁承诺作废（该草稿识别快照被 v2 判失效）。此约束是「阶段一 → 阶段门禁 → 阶段二」的根本原因 |
| C7 | 新增卡片组件 | 新增 `whitelist_identifierDimension` / `blacklist_identifierDimension` select_static + `*_dimensionReason` input | 改动 4 建立全卡表单组件 `name` 唯一性 walker 门禁 | B5 门禁先行存在，成为 A 新组件的自动防线。前缀天然不撞（`owner_*` vs `whitelist_*`/`blacklist_*`），但由门禁强制验证而非靠约定 |
| C8 | 测试文件 | offline / cards / dispatcher / service / e2e 增用例 | 同批测试文件 + `cards-schema.test.ts` | 追加式无冲突；两阶段各自跑全量命令，最终门禁合并（见阶段二 Task A6 修订） |

### 0.2 执行顺序与理由

**阶段一（方案 B，可靠性修复，PRD v1.6）→ 阶段门禁（§4）→ 阶段二（方案 A，功能扩展，PRD v1.7 + rule v2）。**

理由按重要性：

1. C6 硬约束：B 的死局草稿恢复承诺只在 A 升版前有效；
2. 事故修复优先于功能扩展（11310 死卡 + 静默失败是当前试点可用性问题）；
3. B5 唯一性门禁与 B2 渲染结构是 A 卡片改动的基底，先稳定基底再叠加；
4. A 升 rule v2 后任何确认失败都会走 B 修好的恢复链与降级兜底，v2 的 fail-closed 体验更安全。

### 0.3 并行未提交工作协调（不属于本计划，但必须协调）

当前 working tree 有一批**未提交**改动（用户自有工作线，2026-10-16 16:14 核实 `recognition.test.ts` 30/30 全绿）：`recognition.ts` / `recognition.test.ts` 的枚举报错中文化与溯源管道（`allowGift=是` 同类问题，即 B 设计 §7「另行立项」项）。改动地理（已核对 diff）：

- 报错层：`RegularFieldSourceHint` / `regularFieldOriginClause` / `describeRegularFieldIssues`（:599–715 区域，含吞掉 zod 英文默认文案的尾部分支）；
- 管道层：`confirmRegularFullReductionCoupon` 与 `extractRegularFullReductionInput` 内收集 `fieldHeaders`，并在两处 `safeParse` 失败块（`if (!parsed.success)`，紧邻 :1160 与 :1352 的 `productLimitType: "限SKU"` 输入行）把溯源作为第三参数传入 `throwRegularFieldIssues`。

裁定：

- 该工作**不纳入本计划**，也不得被本计划的提交夹带（AGENTS：保留并尊重未提交修改）；
- 与 A Task 5 **同文件、同两个函数、相邻语句、零行级重叠**（A5 改输入对象里的 `productLimitType` 行，本批改其后紧邻的失败处理块）——可共存但紧贴，未落库状态下叠加编辑极易 `git add` 夹带；它也是 C4 行号漂移的来源；
- **建议在阶段一开工前单独提交**（该批自带测试且当前全绿）：阶段一 B6 的全量验证会连带 lint/typecheck/test/build 这批未提交代码，在途半成品会污染阶段门禁信号；
- **阶段二开工硬前置**：该工作已提交落库，`git status` 对 `server/lib/coupon-oa/three-source/recognition*.ts` 干净；
- 正向联动（非冲突）：A5 把 `productLimitType` 从 `z.literal` 放宽为 `z.enum` 后，非法值失败码从 `invalid_literal` 变为 `invalid_value`，会自然走进本批新增的中文枚举报错分支（文案自动列出「限SKU」或「限商家ID」）——两者互补；若后续有测试断言旧报错文案，随 A5 同步更新断言而非改回实现。

## Global Constraints（两方案合并）

- draft-only、native kill switch、附件 Gate、事件入口、控制面全部不动；源文件不进 OA 附件。
- P1-1 隔离：`server/lib/feishu/coupon-oa/excel-pilot-schema.ts` 与 `excel-pilot-service.ts` 不改。
- AI 只提候选；无表头名单无论 AI 判定结果都必须 owner 双选项显式确认；AI 不改写任何单元格值；名单值全部由服务端逐格重读校验。
- 白黑名单维度不一致硬阻断；单券 legacy 路径对商家 ID 显式报「暂不支持」。
- 版本常量归属：阶段二才升 `threeSourceRuleVersion = "three-source-offline-v2"` 与 AI prompt `"coupon-three-source-p0-ai-primary-v7"`；阶段一不碰任何版本常量。
- 代码风格遵 `biome.json`；禁 `any` / `@ts-ignore` / `@ts-expect-error`；类型导入用 `import type`；零新依赖。
- 测试数据与 fixture 必须脱敏：真实活动名、金额、open_id、sourceHash 一律替换为合成值；真实材料只放 Git 忽略的 `cases/`、`drafts/`、`.local/`。
- 每个任务一个 Conventional Commit；不自行 push / 建 PR / 部署 / 真发——部署与真发审计在阶段门禁处单独申请授权。

## Review Focus（整合新增的审查点，原方案各自的审查点不变）

1. **阶段顺序被违反**（最严重）：A 的任何任务在阶段门禁通过前动工，或 A 的 v2 bump 早于用户死局草稿恢复 → 必须拦下。
2. **PRD 版本号写错**：阶段一产出 v1.6 却被阶段二再改成 v1.6（应产出 v1.7），或任一阶段漏 `git mv` 旧版入 `history/product/`。
3. **B 的修复被 A 回退**：A3 改卡片时删掉「可选补充区排除已渲染 key」过滤，或 A 的 dispatcher 改动波及 `assertMappingFormReady` / `restoreMappingFormAfterFailure`。
4. **唯一性门禁失守**：A 新增的维度选择组件未进 B5 walker 的卡片形态矩阵，或门禁只查新组件不查全卡。
5. **未提交枚举报错工作被夹带或覆盖**：任何阶段提交的 diff 里出现 `describeRegularFieldIssues` / `throwRegularFieldIssues` / `fieldHeaders` 相关改动即为越界。

---

## 阶段一：模版缺项提醒与 11310 修复（方案 B，PRD v1.6）

### Task B1: 文档基线（PRD v1.6 + 实施基线补节 + 排障手册）

**Files:**
- Create: `docs/oa-ticket-reimbursement-materials/current/product/coupon-oa-mvp-prd-v1.6.md`（以 v1.5 为底本）
- Move: `git mv docs/oa-ticket-reimbursement-materials/current/product/coupon-oa-mvp-prd-v1.5.md docs/oa-ticket-reimbursement-materials/history/product/`
- Modify: `docs/oa-ticket-reimbursement-materials/current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md`（新增一节）
- Modify: `.agents/skills/p0-stuck-diagnosis/SKILL.md`（常见红噪区补一条）

**Interfaces:** 无代码接口；产出阶段一后续任务的产品依据。

- [ ] **Step 1: PRD v1.5 → v1.6**

  底本复制 v1.5，新增「第二轮表单卡·模版条件必填字段」行为段（以配券表模版填写说明为对账基准：生效推广途径=公开自动推广且公开推广渠道空 → 卡片上该字段必填并提示可选项；非公开 → 不出现；无法判定 → 维持可选由服务端预检兜底）与「确认失败恢复链降级消息」段（恢复卡投递失败时必达的纯文字报错与重发口令指引）。版本号与变更记录同步；`git mv` 旧版入 `history/product/`。

- [ ] **Step 2: 实施基线补节**

  在实施基线新增「表单卡组件名唯一性门禁」小节：同一张卡内表单组件 `name` 必须全局唯一，由 `cards-schema.test.ts` 的 walker 对全部卡片形态矩阵强制（Task B5 落地）；记录 11310 事故为动机。

- [ ] **Step 3: 排障手册补条**

  `p0-stuck-diagnosis` skill 常见红噪区追加：「确认后卡在生成中 → 先查 Base `failureReason`，再真发验证恢复卡 schema（组件重名会整卡拒收）」。

- [ ] **Step 4: 链接与边界校验**

  Run: `grep -rn "coupon-oa-mvp-prd-v1.5" docs/ README.md` → 逐个更新指向 v1.6（history 内部互引除外）。
  Expected: 无断链；`git status` 仅含上述文档。

- [ ] **Step 5: Commit**

  ```bash
  git add docs/oa-ticket-reimbursement-materials/ .agents/skills/p0-stuck-diagnosis/SKILL.md
  git commit -m "docs(coupon-three-source): template gap reminder baseline (PRD v1.6, card-name uniqueness gate)"
  ```

---

### Task B2: 卡片条件必填渲染与重名消解（cards.ts）

**Files:**
- Modify: `server/lib/feishu/coupon-oa/three-source/cards.ts`（渲染区：`ownerDefaultValue` :386 取值级联的复用、`fieldsForOwnerReview` :588/:900、可选补充区过滤 :940）
- Test: `server/lib/feishu/coupon-oa/three-source/cards.test.ts`

**Interfaces:**
- Produces: 生效推广途径求值复用 `ownerDefaultValue`（cards.ts 导出或内部复用，不复制实现）；「可选补充区」过滤条件追加排除已进入 `fieldsForOwnerReview` 的 key。

- [ ] **Step 1: 写失败测试**

  `cards.test.ts` 新增：
  `public promotion channels renders required when effective mode is public and channels empty`：生效推广途径=公开自动推广且渠道空 → 组件 `required: true`、label/提示行含「全网推广、单品页购物车、领券中心、公开券池，可多选」；
  `public promotion channels hidden when effective mode is non-public`：字段不出现；
  `keeps optional rendering when promotion mode undetermined`：维持现状可选；
  `optional supplement area excludes keys already rendered in owner review`（11310 回归）：`publicPromotionChannels` 同时满足「validationIssues 命中」与「列头在但值全空」时，`owner_publicPromotionChannels` 全卡恰好出现一次。

- [ ] **Step 2: 跑测试确认失败**

  Run: `pnpm exec vitest run server/lib/feishu/coupon-oa/three-source/cards.test.ts`
  Expected: FAIL。

- [ ] **Step 3: 实现**

  按 B 设计改动 1：渲染「可选补充区」前先按 `ownerDefaultValue` 同款级联（owner 覆盖 → 文案候选 → AI 候选 → 确定性候选）求生效推广途径，三分支渲染（必填+提示 / 不渲染 / 维持可选）；过滤条件追加排除 `fieldsForOwnerReview` 已含 key。不改组件 `name`、不改其他字段渲染。

- [ ] **Step 4: 跑测试确认通过**

  Run: `pnpm exec vitest run server/lib/feishu/coupon-oa/three-source/cards.test.ts`
  Expected: PASS（含既有全部用例）。

- [ ] **Step 5: Commit** `git commit -m "fix(coupon-three-source): conditional required promotion channels and dedupe card fields"`

---

### Task B3: 服务端表单预检镜像（dispatcher.ts assertMappingFormReady）

**Files:**
- Modify: `server/lib/feishu/coupon-oa/three-source/dispatcher.ts`（`assertMappingFormReady`，现位于 :473 附近；该函数当前不含任何 promotionMode 逻辑）
- Modify: `server/lib/coupon-oa/calculation.ts`（仅当需要导出判定 helper 时新增导出，不碰 :36 的 `productLimitType`）
- Test: `server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts`

- [ ] **Step 1: 写失败测试**

  `dispatcher.test.ts` 新增：
  `precheck rejects public promotion mode without channels`：合并提交值后生效推广途径=公开自动推广且渠道空 → 抛「推广途径为「公开自动推广」时，公开推广渠道为必填（全网推广、单品页购物车、领券中心、公开券池，可多选）」；
  `precheck rejects channels filled under non-public mode`：抛「推广途径为非公开推广时，无需填写公开推广渠道」；
  `precheck passes when rules satisfied`：正常推进，无异常。

- [ ] **Step 2: 跑测试确认失败**

  Run: `pnpm exec vitest run server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts`
  Expected: FAIL。

- [ ] **Step 3: 实现**

  与「超扣原因」预检同款：合并 `draft.selections.ownerFieldValues` 与本次提交值后求生效推广途径，判定语义与 `calculation.ts:81-90` 领域规则一致；判定函数如需共享则从 `calculation.ts` 导出，单一来源，不在 dispatcher 复制实现。失败留在原卡可改，不产生 revision。

- [ ] **Step 4: 跑测试确认通过**

  Run: `pnpm exec vitest run server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts`
  Expected: PASS。

- [ ] **Step 5: Commit** `git commit -m "fix(coupon-three-source): mirror promotion-channel requirement in mapping form precheck"`

---

### Task B4: 恢复投递降级兜底（dispatcher.ts restoreMappingFormAfterFailure）

**Files:**
- Modify: `server/lib/feishu/coupon-oa/three-source/dispatcher.ts`（`restoreMappingFormAfterFailure` :572 起；末尾 `deliverMappingCard(...).catch(() => undefined)` 在 :595–597）
- Test: `server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts`

- [ ] **Step 1: 写失败测试**

  `dispatcher.test.ts` 新增：
  `falls back to plain error message when mapping card delivery fails`：`deliverMappingCard` reject → `sendCard` 依赖被调用一次，内容为纯 markdown 报错（含失败原因与「请重发 /OA优惠券提报」指引），函数不返回成功；
  `propagates when fallback send also fails`：降级 `sendCard` 也 reject → 错误如实抛出；
  `records structured failure log`：日志含 `draft_id`、`revision`、失败原因。

- [ ] **Step 2: 跑测试确认失败**

  Run: `pnpm exec vitest run server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts`
  Expected: FAIL。

- [ ] **Step 3: 实现**

  移除 `.catch(() => undefined)` 静默吞错；失败时降级 `sendCard` 纯 markdown 报错（不走表单模板，不可能触发 schema 拒收）+ 结构化日志；降级仍失败则如实抛出。日志字段遵 AGENTS 白名单（`draft_id`、`revision`、原因），不落完整事件 payload。

- [ ] **Step 4: 跑测试确认通过**

  Run: `pnpm exec vitest run server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts`
  Expected: PASS。

- [ ] **Step 5: Commit** `git commit -m "fix(coupon-three-source): guaranteed fallback when recovery card delivery fails"`

---

### Task B5: 组件名唯一性门禁与事故 fixture（cards-schema.test.ts）

**Files:**
- Modify: `server/lib/feishu/coupon-oa/three-source/cards-schema.test.ts`
- Create: 事故脱敏 fixture（以 `.local/current-stuck-draft.json`（草稿 `CTS-b5f7cd48` 导出）为底本，脱敏后随测试入库）

**Interfaces:**
- Produces: 卡片形态矩阵 → walker 遍历断言同一张卡内表单组件 `name` 全局唯一。该门禁是阶段二 A 新增组件的自动防线（C7）。

- [ ] **Step 1: 脱敏 fixture**

  从 `.local/current-stuck-draft.json` 提取恢复表单卡构建所需的最小 draft 快照，**逐项脱敏**：活动名/商家名/金额/open_id/sourceHash/文件名替换为合成值；确认脱敏产物不含任何真实业务数据后入库为测试 fixture（`__fixtures__/` 或 inline，遵 cards-schema.test.ts 既有组织方式）。

- [ ] **Step 2: 写失败测试**

  `cards-schema.test.ts` 新增：
  `form component names are unique within every card shape`：对全部卡片形态矩阵（含 rev4 恢复卡形态）walker 遍历，`name` 唯一；
  `incident draft renders public promotion channels exactly once`：fixture 构建的卡中 `owner_publicPromotionChannels` 恰出现一次、条件必填状态正确（B2 行为的回归锚点）。

- [ ] **Step 3: 跑测试确认通过（B2 已修复重名，此处门禁固化）**

  Run: `pnpm exec vitest run server/lib/feishu/coupon-oa/three-source/cards-schema.test.ts`
  Expected: 若 B2 正确则 PASS；若重名残留则 FAIL——这正是门禁价值。

- [ ] **Step 4: Commit** `git commit -m "test(coupon-three-source): card form name uniqueness gate with sanitized incident fixture"`

---

### Task B6: 阶段一全量验证

- [ ] **Step 1: 全量命令**

  Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:coupon-three-source:offline && pnpm build && pnpm audit:cards`
  Expected: 全绿（`audit:cards` 干跑即真实建卡审计，不发飞书）。

- [ ] **Step 2: 越界检查**

  Run: `git diff --name-only main...HEAD`（或对上一基线）核对本阶段只动：PRD/runbook/实施基线/skill 文档、`cards.ts`、`dispatcher.ts`、`calculation.ts`（至多导出 helper）、三个测试文件、新 fixture。
  Run: `grep -n "threeSourceRuleVersion" server/lib/coupon-oa/three-source/types.ts` → 仍为 `three-source-offline-v1`（阶段一不升版，C6）。
  Expected: 无 `recognition.ts`、无版本常量改动。

---

## 阶段门禁（阶段一 → 阶段二，逐项满足）

- [ ] 阶段一 B1–B6 全部合入且全量验证绿；
- [ ] 经用户授权：走 `p0-preview-deploy` skill 部署（bridge/worker 随新 SHA 重启），真发审计 `pnpm audit:cards -- --draft <事故草稿导出> --send --only REAL-DRAFT` 通过（飞书接受、11310 消失、自动撤回）；
- [ ] 用户重发 `/OA优惠券提报` 恢复 `CTS-b5f7cd48` 并补「公开推广渠道」走通到生成与 OA 草稿卡（C6 的恢复承诺兑现，此后才允许 rule v2 升版）；
- [ ] `server/lib/coupon-oa/three-source/recognition*.ts` 的并行未提交枚举报错工作已落库，`git status` 干净（§0.3）；
- [ ] 用户明确批准进入阶段二（方案 A 的评审通过即本门禁的前置）。

## 阶段二：商家 ID 白名单（方案 A，PRD v1.7 + rule v2）

**执行方式：按[原实施计划](2026-10-16-coupon-three-source-merchant-id-whitelist.md) Task 1–6 逐任务执行，原计划的文件清单、接口契约、测试用例、验证命令与提交信息全部有效；以下修订项逐任务覆盖原计划，冲突处以修订为准。**

### Task A1（原 Task 1: 文档基线）修订

- PRD 底本从 v1.5 改为 **v1.6**（阶段一产出），新版本号为 **v1.7** 而非 v1.6（C1）；`git mv` v1.6 入 `history/product/`。
- 识别段落改写、ADR-0014、runbook L161 段更新、rollout 变更记录追加均按原计划不变；grep 断链检查对象改为 `coupon-oa-mvp-prd-v1.6`。
- PRD v1.7 以 v1.6 为底本，自动继承阶段一的条件必填与降级消息段落，不重复书写。

### Task A2（原 Task 2: AI 合同 v7）修订

- 无内容修订。开工前确认 `ai-recognition.ts` 无并行未提交改动（§0.3 前置已在门禁核对）。

### Task A3（原 Task 3: 确认语义泛化）修订

- 开工基底为阶段一合入后的 `cards.ts` / `dispatcher.ts`；改确认 UI 时**不得回退** B2 的「可选补充区排除已渲染 key」过滤（C2）。
- 删 `confirmAsSku` 旧键解析时不得触碰 `assertMappingFormReady` 与 `restoreMappingFormAfterFailure`（C3）。
- 新增 `whitelist_/blacklist_identifierDimension` select_static 与 `*_dimensionReason` input 后，**必须**把它们加入 B5 walker 的卡片形态矩阵并跑 `cards-schema.test.ts`（C7 门禁），随 Step 5 一起验证。

### Task A4（原 Task 4: 解析层维度泛化）修订

- 无内容修订。

### Task A5（原 Task 5: 产物与配券表维度化）修订

- `recognition.ts` 两处 safeParse 输入点**按符号定位**：`grep -n 'productLimitType: "限SKU"' server/lib/coupon-oa/three-source/recognition.ts`（当前 :1160 与 :1352，勿用原计划的 :1106/:1286——已因并行工作漂移，C4）。
- 其余（引擎 dimension 参数、workflow、calculation.ts 枚举放宽、测试）按原计划不变。

### Task A6（原 Task 6: service 集成与全量验证）修订

- 全量验证命令追加 `pnpm audit:cards` 干跑门禁（C8）：`pnpm lint && pnpm typecheck && pnpm test && pnpm test:coupon-three-source:offline && pnpm build && pnpm audit:cards`。
- e2e 断言新增：新用例 `merchant-id-headerless-whitelist` 构建的卡片通过 B5 唯一性 walker。
- 其余 grep 残留检查（`confirmAsSku` 0 命中、P1-1 文件原样）按原计划不变。

## 范围外与后续（不属本计划步骤）

- **部署与真发**：两阶段部署均走 `p0-preview-deploy` skill 且需用户单独授权；真发审计命令属外部副作用，仅在阶段门禁处申请。
- **「限商家ID」官方枚举确认**（A 设计 R3）：产品侧决定，回滚为一处常量。
- **枚举非法值不上卡**（`allowGift=是` 同类）：属并行未提交工作线（§0.3），由其自身计划承载。
- SPU 名单生成、P1-1 路线、native submit、附件 Gate、公开渠道枚举封闭集校验一律不动。
