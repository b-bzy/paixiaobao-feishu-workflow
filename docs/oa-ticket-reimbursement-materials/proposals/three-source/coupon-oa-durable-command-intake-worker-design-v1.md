# 三源优惠券提报：持久 Command-Intake Worker 设计 v1

> **状态**：command-only foundation 已在默认关闭的本地工作区实现，并完成本地 PostgreSQL disposable-schema 集成证据；尚无 durable bridge ACK、长时间运行 worker 或任何真实 Feishu E2E 证据，绝不代表 R1-dev、正式 R2 或 R3 已开放。后续风险整改以 [开发清单](coupon-oa-durable-control-plane-risk-remediation-backlog-v1.md) 为准。
>
> **日期**：2026-10-09
>
> **目标阶段**：R1-dev command/card pre-R2 validation；正式 R2 是更后的 `r2-draft-only` 文件/材料 flow。
>
> **关联**：[飞书开发版需求台账](coupon-oa-feishu-dev-requirements-tracker-v1.md) · [飞书综合 Skill 升级方案](coupon-oa-feishu-unified-skill-upgrade-plan-v1.md) · [三源工作流 PRD](coupon-oa-three-source-workflow-prd-v1.md) · [R2 foundation 验证记录](../../records/durable-control-plane/coupon-r2-foundation-verification-2026-10-09.md) · [rollout](../../current/operations/coupon-oa-internal-pilot-rollout-plan-v1.md)

## 1. 背景与目标

当前仓库已有 durable ingress/outbox、lease、三源 task aggregate、PostgreSQL task repository、默认关闭的 `/OA优惠券提报` matcher，以及 command-only receipt → worker → task/effect composition 的本地实现。R2 foundation 验证记录已包含本地 PostgreSQL migration、并发与 fake gateway 证据，但仍没有 durable bridge ACK、长时间运行 worker 或任何 Feishu E2E 证据。

本设计界定 R1-dev 的最小且可审计的 **command intake**：业务员在经认证的独立 Dev Bot 单聊发送精确命令后，持久 worker 创建或恢复一笔三源 task，并持久化一条“请提交材料”的卡片 effect 意图。R1-dev 使用 `FEISHU_RUNTIME_STAGE=r1-intake` 和独立 command/card gate；它不是 `r2-draft-only`，也不开放材料通道。

```text
受验签 bridge / HTTP callback
  → durable delivery receipt + process_feishu_delivery outbox job
  → worker 领取 job
  → reload receipt、重验 payload / actor / 单聊 / feature gate
  → 原子 create-or-resume 三源 task + audit + intake-card effect
  → job 标为 succeeded
  → 独立 effect worker 发送卡片并记录结果
```

该模块的交付目标是可靠地证明“命令只创建/恢复一笔任务并安排一条卡片意图”，而不是提前进入材料处理或 OA 填报。

## 2. 硬边界

本模块**允许**：

- 从持久 receipt 读取已验签 delivery；
- 精确匹配 `/OA优惠券提报`；
- 重验 runtime stage、feature flag、allowlist 与 per-delivery 单聊上下文；
- 创建/恢复当前 owner 的一笔 `Collecting` 三源 task；
- 写审计、操作去重记录和 outbound card effect 意图；
- 对 job/effect 进行 lease、retry、dead-letter 和有限度观测。

本模块**明确禁止**：

- 下载、解析、识别或保存 Excel/图片源材料；
- 调用 AI、renderer、Base、Drive、对象存储或审批附件 API；
- command-intake handler 不得直接调用 `sendFeishuCard()`；仅可持久化 effect intent。独立 effect worker 如获显式受认证 scheduler 调用，才可通过稳定 semantic key 发送该卡片；
- 读取或上传 Approval 定义、`file_code`、创建 Approval instance；
- 通过卡片、job payload 或环境变量注入业务字段、mapping 或审批权限；
- 为群聊、代理人、批量任务或非 allowlist 用户创建 task。

成功时 task 仍停在 `Collecting`。命令 intake 绝不能把 task 推进到来源确认、产物生成或 `DraftOnlyConfirmed`。

## 3. 当前证据与未解决 Gate

以下代码基础和本地 PostgreSQL 证据已经存在，后续 FDEV 不应重复开发它们：

1. `PostgresIngressReceiver`、migration runner、receipt/outbox、task/effect transaction、workflow/effect lease 与 scheduler tick 已实现为默认关闭的控制面；本地 disposable-schema 已验证 migration repeatability、delivery dedupe、同 owner 并发、`SKIP LOCKED`、stale lease fencing、fake card success 和 `outcome_unknown` restart no-resend。
2. durable worker composition root 已注册 `process_feishu_delivery` 与 command/card effect handler；它仅有本地 fake/isolated evidence，尚未作为常驻托管 worker 运行。
3. 非 local bridge ingress 已实现验签、规范化、receipt/outbox 持久化和快速 `202`；它不会调用 legacy `handleFeishuPocEvent()`，但当前 `lark-cli` relay 仍不能证明 source ACK、durable retry、reconnect 或 DLQ。
4. delivery contract 已持久化 `chatType`、`chatId`、actor、message ID、stable delivery ID 与 canonical payload hash；每笔 delivery 的 direct-chat 验证不能由全局 ready flag 替代。
5. command-only slice 的现有 effect 只代表可测试的 intent/safe state foundation；timeout、lease renewal、request hash 重验和 task-owner binding 属于未实现的 FDEV-003A/003B。

以下仍是 R1-dev No-go，必须按[需求台账](coupon-oa-feishu-dev-requirements-tracker-v1.md)独立完成而非在本模块重做：受支持 SDK durable bridge ACK（FDEV-002）、outbound timeout/lease fencing（FDEV-003A）、effect integrity binding（FDEV-003B）、unknown/DLQ reconciliation（FDEV-004A）、health/metrics/runbook（FDEV-004B）、retention/redaction/RBAC（FDEV-004C）。

对象存储、Base/Drive、renderer、文件和审批权限均不是 R1-dev command/card 的运行依赖；不得借“预热”名义访问它们。

## 4. 模块边界与建议接口

### 4.1 Delivery repository

新增 `FeishuDeliveryRepository` 与 PostgreSQL 实现，负责按 `receiptId` 读取 delivery、验证 schema 版本与 canonical payload hash，并持久化处理结果。

```ts
interface PersistedDelivery {
  receiptId: string;
  stableDeliveryId: string;
  correlationId: string;
  eventType: "im.message.receive_v1";
  actorOpenId: string;
  messageId: string;
  chatType: "p2p" | "group" | "unknown";
  payload: Record<string, unknown>;
  payloadSha256: string;
}

type DeliveryOutcome =
  | { kind: "handled"; taskId: string; effectId: string }
  | { kind: "ignored"; reason: string }
  | { kind: "rejected"; reason: string };
```

- `receiptId` 是 worker job 的唯一 payload 输入；handler 不接受可由调用方自由构造的业务事件。
- repository 必须保存 handled/ignored/rejected 结论，以支持 delivery/job replay 返回相同结果。
- 原始 payload、完整 open ID、file key、token、secret 不得写入日志或错误消息；审计仅使用 correlation ID、hash/截断标识和枚举结果。

### 4.2 Command normalizer

仅将满足下列条件的 delivery 归一化为 command：

- `schemaVersion = feishu-delivery-v1`；
- event type 为 `im.message.receive_v1`；
- actor、message ID、stable delivery ID、received time 和 hash 均有效；
- 经认证的 `chatType = p2p`；
- 文本经现有安全规范化后精确等于 `/OA优惠券提报`（允许既有的开头命令符和空白规范化，不接受自由文本包含匹配）。

旧命令、非文本事件、群聊、未知 chat、损坏 envelope 和不完整身份不能进入 task 层。它们分别持久化为 `ignored` 或 `rejected`，不发送卡片。

### 4.3 Command intake application service

建议新增 `durable-command-intake-handler.ts`，依赖通过构造函数注入：

- delivery repository；
- runtime/gate provider；
- transactional task repository；
- effect repository；
- audit writer；
- clock 与 ID generator（测试可控）。

处理顺序：

1. 以 `receiptId` 读取并验证 delivery；
2. 若已有处理结果，直接返回该结果；
3. 归一化并验证 exact command/direct chat；
4. 调用 `assertDurableRuntimeConfiguration()`，并重验 R1-dev 的 `r1-intake` stage、独立 command gate 与 server-side allowlist；不得通过选择 `r2-draft-only` 绕开 command/card 的独立 Gate；
5. 在**同一数据库 transaction**内：create-or-resume owner task、追加 audit、写入一条 intake-card effect、写入 delivery outcome；
6. transaction 成功后返回 handled；父 job 仅在该返回后完成。

当前 `PostgresCouponThreeSourceTaskRepository` 自行开启 transaction；为满足上述原子边界，下一实现必须提供 unit-of-work / transactional repository API，不能依赖多个独立 transaction 恰好成功。

### 4.4 幂等键

三种键必须彼此独立：

| 键 | 作用 | 推荐组成 |
| --- | --- | --- |
| transport delivery key | 同一飞书 delivery 不重复入库 | app/tenant/stableDeliveryId |
| command operation key | 同一 receipt/job replay 不重复改变 task | `three-source:intake:<receiptId>` |
| card effect semantic key | 同一 task revision/intake 只产生一条卡片意图 | `coupon-intake-card:<taskId>:<revision>` |

不能使用 card send UUID、message ID 或 task ID 之一替代全部三类语义。effect intent 的落库必须与 task/audit/outcome 同 transaction；实际发送由独立 effect worker 执行。

### 4.5 Durable effect worker

新增 `EffectRepository` / `PostgresEffectRepository`，复用 `effect_receipts` 表但为其定义明确的状态、lease、attempt、external reference 和 DLQ 合同。

- command handler 只 `enqueue`，不得直接 import `client.ts` 或发送飞书卡片；
- effect worker 领取 effect、渲染已知 intake card、调用 send gateway、保存成功或 retry/dead-letter 结果；
- response 丢失、worker 崩溃和重复 job 都必须通过 semantic key / effect receipt 对账，不能盲目重复发送；
- effect 的 payload 只包含 task ID、revision、card purpose 与已知 owner，不携带自由业务字段。

### 4.6 Worker 生命周期与观测

worker composition root 必须：

- 启动前检查 runtime configuration；
- 通过单活 runtime lease / heartbeat 防止多个实例错误地同时作为 scheduler（job 行仍以 PostgreSQL row lock 为最终并发防线）；
- 设置有界 claim 数、lease 时长、poll backoff、graceful shutdown 与 lease release/expiry 策略；
- 区分 permanent rejection、retryable database/bridge failure、unknown external effect result；
- 记录 backlog、lease reclaim、retry、dead-letter、effect 状态、delivery outcome 的聚合指标；
- 提供不含原始 payload、secret、file key 或完整用户标识的健康/诊断输出。

## 5. 错误与恢复语义

| 情形 | command outcome | job 处理 | task/effect 副作用 |
| --- | --- | --- | --- |
| 无关文本/非文本 | ignored | 成功完成 | 无 |
| 非单聊或缺可信 chat | rejected | 成功完成 | 无 |
| stage/flag/allowlist 不满足 | rejected | 成功完成 | 无 |
| delivery 已处理 | 返回存储结果 | 成功完成 | 无新增 |
| DB 暂时不可用 | 无 outcome | retry | 无部分提交 |
| transaction 后、job 完成前崩溃 | 已有 outcome/effect | lease 回收后重放 | 返回既有结果，不重复 effect intent |
| effect 发送暂时失败 | task 已创建 | effect retry | 不重新创建 task |
| effect 外部结果未知 | task 不变 | 标记待对账/DLQ | 禁止盲发第二张卡 |

原生 OA 创建不在本模块的任何错误恢复路径内。

## 6. 已有 foundation、后续 FDEV 与验收边界

本 design 所描述的 command-only foundation 已存在并有如下本地证据：receipt/outbox、command normalizer、单 owner task/audit/effect transaction、workflow/effect lease、fake card worker path、`outcome_unknown` terminal behavior，以及 PostgreSQL migration/concurrency/lease integration。它们不得被重新实现为第二套路径。

尚未解除的要求按台账严格串行推进：

1. FDEV-001 先产生可复现且经 🥇 的 release baseline；
2. FDEV-002 证明受支持 bridge 的 durable write → source ACK、relay retry/reconnect/DLQ；
3. FDEV-003A、FDEV-003B 分别解决 effect timeout/lease fencing 与 payload/task/owner binding；
4. FDEV-004A–004C 分别交付 unknown/DLQ 对账、运行观测与数据治理；
5. FDEV-005 只完成 Dev 环境预检且不消费真实事件；
6. FDEV-006 才以 Shadow → Dark task → card canary 受控验证 R1-dev；
7. FDEV-007 才可设计正式 R2 的文件/材料链路。

每一项在开发冻结后必须先交给新的 Test-Plan Agent，再由独立 QA/Test Agent 进行本地/隔离或获准的真实验证。R1-dev 最小验收仅是：allowlist 用户的经认证单聊命令创建或恢复一笔 `Collecting` task，并产生一条可对账 intake-card effect；重复 delivery/job、worker 重启与 lease 回收不新增 task/effect intent；并能证明对文件、Base、Drive、对象存储、renderer、AI、Approval 和 OA 的调用数均为零。它不构成正式 R2 的任何材料验收。
