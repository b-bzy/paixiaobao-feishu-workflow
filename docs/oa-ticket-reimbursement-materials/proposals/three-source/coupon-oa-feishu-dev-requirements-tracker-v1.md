# 飞书开发版需求与进度台账 v1

> **状态**：飞书开发版的**唯一需求生命周期台账**。它记录需求、方案、开发、测试、缺陷和验收进度；不表示 R1-dev、正式 R2 或 R3 已开放。
>
> **日期**：2026-10-09
>
> **范围**：R0 本地/隔离验证、R1-dev command-to-card 验证 ring、正式 R2 draft-only 材料链路和 R3 原生 OA canary。线上“拍小宝”、完整三源材料流程、Base/Drive 与原生 OA 均不因本台账而开放。
>
> **关联**：[R1-dev 发布计划](coupon-oa-feishu-dev-command-intake-release-plan-v1.md) · [耐久控制面风险整改清单](coupon-oa-durable-control-plane-risk-remediation-backlog-v1.md) · [FDEV-001 候选基线清单](../../records/durable-control-plane/fdev-001-dev-release-baseline-v1.md) · [R2 foundation 验证记录](../../records/durable-control-plane/coupon-r2-foundation-verification-2026-10-09.md)

## 1. 不可跳过的交付生命周期

每一个 `FDEV-*` 或字母子需求都必须独立完成以下八步。后继需求可以在第 1 步登记，但在直接前置需求取得 🥇 前，不能进入第 2–7 步，更不能以当前脏工作区作为发布或试点基线。

```text
1. 拿到需求
2. 出方案
3. 开发
4. 出测试方案（新的 Test-Plan Agent）
5. 本地 / 隔离环境测试（独立 QA/Test Agent）
6. 修复 Bug
7. 🥇 验收完成
8. 开发下一个需求
```

- 范围、共享合同、migration、安全边界或验收口径变化时，回到第 2 步。
- 测试失败、关键故障未覆盖或外部 Gate 未证明时，回到第 6 步；不得把 No-go 写成通过。
- 🥇 必须有 Requirement Owner、工程 QA 与 Runtime/Release Owner 的结论和回滚/清理证据；代码完成、mock 成功或本地 PostgreSQL 成功都不等于 🥇。

### 1.1 Agent 与 worktree 交接合同

| 阶段 / 角色 | 书面输入 | 允许输出 | 明确禁止 |
| --- | --- | --- | --- |
| Lead / 集成 Agent（1–3、6–8） | 已登记需求、批准方案、冻结接口、缺陷和前序证据 | 串行集成、共享合同/migration 审查、完整回归、台账和验收记录 | 跳过测试/Owner 门禁，或将局部测试表述为真实飞书成功 |
| 实现 Agent（3） | Lead 冻结的需求、方案、接口、失败测试和代码快照 | 独立 worktree 的最小代码/测试变更 | 修改共享 migration 编号、secret、feature/kill switch、Dev App、scheduler/bridge、真实飞书设置或发布 |
| **新的 Test-Plan Agent（4）** | 已冻结的实现快照、接口、风险清单和允许环境事实 | 独立 worktree 的测试策略、case matrix、预期副作用数、failure/rollback model、evidence template、未可测外部 Gate 列表 | 修改实现、共享 migration、secret、feature/kill switch、Dev App 配置、bridge/scheduler 或真实飞书设置 |
| **独立 QA/Test Agent（5）** | 冻结代码、经审阅的测试方案、允许的本地/隔离环境 | 独立 worktree 的实际命令、revision、环境、退出码、时长、结果、缺陷与剩余风险 | 擅自改共享配置/secret/开关，触发真实飞书/OA，或宣布 🥇 |
| Review Agent | 冻结方案、代码或测试方案 | 只读、证据化发现和 No-go/风险结论 | 修改代码/文档、tag、环境或服务 |

所有 Agent 只通过版本化文件、冻结接口、代码快照、命令结果和缺陷/证据记录交接，不共享未审阅的对话结论。Lead 是共享 contracts、migration 编号、secret、环境变量、Dev App、真实 scheduler/bridge、部署、回滚和真实飞书测试的唯一集成者。

## 2. Canonical FDEV 顺序与当前队列

`R1-dev` 是独立 Dev App/Bot 的**发布/验收 ring**，运行时使用 `FEISHU_RUNTIME_STAGE=r1-intake` 和后续独立 command/card gates；它不是新的 runtime-stage 字符串，也不是正式 R2。正式 R2 专指 `r2-draft-only` 的完整文件/材料流程。

`R0.5-manual-smoke` 仅是 [ADR-0008](../../../adr/0008-limit-local-lark-cli-to-vercel-integration-smoke.md) 的短期本机 `lark-cli` → Vercel 连通性标签：不改变 runtime stage、不打开业务 Gate 或 Bot 用户回复、不完成任何 FDEV，也不解除 FDEV-001 的 🥇 前置。

```text
FDEV-001 → FDEV-002 → FDEV-003A → FDEV-003B → FDEV-004A → FDEV-004B → FDEV-004C → FDEV-005 → FDEV-006 → FDEV-007 → FDEV-008
```

| ID | 单一风险/目标 | 当前步骤与状态 | 前置 🥇 | 允许范围 / 禁止副作用 | 第 4 步与 🥇 所需证据 | 直接后继 |
| --- | --- | --- | --- | --- | --- | --- |
| FDEV-001 | 可复现 Dev release baseline；无 `CP-RISK` 映射 | **2. 出方案**（2026-10-09）；v3 基线方案等待独立复审及用户/Release Owner 审阅 | 无 | 仅 baseline 方案；不创建 commit/tag、不部署、不配置 Dev App/secret、不启动 bridge/scheduler、不调用外部服务 | 新 Test-Plan Agent 的隔离测试方案、clean protected commit/tag、重复验证、三方 No-go/Go 与清理证据；目前均未满足 | FDEV-002 仅可由 🥇 后进入第 2 步 |
| FDEV-002 | `CP-RISK-001` durable long-connection ACK / transport（R0.5 excluded） | **1. 拿到需求**；已冻结 | FDEV-001 | 受支持 SDK runner、durable transport outbox、ACK/relay 合同；禁止材料、Base/Drive、OA；ADR-0008 的本机 `lark-cli` smoke 不计入本项 | 新 Test-Plan Agent + DB 不可写不 ACK、202 丢失、重连/restart、DLQ、独立 QA 证据 | FDEV-003A |
| FDEV-003A | `CP-RISK-002` effect timeout / lease fencing | **1. 拿到需求**；已冻结 | FDEV-002 | timeout、lease renewal/fencing、unknown 语义；禁止新的业务材料/OA | 新 Test-Plan Agent + hang/slow response、双 worker、旧 lease fencing、无盲重发证据 | FDEV-003B |
| FDEV-003B | `CP-RISK-003` effect hash/task/owner binding | **1. 拿到需求**；已冻结 | FDEV-003A | effect 完整性、task/revision/owner 重新绑定；禁止材料/OA | 新 Test-Plan Agent + hash/owner/task/revision 篡改均不调用 gateway 的证据 | FDEV-004A |
| FDEV-004A | `CP-RISK-004` unknown / DLQ 对账 | **1. 拿到需求**；已冻结 | FDEV-003B | 只读查询、受审计人工决策和受限 replay；禁止自动重发未知副作用 | 新 Test-Plan Agent + response lost、restart、operator replay/readback、审计证据 | FDEV-004B |
| FDEV-004B | `CP-RISK-005` health / metrics / runbook | **1. 拿到需求**；已冻结 | FDEV-004A | 私有健康检查、指标、告警和运行手册；禁止把健康端点暴露为业务入口 | 新 Test-Plan Agent + DB down、backlog、DLQ/unknown、scheduler failure、graceful drain 证据 | FDEV-004C |
| FDEV-004C | `CP-RISK-006` retention / redaction / RBAC | **1. 拿到需求**；已冻结 | FDEV-004B | 保留策略、脱敏、备份/RBAC checklist；禁止记录敏感 payload/凭据 | 新 Test-Plan Agent + redaction、retention、restore、least privilege 证据 | FDEV-005 |
| FDEV-005 | 独立 Dev 环境**预检**；无 `CP-RISK` 映射 | **1. 拿到需求** | FDEV-004C | 独立 App identity、PG、secret store、bridge host、scheduler、route/network、allowlist、kill switch 的配置就绪；**bridge 不消费真实事件** | 新 Test-Plan Agent + 配置/权限/网络/preflight 和默认关闭证据；零 Dev Bot 事件消费 | FDEV-006 |
| FDEV-006 | R1-dev Shadow → Dark task → card canary；无 `CP-RISK` 映射 | **1. 拿到需求** | FDEV-005 | 首个真实 Dev Bot 事件需求：Shadow、单测试者 Dark task、单用户 card、1–3 人 allowlist；无材料/OA | 新 Test-Plan Agent + 每个 gate 的真实受控证据、rollback drill、零材料/Base/Drive/OA 调用 | FDEV-007 |
| FDEV-007 | 正式 R2 draft-only；`CP-RISK-007` 与 `CP-RISK-008` 是其前置风险 | **1. 拿到需求**；后续独立发布 | FDEV-006 | `r2-draft-only` 下的受控文件、产物、renderer、Base/Drive 投影和两次确认；禁止 native OA | 新 Test-Plan Agent + object store、故障注入、完整材料 E2E、零 Approval create 证据 | FDEV-008 |
| FDEV-008 | R3 native OA canary；独立 Approval/SubmissionUnknown Gate | **1. 拿到需求**；禁止启动 | FDEV-007 | 隔离审批定义中的最小 native OA canary | 新 Test-Plan Agent + Approval create/readback、SubmissionUnknown 对账、kill switch/rollback、三方书面批准 | 无 |

## 3. FDEV-001：可复现 Dev release baseline

- **状态**：进行中；目前仍是第 2 步“出方案”，未进入开发、测试或 🥇。
- **当前方案**：[FDEV-001 v3 实施计划](../../../superpowers/plans/2026-10-09-fdev-001-dev-release-baseline.md)。该计划的两轮独立 Review 均为 No-go，v3 已把 runner 隔离、ignored-input 拒绝、closed manifest 与 evidence-volume 合同具体化；仍等待第三轮独立复审及用户/Release Owner 审阅。
- **候选证据入口**：[FDEV-001 Dev release baseline 候选清单](../../records/durable-control-plane/fdev-001-dev-release-baseline-v1.md)。该文件是空字段、默认 No-go 的模板，不是 release baseline、clean commit/tag 或 🥇 记录。
- **Owner / Lead**：Lead / Release Owner（待指定实际签字人）。
- **依赖 / 后继**：无前置；仅在 FDEV-001 🥇 后，FDEV-002 可从第 1 步进入第 2 步。

### 1. 拿到需求

- **问题**：durable foundation 位于未提交工作区；没有从 clean checkout 重复获得的 release ref、依赖/migration 指纹和日期化验证证据，不能安全作为 Dev 环境、bridge 或 canary 输入。
- **成功标准**：有且仅有一个受保护 annotated tag 对应的 clean checkout baseline，记录 commit、工具链、lockfile/migration SHA-256、脱敏命令结果和清理结论，且可重复执行规定验证。
- **非目标**：不创建或推送 commit/tag（除非用户明确授权）、不部署、不启动 bridge/scheduler、不配置 Dev App/secret、不调用 Feishu/Approval/Base/Drive/object storage/AI/renderer；command/card/native-submit feature 保持关闭，legacy “拍小宝”不变。

### 2. 出方案

- **方案/失败/回滚语义**：以 v3 计划为准：必须由受保护 ref 的 fresh detached clone 验证；no-egress 与 PostgreSQL-only 固定 Docker lane、closed manifest、new evidence volume 和 source/scratch 扫描任一缺失均 No-go。回滚只是销毁 disposable clone/scratch/container/network/volume/test schema，并保持全部 feature 关闭，不得把未部署写成运行回滚。
- **共享合同/migration/配置**：计划中的 baseline runner/manifest/test 资产不变更三源 domain、runtime gate、bridge 或 migration；实际实施前仍须完成方案审阅。
- **审阅门禁**：用户/Release Owner 未审阅前，Step 3–7 不得开始或填为完成。

### 3. 开发

- **状态**：未开始。v3 计划列出的代码、测试和文档只是拟议范围，不是已存在的 release artifact。
- **集成顺序**：将来由 Lead 串行集成；不得与 FDEV-002+ 或真实 Dev 环境操作并行混入。

### 4. 出测试方案

- **硬交接**：实现冻结并经独立 source review 后，必须由一名新的 Test-Plan Agent 在独立 worktree 产出正式方案；开发期 unit/regression 结果只能作为 Step 3 反馈，不能替代 Step 4。
- **预期范围**：fixed Docker two-lane、source scan、closed manifest/evidence volume、default-closed、clean tagged checkout、three-owner acceptance；FDEV-001 不含 HTTP-worker 或 Dev Bot 测试。

### 5–8. 测试、修复、🥇与后继

- **测试**：未开始；没有受保护 commit/tag、正式 Docker policy 或可接受的 clean-baseline evidence。
- **Bug**：未进入正式测试，暂无已登记 Bug。
- **🥇**：未验收 / No-go；缺 Requirement Owner、工程 QA、Runtime/Release Owner 三方签字和 rollback/cleanup 证据。
- **后继**：只有 🥇 后，FDEV-002 才可进入第 2 步；FDEV-003A–FDEV-008 保持第 1 步。

## 4. 已完成基础与未证明边界

以下是 FDEV-001 的输入，不等于 FDEV-001 🥇，也不解除后续风险：

- durable ingress、PostgreSQL receipt/outbox、command intake、task/audit/effect transaction、lease/DLQ 与 tick endpoint 已有默认关闭的代码基础；
- 本地 PostgreSQL disposable-schema 已验证 migration repeatability、delivery 去重、同 owner 并发、`SKIP LOCKED`、stale lease fencing、fake card 成功路径与 `outcome_unknown` 后的 restart 不重发；
- 当前 `/OA优惠券提报` command-only slice 只能创建/恢复 `Collecting` task 和 intake-card effect，不能处理文件或 card action；
- ADR-0008 允许当前 `lark-cli` → Vercel 路径只做 R0.5 手工 transport smoke；它不验证 durable ACK/retry/reconnect，不完成任何 FDEV，且所有业务 Gate 仍必须关闭；
- durable bridge ACK、outbound timeout/lease renewal、effect integrity binding、unknown/DLQ 对账、运维观测、retention/RBAC、对象存储和真实 Dev Bot 均未证明；
- `FEISHU_COUPON_THREE_SOURCE_R2_ENABLED`、native-submit 和完整 R2 能力必须保持关闭。

## 5. 本轮文档治理结论

2026-10-09 已完成 proposal 层的术语和依赖整理：`R1-dev` 只表示 pre-R2 command-to-card 验证 ring；FDEV-003/004 已拆为独立的 `A/B/C` 子需求；FDEV-005 只做环境预检且不消费真实事件；FDEV-006 才是首个 Dev Bot event canary。该文档治理本身不推进 FDEV-001 的步骤、不创建 candidate ref，也不构成任何 🥇。

## 6. 需求执行模板

新增需求时复制以下区块。Lead 只能在实际完成相应步骤后更新状态和链接。

```markdown
## FDEV-XXX：<需求名称>

- **风险/目标映射**：
- **状态**：进行中 / 阻断 / 🥇 已验收 / 已取消
- **当前步骤**：1–8（日期）
- **Owner / Lead**：
- **参与 Agent 与隔离边界**：
- **依赖 / 后继**：

### 1. 拿到需求
- 业务/技术问题：
- 成功标准：
- 允许与禁止副作用：

### 2. 出方案
- 方案/ADR 链接：
- 数据、授权、幂等、失败、回滚：
- 共享合同/migration/配置变更：

### 3. 开发
- 修改文件/服务：
- Agent 分工和集成顺序：
- 实现冻结 revision：

### 4. 出测试方案（新的 Test-Plan Agent）
- 输入与独立 worktree：
- case matrix / side-effect count / failure-rollback model：
- 本地、PostgreSQL、HTTP、Dev Bot 证据与未可测外部 Gate：

### 5. 测试（独立 QA/Test Agent）
- revision、环境、实际命令、退出码、时长：
- 通过项 / 未覆盖项：
- 缺陷与剩余风险：

### 6. 修复 Bug
| Bug ID | 复现/影响 | 修复 | 回归证据 | 状态 |
| --- | --- | --- | --- | --- |

### 7. 🥇 验收完成
- 结论：Go / No-go
- Requirement Owner / 工程 QA / Runtime-Release Owner：
- 回滚或无部署清理已验证：
- 剩余风险与观察期：

### 8. 下一个需求
- 可启动 ID：
- 前置条件：
```

## 7. 发布纪律

1. 任何 Agent 完成代码都不等于需求完成；必须经过新的 Test-Plan Agent、独立 QA/Test、Bug loop 和三方 🥇。
2. 不得为赶进度跳过 FDEV-002 至 FDEV-004C 的可靠性工作而打开 Dev App feature flag。
3. 不得从脏工作区部署，也不得由多个 Agent 独立修改 migration、secret、飞书 App、环境或 bridge/scheduler。
4. 每次真实飞书操作前，Lead 必须核验当前阶段、allowlist、kill switch、值守人和回滚路径。
5. 每次 🥇 后，更新风险清单、验证记录、runbook、readiness checklist 与本台账；随后才可将直接后继从第 1 步推进到第 2 步。
