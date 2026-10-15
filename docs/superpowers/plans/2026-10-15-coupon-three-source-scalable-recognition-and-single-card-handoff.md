# 优惠券三源可扩展识别与单卡交接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让任意命名的配券表与 SKU 名单先安全入库、再分层识别，并让生成和 OA 测试稿交接在重复点击或失败时只产生一个可恢复的卡片结果。

**Architecture:** 合法 `.xlsx` 先进入当前 revision 的 `pendingSources`，确定性探针和 DeepSeek 分区候选共同形成“材料角色 + ID 维度”两轴结果，服务端从原始 bytes 回读并由 owner 解决剩余歧义。确认、冻结、附件投递和 OA 测试稿交接使用 PostgreSQL durable effect 与语义幂等键，所有进度和终态 PATCH 同一张卡。

**Tech Stack:** TypeScript、Nitro、Vitest、ExcelJS、Zod、PostgreSQL durable effect/outbox、飞书 OpenAPI/Base/Drive、DeepSeek Chat API。

**Spec:** `docs/superpowers/specs/2026-10-15-coupon-three-source-scalable-recognition-and-single-card-handoff-design.md`

## Global Constraints

- 当前只接受 `.xlsx`，单文件上限固定为 `10 * 1024 * 1024` bytes。
- 只生成 SKU 白名单和可选 SKU 黑名单；SPU、商家 ID 不转换、不进入标准附件。
- DeepSeek 只提出候选；角色、坐标、ID 类型、SKU 值、权限和副作用由服务端验证。
- SKU 必须从 source SHA-256 对应的原始单元格确定性读取，模型不得生成或改写。
- 源文件永不直接成为 OA 附件；只有确认并冻结、hash/readback 通过的标准产物可交接。
- 每个 revision 最多一张活动中的第二轮卡；处理中、成功和失败都 PATCH 该卡。
- 回调语义键固定为 `taskId + revision + actionName + mappingContextHash`。
- OA 测试稿语义身份固定为 `taskId + revision + confirmationSnapshotHash`。
- `FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false`；不得创建或提交飞书原生 OA。
- 真实业务工作簿、DeepSeek 完整请求/响应和 Base 原始状态只放 Git 忽略目录或 `/tmp`。
- 不修改已应用 migration；如需数据库变化，只新增顺序 migration。
- 未经用户明确授权不提交、推送、部署或执行飞书业务写入；计划中的 Commit/Preview/CLI 步骤均受该授权约束。

## Review Focus

- 文件名含“商家ID”、表内无表头且只有数字：角色可默认白名单，但 ID 维度必须要求 owner 确认为 SKU。
- DeepSeek 返回高置信角色但坐标越界或没有有效 ID 区域：保留其他有效分区，当前分区降级或进入确认，不能直接生成。
- 第二轮卡发出后又上传第三份名单：旧卡必须失效，新 revision 只询问一次“替换白名单/作为黑名单”。
- OA 测试稿已创建但响应或 link 回写丢失：按语义身份对账并补写引用，不创建第二份。
- 同一个超过 10 MB 的文件事件重复投递：不下载解析、不调用 AI、不改变 revision，只投递一张人工提报提示卡。

---

### Task 1: 固化两轴识别领域合同

**Files:**
- Modify: `server/lib/coupon-oa/three-source/types.ts`
- Modify: `server/lib/coupon-oa/three-source/recognition.ts`
- Test: `server/lib/coupon-oa/three-source/recognition.test.ts`
- Test: `server/lib/coupon-oa/three-source/e2e/case-catalog.ts`

**Interfaces:**
- Consumes: 现有 `SourceRole`、`IdentifierDimension`、`WorkbookRecognition` 和 `ListColumnCandidate`。
- Produces: `SourceRoleResolution = SourceRole | "unknown"`、扩展后的 `IdentifierDimension = "SKU" | "SPU" | "MERCHANT_ID" | "UNKNOWN"`、`resolveSourceRoleCandidates(input): SourceRoleDecision` 和可携带 `UNKNOWN` 的名单区域候选。

- [ ] **Step 1: 写两轴识别失败测试**

在 `recognition.test.ts` 增加以下用例并断言：

- 无表头单列数字返回名单区域、`dimension: "UNKNOWN"`，而不是零候选；
- 文件名含“商家ID”只增加原因，不把 `UNKNOWN` 强制改为 `MERCHANT_ID`；
- 明确 `SKUID`、`SPUID`、`商家ID` 表头分别返回三种维度；
- 同表 SKU/SPU 并列时产生两个独立候选；
- 多行满减仍形成一个常规满减模板内的多个券档。

- [ ] **Step 2: 运行聚焦测试并确认失败**

Run: `pnpm exec vitest run server/lib/coupon-oa/three-source/recognition.test.ts`

Expected: 无表头区域或 `UNKNOWN` 类型相关断言失败。

- [ ] **Step 3: 实现领域类型与角色决议函数**

在 `types.ts` 定义：

```ts
export type SourceRoleResolution = SourceRole | "unknown";

export interface SourceRoleDecision {
  role: SourceRoleResolution;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  requiresOwnerConfirmation: boolean;
}
```

在 `recognition.ts` 实现：

```ts
export function resolveSourceRoleCandidates(input: {
  recognition: WorkbookRecognition;
  occupiedRoles: Partial<Record<SourceRole, string>>;
  sourceCount: number;
}): SourceRoleDecision;
```

规则只处理明确证据；“一份配券表 + 一份名单形态且无黑名单证据”把名单角色设为低置信白名单，但不改变 `UNKNOWN` ID 维度。

- [ ] **Step 4: 运行领域测试**

Run: `pnpm exec vitest run server/lib/coupon-oa/three-source/recognition.test.ts`

Expected: PASS。

- [ ] **Step 5: 条件提交**

若执行时用户已明确授权提交：

```bash
git add server/lib/coupon-oa/three-source/types.ts \
  server/lib/coupon-oa/three-source/recognition.ts \
  server/lib/coupon-oa/three-source/recognition.test.ts \
  server/lib/coupon-oa/three-source/e2e/case-catalog.ts
git commit -m "feat(coupon-three-source): separate source roles from id dimensions"
```

否则只记录建议提交信息，不执行 Git 写入。

### Task 2: 将来源上传改为 pending staging，并处理 10 MB 人工分流

**Files:**
- Modify: `server/lib/feishu/coupon-oa/three-source/store.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/service.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/dispatcher.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/cards.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/store.test.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/service.test.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/cards.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `SourceRoleDecision`、现有 source reference、processed message receipt 和安全错误投影。
- Produces: `PendingCouponThreeSourceSource`、`pendingSources`、`stageSource(input)` 和 `buildCouponThreeSourceManualSubmissionCard(input)`。

- [ ] **Step 1: 写 pending 与超限事件失败测试**

断言：

- 无表头单列 `.xlsx` 上传后进入 `pendingSources`，不调用 `selectUniqueRole()`；
- source hash 相同或 message ID 重复时不增加 revision 和上传顺序；
- 大于 10 MB 时不调用工作簿识别、存储或 AI preparation；
- 超限事件重复时只调用一次卡片发送；
- 超限不会清空已有配券表或白名单，也不自动取消提报。

- [ ] **Step 2: 运行上传链路测试并确认失败**

Run:

```bash
pnpm exec vitest run \
  server/lib/feishu/coupon-oa/three-source/store.test.ts \
  server/lib/feishu/coupon-oa/three-source/service.test.ts \
  server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts \
  server/lib/feishu/coupon-oa/three-source/cards.test.ts
```

Expected: 当前 `receiveSource()` 提前角色判定或超限通用错误相关断言失败。

- [ ] **Step 3: 扩展草稿状态并保持兼容**

在 `store.ts` 定义：

```ts
export interface PendingCouponThreeSourceSource {
  source: CouponThreeSourceSourceReference;
  receivedOrder: number;
  recognition?: StoredWorkbookRecognition;
}
```

为 `CouponThreeSourcePilotDraft` 增加 `pendingSources`，normalizer 为旧草稿补 `[]`。
来源改变时保留 owner 业务字段，但清除旧角色映射、确认快照、产物和 OA 引用。

- [ ] **Step 4: 实现 staging 与超限卡**

把 `receiveSource()` 改为只完成 Gate、hash、结构探针和 pending staging；删除上传阶段的
`selectUniqueRole()`。在 dispatcher 下载前读取可信文件大小元数据；无可信元数据时，
下载后但在 Excel/AI 前校验。超限使用稳定 receipt/idempotency key 投递人工提报卡。

- [ ] **Step 5: 运行上传链路测试**

Run: 使用 Step 2 命令。

Expected: PASS。

- [ ] **Step 6: 条件提交**

建议提交信息：`feat(coupon-three-source): stage unclassified workbook sources`

### Task 3: 扩展 DeepSeek 候选、超时和分区降级

**Files:**
- Modify: `server/lib/coupon-oa/three-source/ai-recognition.ts`
- Modify: `server/lib/feishu/deepseek-chat-gateway.ts`
- Modify: `server/lib/control-plane/coupon-ai-recognition-effect.ts`
- Modify: `server/lib/control-plane/postgres-coupon-ai-recognition-repository.ts`
- Test: `server/lib/coupon-oa/three-source/ai-recognition.test.ts`
- Test: `server/lib/control-plane/coupon-ai-recognition-effect.test.ts`
- Test: `server/lib/control-plane/postgres-coupon-ai-recognition-repository.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `UNKNOWN` 维度和 Task 2 的 pending source。
- Produces: prompt vNext 的 `roleCandidates`、`skuRegionCandidates`、`identifierDimensionCandidates`、稳定失败码和单请求超时行为。

- [ ] **Step 1: 写 AI 分区和超时失败测试**

覆盖：

- 模型将无表头数字猜成商家 ID 时，验证结果保留候选但标记“文件名弱证据”；
- 明确 SPU/商家 ID 表头不得被模型改写为 SKU；
- 角色有效但 ID 坐标越界时只丢弃 ID 分区；
- 超时得到 `AI_TIMEOUT`，规则候选继续保留；
- 同一 task/revision/source hash/model/prompt 只准备一次 effect；
- 投影重试不重新调用 DeepSeek。

- [ ] **Step 2: 运行 AI 测试并确认失败**

Run:

```bash
pnpm exec vitest run \
  server/lib/coupon-oa/three-source/ai-recognition.test.ts \
  server/lib/control-plane/coupon-ai-recognition-effect.test.ts \
  server/lib/control-plane/postgres-coupon-ai-recognition-repository.test.ts
```

Expected: `UNKNOWN`、弱证据或超时分类断言失败。

- [ ] **Step 3: 更新 prompt/schema 与证据校验**

DeepSeek 只返回候选、来源坐标、置信度和困难原因。验证器重新读取原单元格，文件名只
影响 reasons，不覆盖明确表头；没有表头的纯数字区域允许返回 `UNKNOWN`。

- [ ] **Step 4: 在 gateway 增加显式超时**

使用现有配置中的 timeout 值和 `AbortSignal.timeout`/兼容控制器；把 abort、网络失败、
HTTP 失败和无效 JSON 映射为不同稳定错误码。不得记录完整工作簿或响应正文。

- [ ] **Step 5: 运行 AI 测试**

Run: 使用 Step 2 命令。

Expected: PASS。

- [ ] **Step 6: 条件提交**

建议提交信息：`feat(coupon-three-source): validate ai role and id candidates independently`

### Task 4: 建立 revision 级批量角色解析与第三份材料决议

**Files:**
- Modify: `server/lib/feishu/coupon-oa/three-source/service.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/ai-projection.ts`
- Create: `server/lib/coupon-oa/three-source/source-resolution.ts`
- Create: `server/lib/coupon-oa/three-source/source-resolution.test.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/service.test.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/ai-projection.test.ts`

**Interfaces:**
- Consumes: Tasks 1-3 的 pending source、规则候选和 AI validated result。
- Produces: `resolveThreeSourceBatch(input): ThreeSourceBatchResolution`、`applyThreeSourceBatchResolution(input)` 和条件 role conflict。

- [ ] **Step 1: 写批量决议失败测试**

测试并断言：

- 配券表 + 一份模糊名单时，角色结果为配券表/白名单，名单 ID 维度仍为 `UNKNOWN`；
- 第三份明确黑名单自动映射为黑名单；
- 第三份明确白名单产生 `replace_whitelist` 决议；
- 第三份用途不明 SKU 名单产生一个 `whitelist_or_blacklist` 问题；
- 第三份 SPU/商家 ID 先产生维度 blocker，不产生黑白选择；
- 第二轮卡之后上传第三份来源使旧 `mappingContextHash` 失效。

- [ ] **Step 2: 运行批量解析测试并确认失败**

Run:

```bash
pnpm exec vitest run \
  server/lib/coupon-oa/three-source/source-resolution.test.ts \
  server/lib/feishu/coupon-oa/three-source/service.test.ts \
  server/lib/feishu/coupon-oa/three-source/ai-projection.test.ts
```

Expected: 新模块缺失或当前 `startAiRecognition()` 要求角色预分配。

- [ ] **Step 3: 实现纯领域批次解析器**

定义：

```ts
export interface ThreeSourceBatchResolution {
  assignments: Array<{ sourceSha256: string; role: SourceRole }>;
  issues: Array<
    | { kind: "identifier_dimension"; sourceSha256: string }
    | { kind: "replace_whitelist"; sourceSha256: string }
    | { kind: "replace_coupon_table"; sourceSha256: string }
    | { kind: "whitelist_or_blacklist"; sourceSha256: string }
  >;
}

export function resolveThreeSourceBatch(input: {
  sources: PendingCouponThreeSourceSource[];
  assigned: Partial<Record<SourceRole, StoredWorkbookRecognition>>;
}): ThreeSourceBatchResolution;
```

- [ ] **Step 4: 改造 recognition 启动与投影**

`startAiRecognition()` 对当前 revision 的全部 pending source 统一 prepare/activate；AI 终态
后由 projector 重算整个批次并以 CAS 保存 assignments。部分结果未完成时 PATCH 同一张
识别中卡；全部终态后才进入统一第二轮卡。

- [ ] **Step 5: 运行批量解析测试**

Run: 使用 Step 2 命令。

Expected: PASS。

- [ ] **Step 6: 条件提交**

建议提交信息：`feat(coupon-three-source): resolve uploaded sources as one revision batch`

### Task 5: 强制 SKU-only 确定性复制与 owner 维度覆盖

**Files:**
- Modify: `server/lib/coupon-oa/three-source/lists.ts`
- Modify: `server/lib/coupon-oa/three-source/offline.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/store.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/service.ts`
- Test: `server/lib/coupon-oa/three-source/recognition.test.ts`
- Test: `server/lib/coupon-oa/three-source/offline.test.ts`
- Test: `server/lib/feishu/coupon-oa/three-source/service.test.ts`

**Interfaces:**
- Consumes: Task 4 的角色 assignments 和 identifier blocker。
- Produces: `IdentifierDimensionConfirmation`、扩展后的 `ListColumnSelection` 和 SKU-only parser gate。

- [ ] **Step 1: 写 ID 类型和 SKU 安全失败测试**

覆盖：

- `UNKNOWN` 未确认时阻断；owner 确认 SKU 后从原坐标读取；
- SPU/商家 ID 明确表头默认阻断，owner 明确“表头写错、实际为 SKU”后保留覆盖原因；
- SKU/SPU 并列只复制所选 SKU；
- 文本前导零、安全整数、超过 15 位数值、公式、外链、一格多 ID、空值、同 Sheet
  重复、跨 Sheet 重复、隐藏行和筛选行；
- AI 提供的值与原单元格不一致时采用原单元格并记录问题。

- [ ] **Step 2: 运行名单测试并确认失败**

Run:

```bash
pnpm exec vitest run \
  server/lib/coupon-oa/three-source/recognition.test.ts \
  server/lib/coupon-oa/three-source/offline.test.ts \
  server/lib/feishu/coupon-oa/three-source/service.test.ts
```

Expected: `UNKNOWN` 确认与明确非 SKU 阻断相关断言失败。

- [ ] **Step 3: 扩展确认合同**

在 `store.ts` 定义：

```ts
export interface IdentifierDimensionConfirmation {
  sourceSha256: string;
  dimension: "SKU";
  reason: string;
  confirmedBy: string;
  confirmedAt: string;
}
```

`CouponThreeSourcePilotSelections` 保存按 source hash 的确认；来源替换时清除对应确认。

- [ ] **Step 4: 实现 SKU-only parser gate**

`parseMultiSheetTieredIdentifierList()` 和单列 parser 在读取前验证已确认维度；输出仍从
source hash 对应的原始 bytes 逐格读取。不得添加 SPU/商家 ID 转换逻辑。

- [ ] **Step 5: 运行名单测试**

Run: 使用 Step 2 命令。

Expected: PASS。

- [ ] **Step 6: 条件提交**

建议提交信息：`fix(coupon-three-source): enforce sku-only deterministic list copy`

### Task 6: 合并第二轮卡、困难说明和 mappingContextHash

**Files:**
- Modify: `server/lib/feishu/coupon-oa/three-source/cards.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/cards-schema.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/cards.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/mapping-card-delivery.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/mapping-card-delivery.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/store.ts`

**Interfaces:**
- Consumes: Tasks 4-5 的 batch issues、ID confirmations、名单计数和 source hashes。
- Produces: `computeMappingContextHash(draft): string`、一个 revision 一张活动卡，以及第三份材料条件字段。

- [ ] **Step 1: 写第二轮卡失败测试**

断言：

- case1/3 结构显示“无表头、文件名含商家ID、需确认实际为 SKU”；
- case2 只预选 SKU，SPU 显示为未采用列；
- 未上传黑名单的整体确认在同一张卡；
- 第三份用途不明名单只显示一个“替换白名单/作为黑名单”选择；
- 卡片显示有效 SKU、空值、重复数和默认判断；
- 相同 revision/context 只 PATCH 原 message ID；
- source replacement 改变 context hash，旧卡 callback 被拒绝。

- [ ] **Step 2: 运行卡片测试并确认失败**

Run:

```bash
pnpm exec vitest run \
  server/lib/feishu/coupon-oa/three-source/cards.test.ts \
  server/lib/feishu/coupon-oa/three-source/cards-schema.test.ts \
  server/lib/feishu/coupon-oa/three-source/mapping-card-delivery.test.ts
```

Expected: 新字段或 context hash 断言失败。

- [ ] **Step 3: 实现 mappingContextHash 与卡片字段**

hash 只覆盖 task ID、revision、每个 source SHA、角色 assignments、名单区域和需确认
问题，不包含未保存的卡片输入。`mappingCardDelivery` 保存 message ID、revision 和
context hash。

- [ ] **Step 4: 实现单卡投递规则**

相同 revision/context 用 `updateCard`；仅当没有活动卡时发送新卡。旧 revision/context
回调返回稳定“请使用最新卡片”，不修改状态。

- [ ] **Step 5: 运行卡片测试**

Run: 使用 Step 2 命令。

Expected: PASS。

- [ ] **Step 6: 条件提交**

建议提交信息：`feat(coupon-three-source): explain recognition ambiguity in one mapping card`

### Task 7: 将确认、生成和卡片终态放入 durable effect

**Files:**
- Create: `server/lib/control-plane/coupon-three-source-action-effect.ts`
- Create: `server/lib/control-plane/coupon-three-source-action-effect.test.ts`
- Create: `server/lib/control-plane/postgres-coupon-three-source-action-repository.ts`
- Create: `server/lib/control-plane/postgres-coupon-three-source-action-repository.test.ts`
- Modify: `server/lib/control-plane/durable-coupon-control-plane-worker.ts`
- Modify: `server/lib/control-plane/durable-coupon-control-plane-worker.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/dispatcher.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/cards.ts`

**Interfaces:**
- Consumes: Task 6 的 `mappingContextHash`、现有 `effect_receipts` 唯一 semantic key 和 service 生成接口。
- Produces: `coupon_three_source_action` effect handler、`CouponThreeSourceActionRepository.prepare(input)`、`couponThreeSourceActionSemanticKey(input)` 和 processing/success/recoverable-failure 单终态投影。

- [ ] **Step 1: 写重复点击和未知结果失败测试**

覆盖：

- 同一 `taskId/revision/action/contextHash` 双击只入队一个 effect；
- response 丢失后再次 callback 返回已存在操作，不重复冻结、上传或发卡；
- worker 重启和 lease 过期只恢复同一 effect；
- 生成成功、handoff 失败时同一张卡进入可恢复失败，不再额外发送成功预览和通用红卡；
- `outcome_unknown` 不自动重放不可确认的外部副作用；
- 卡片 PATCH 失败不会吞掉业务状态，后续 projection 可重试。

- [ ] **Step 2: 运行 durable action 测试并确认失败**

Run:

```bash
pnpm exec vitest run \
  server/lib/control-plane/coupon-three-source-action-effect.test.ts \
  server/lib/control-plane/postgres-coupon-three-source-action-repository.test.ts \
  server/lib/control-plane/durable-coupon-control-plane-worker.test.ts \
  server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts
```

Expected: action effect 尚不存在，dispatcher 仍直接执行生成/handoff。

- [ ] **Step 3: 定义 effect 合同和语义键**

实现：

```ts
export function couponThreeSourceActionSemanticKey(input: {
  taskId: string;
  revision: number;
  actionName: string;
  mappingContextHash: string;
}): string;
```

effect payload 只保存必要的 record/task/revision/action/context 引用，不保存完整文件或
飞书事件。复用现有 `effect_receipts`，不新增并行队列。

`postgres-coupon-three-source-action-repository.ts` 提供：

```ts
export interface CouponThreeSourceActionRepository {
  prepare(input: {
    taskId: string;
    semanticKey: string;
    requestPayload: Record<string, unknown>;
  }): Promise<DurableEffect>;
}
```

实现向现有 `effect_receipts` 写入 `kind = "coupon_three_source_action"`，对唯一
`semantic_key` 使用 `ON CONFLICT DO NOTHING` 后回读同一 effect。

- [ ] **Step 4: 把 dispatcher 改为快速登记操作**

callback 校验 owner/revision/context 后原子 prepare effect，并 PATCH 当前卡为处理中；
不在 HTTP 请求内同步执行完整生成和 OA 交接。

- [ ] **Step 5: 实现 worker handler 与单终态投影**

handler 读取当前 draft 并再次校验 revision/context，执行生成、上传和下一阶段；成功或
可恢复失败都 PATCH 同一张卡。只有对账确认后才能从 `outcome_unknown` 继续。

- [ ] **Step 6: 运行 durable action 测试**

Run: 使用 Step 2 命令。

Expected: PASS。

- [ ] **Step 7: 条件提交**

建议提交信息：`fix(coupon-three-source): serialize confirmation side effects durably`

### Task 8: 用语义身份创建并对账 OA 测试稿

**Files:**
- Create: `infra/postgres/migrations/0007_coupon_three_source_handoffs.sql`
- Create: `server/lib/control-plane/postgres-coupon-three-source-handoff-repository.ts`
- Create: `server/lib/control-plane/postgres-coupon-three-source-handoff-repository.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/handoff.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/handoff.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/service.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/service.test.ts`
- Modify: `server/lib/feishu/coupon-oa/draft-store.ts`
- Modify: `server/lib/feishu/coupon-oa/draft-store.test.ts`
- Modify: `server/lib/feishu/coupon-oa/three-source/store.ts`

**Interfaces:**
- Consumes: Task 7 的 durable action 和现有 `OaPrefillSnapshot`/frozen artifacts。
- Produces: `buildThreeSourceOaDraftIdentity(input): string`、`CouponThreeSourceHandoffRepository` 和 `reconcileThreeSourceOaDraft(input)`。

- [ ] **Step 1: 写 handoff 对账失败测试**

断言：

- identity 精确包含 task ID、revision、confirmation snapshot hash；
- 已创建测试稿但调用响应丢失时，readback 找到同一测试稿并补写 record ID；
- 同一 identity 重试不重复上传附件或创建草稿；
- owner 的无关活动草稿产生明确冲突，不被当作本 revision 草稿；
- final confirm 只读取当前 identity 的测试稿；
- native OA switch 为 false 时不出现原生 approval 调用。

- [ ] **Step 2: 运行 handoff 测试并确认失败**

Run:

```bash
pnpm exec vitest run \
  server/lib/feishu/coupon-oa/three-source/handoff.test.ts \
  server/lib/feishu/coupon-oa/three-source/service.test.ts \
  server/lib/feishu/coupon-oa/draft-store.test.ts \
  server/lib/control-plane/postgres-coupon-three-source-handoff-repository.test.ts
```

Expected: 当前 handoff 只按 owner 活动草稿或 `oaDraftRecordId` 查询。

- [ ] **Step 3: 新增 handoff 耐久事实表**

新增 `0007_coupon_three_source_handoffs.sql`，包含唯一 `source_identity`、task ID、
revision、snapshot hash、状态 `pending | created | outcome_unknown | failed`、OA draft
record ID、错误码和时间戳。repository 提供：

```ts
export interface CouponThreeSourceHandoffRepository {
  prepare(input: {
    sourceIdentity: string;
    taskId: string;
    revision: number;
    confirmationSnapshotHash: string;
  }): Promise<CouponThreeSourceHandoff>;
  getByIdentity(sourceIdentity: string): Promise<CouponThreeSourceHandoff | undefined>;
  markCreated(input: { sourceIdentity: string; oaDraftRecordId: string }): Promise<void>;
  markOutcomeUnknown(input: { sourceIdentity: string; errorCode: string }): Promise<void>;
}
```

在系统 OA 草稿中同时保存不可变 `sourceIdentity` 供 readback 对账。PostgreSQL 是唯一
约束与提交状态事实源，Base 只保存可见投影和 record ID。

- [ ] **Step 4: 实现 handoff reconcile**

顺序为：按 identity 查询 → 已存在则 readback → 不存在才上传验证后的附件并创建 →
创建结果不确定则按 identity 对账 → 补写三源 draft 引用。无关 owner 草稿单独报告冲突。

- [ ] **Step 5: 运行 handoff 测试**

Run: 使用 Step 2 命令。

Expected: PASS。

- [ ] **Step 6: 条件提交**

建议提交信息：`fix(coupon-three-source): reconcile oa test drafts by source identity`

### Task 9: 同步当前产品、实现和运行基线

**Files:**
- Modify: `docs/oa-ticket-reimbursement-materials/current/product/coupon-oa-mvp-prd-v1.4.md`
- Modify: `docs/oa-ticket-reimbursement-materials/current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md`
- Modify: `docs/oa-ticket-reimbursement-materials/current/implementation/coupon-three-source-live-audit-runbook.md`
- Modify: `docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md`

**Interfaces:**
- Consumes: Tasks 1-8 的最终运行时合同。
- Produces: 与代码一致的当前产品、实现、试点和回滚说明。

- [ ] **Step 1: 更新产品行为**

写明两轴识别、两份材料默认白名单、第三份材料条件选择、SKU-only、10 MB 人工分流和
一个 revision 一张第二轮卡。

- [ ] **Step 2: 更新实现基线**

写明 pending source、AI 分区降级、mappingContextHash、durable action effect 和 OA
测试稿 semantic identity/reconcile。

- [ ] **Step 3: 更新真测与回滚判读**

增加三组材料矩阵、DeepSeek 超时、重复 callback、worker 重启、创建结果未知、单卡
终态和 native OA 零调用检查。

- [ ] **Step 4: 检查文档链接与生命周期表述**

Run:

```bash
git diff --check
rtk rg -n "TBD|TODO|已上线|生产可用" \
  docs/oa-ticket-reimbursement-materials/current/product/coupon-oa-mvp-prd-v1.4.md \
  docs/oa-ticket-reimbursement-materials/current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md \
  docs/oa-ticket-reimbursement-materials/current/implementation/coupon-three-source-live-audit-runbook.md \
  docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md
```

Expected: 无占位符，不把受保护 Preview 描述为生产能力。

- [ ] **Step 5: 条件提交**

建议提交信息：`docs(coupon-three-source): document scalable recognition and recovery`

### Task 10: 完整本地回归与三组真实材料验收

**Files:**
- Modify: `scripts/coupon-workbook-audit.mjs`
- Modify: `scripts/recognize-coupon-three-source-deepseek.mjs`
- Modify: `server/lib/coupon-oa/three-source/e2e/case-catalog.ts`
- Test: `server/lib/coupon-oa/three-source/e2e/case-contract.test.ts`
- Test: all files modified by Tasks 1-8

**Interfaces:**
- Consumes: 完整实现。
- Produces: 脱敏自动化回归、真实材料只读审计结论和 draft-only 发布候选。

- [ ] **Step 1: 补齐脱敏 fixture 合同**

把 spec 第 13.2 节的无表头、ID 冲突、第三份名单、超限、超时、重复点击和 handoff
未知结果纳入 case catalog；fixture 不包含真实业务数据。

- [ ] **Step 2: 运行受影响测试**

Run:

```bash
pnpm test:coupon-three-source:offline
pnpm exec vitest run \
  server/lib/coupon-oa/three-source \
  server/lib/feishu/coupon-oa/three-source \
  server/lib/control-plane/coupon-three-source-action-effect.test.ts \
  server/lib/control-plane/coupon-ai-recognition-effect.test.ts \
  server/lib/control-plane/durable-coupon-control-plane-worker.test.ts
pnpm test:coupon-three-source:e2e-local:fast
pnpm audit:cards
```

Expected: 全部 PASS。

- [ ] **Step 3: 运行三组真实材料确定性审计**

在 Git 忽略目录或 `/tmp` 使用用户提供的三组文件；断言：

- case1/3 配券表各识别 6 个券档，无表头名单进入白名单候选且 ID 维度待确认；
- case2 配券表识别 4 个业务券档，白名单四个 Sheet 只复制 SKU；
- 三组都不在上传阶段调用 `selectUniqueRole()` 失败；
- 原始文件未被修改。

- [ ] **Step 4: 运行显式 DeepSeek lane**

只在测试窗口调用已配置 DeepSeek；为每个请求设置超时。记录模型调用数、分区状态和
脱敏失败码，不保留或提交完整请求/响应。模型失败时确定性路径仍生成第二轮候选。

- [ ] **Step 5: 运行代码质量 Gate**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

Expected: 全部退出码 0。

- [ ] **Step 6: 审查 diff 与真实数据边界**

确认 `.env*`、真实 Excel、AI 原文、Base 导出、临时图片和生成附件均未进入 Git diff。

- [ ] **Step 7: 条件提交**

若已获提交授权，按任务边界提交或创建一个经审查的 Conventional Commit；否则保持
未提交并向用户报告精确文件范围。

### Task 11: 受保护 Preview 与飞书 CLI 手工验收

**Files:**
- Create or Modify: `docs/oa-ticket-reimbursement-materials/records/2026-10-15-coupon-three-source-scalable-recognition-live-round.md`

**Interfaces:**
- Consumes: Task 10 通过的干净发布候选。
- Produces: Preview SHA、bridge/worker、三组飞书手工测试、单卡和 draft-only 的脱敏证据。

- [ ] **Step 1: 获取部署和外部写入授权**

在执行前确认用户明确授权 Preview 部署、启动本机 bridge/worker 和向测试 Bot 发送
消息；计划本身不构成授权。

- [ ] **Step 2: 执行受保护 Preview preflight**

Run: `pnpm p0:preview:status`

Expected: 分支正确、工作区状态已解释、没有第二 consumer、native OA kill switch 为
false。只有 preflight 通过且授权存在才执行 `pnpm p0:preview:up`。

- [ ] **Step 3: 回读部署 SHA 与运行状态**

确认 Preview 完整 SHA 等于本地候选 SHA，只存在一个 bridge 和一个 worker。

- [ ] **Step 4: 逐组执行飞书手工测试**

每组使用新 task 或明确结束前一测试实例；验证统一识别、第二轮困难说明、标准附件、
OA 测试稿最新内容和卡片更新次数。case1/3 由 owner 明确确认“实际为 SKU”；case2
只选择 SKU 列。

- [ ] **Step 5: 验证 Bug2/Bug3**

对同一确认按钮执行正常点击和重复 callback 模拟；断言只有一个处理中状态、一个终态、
一个附件集合和一个 OA 测试稿。制造 handoff 可恢复失败后重试，最终卡必须指向当前
revision 的最新内容。

- [ ] **Step 6: 验证超限人工分流**

使用脱敏生成的 >10 MB fixture，不上传真实大文件；确认只出现一张人工提报提示卡、
不调用 DeepSeek、现有材料保留、没有自动取消或虚假转交。

- [ ] **Step 7: 核对 draft-only 并收尾**

回读 Base/日志/Approval：没有原生 OA instance code/link，没有
`POST /approval/v4/instances`。完成后按用户指令决定是否保留手工测试环境；如需停止，
执行 `pnpm p0:preview:down` 并记录结果。

- [ ] **Step 8: 保存脱敏验收记录**

记录代码 Gate、Preview SHA、三组结果、DeepSeek 调用/降级、卡片数量、OA 测试稿
readback 和未开放能力。不得记录 token、open ID、file key、完整 SKU 或 AI 原文。
