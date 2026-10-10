# 飞书开发版：顺序化需求交付治理设计

**日期：** 2026-10-09  
**状态：** 文档治理已实现；FDEV-001 保持其独立的第 2 步方案审阅状态，尚未进入开发或 🥇  
**范围：** `docs/oa-ticket-reimbursement-materials/proposals/three-source/` 中的三源飞书开发、发布和验证计划

## 1. Context

当前三源 proposal 同时使用了“R2-dev command-to-card canary”和“R2 draft-only 文件链路”。前者只验证命令、task 和开发验收卡，后者才允许三源材料、标准产物、截图和两次确认。这会导致错误选择 `r2-draft-only` runtime stage、伪造 object-store 前置条件，或错误将 command-to-card 验证表述为完整 R2。

此外，需求台账中的 FDEV-003/FDEV-004 分别捆绑多个风险项，和“每个需求完成需求→方案→开发→测试方案→本地测通→🥇后再做下一个”的交付节奏不一致。FDEV-005 又同时包含 Dev 环境准备和 R1 rehearsal，形成“先完成 rehearsal 才能接收真实事件、但 rehearsal 本身需要真实事件”的循环依赖。

本设计的目标是把这些计划整理为一个单一的、可审计的需求队列。它不开放任何 feature flag、不部署 Dev App、不发送真实 Feishu 卡片，也不修改业务/OA行为。

## 2. Goals and non-goals

### Goals

1. 固定 `R1-dev`、正式 `R2` 和 `R3` 的不可混淆定义。
2. 将每个可交付风险项变为能独立完成 🥇验收的需求。
3. 将“新的测试 Agent”固定在开发完成后的测试方案阶段，明确 worktree 和集成边界。
4. 将 FDEV-001 定义为所有后续开发和测试的可复现 baseline，消除脏工作区/版本漂移风险。
5. 让 tracker、release plan、risk backlog、worker design/test plan、proposal index 使用同一术语、依赖关系和验收状态。

### Non-goals

- 不实现 durable bridge、effect timeout、object storage、Base/Drive、文件处理或 Approval。
- 不改动 `FEISHU_RUNTIME_STAGE` 的现有枚举，不引入 `r1-dev` 运行时字符串。
- 不提交、部署、创建云资源、修改 secret 或启用真实 Feishu 事件。
- 不把 R1-dev 或本地 PostgreSQL 证据写作正式 R2、Feishu E2E 或 native OA 成功。

## 3. Canonical terminology

| 名称 | 说明 | 运行时映射 | 允许副作用 |
| --- | --- | --- | --- |
| R0 | 本地 domain、fake gateway、disposable PostgreSQL 测试 | `local` | 无真实 Feishu/OA |
| R1-dev | 独立 Dev App/Bot 的 Shadow、Dark task、command-to-card canary | `r1-intake`，另有 Dev command/card feature gate | receipt/outbox/task/audit/开发验收卡；不允许文件或 OA |
| R2 | 正式 draft-only 三源文件链路 | `r2-draft-only` | 受控文件、标准产物、草稿/投影；禁止 native OA |
| R3 | 原生 OA canary | `r3-native-canary` | 独立审批定义中的单次受控 OA |

`R1-dev` 是发布和验收 ring，不是新的 `FEISHU_RUNTIME_STAGE`。R1-dev 的 command feature 未来必须独立于正式 R2 feature gate，以免 object-store/renderer 尚未就绪时误用 `r2-draft-only`。

## 4. Requirement structure and sequencing

FDEV 是发布里程碑；每一个字母子项是必须独立经过八步并获得 🥇 的需求。后继需求的“拿到需求”可以记录，但不得进入“开发”。

```text
FDEV-001  可复现 Dev release baseline
  → FDEV-002   CP-RISK-001 durable bridge / ACK
  → FDEV-003A  CP-RISK-002 effect timeout + lease fencing
  → FDEV-003B  CP-RISK-003 effect hash/task/owner binding
  → FDEV-004A  CP-RISK-004 unknown/DLQ reconciliation
  → FDEV-004B  CP-RISK-005 health/metrics/runbook
  → FDEV-004C  CP-RISK-006 retention/redaction/RBAC
  → FDEV-005   独立 Dev 环境预检（不消费真实事件）
  → FDEV-006   R1-dev Shadow → Dark task → card canary
  → FDEV-007   正式 R2 draft-only 文件链路
  → FDEV-008   R3 native OA canary
```

### FDEV-001 definition

FDEV-001 是可复现 baseline，不是“顺手提交当前工作区”。它需要产出：

- 固定 revision、依赖锁、migration SHA-256、Node/pnpm/Docker 镜像版本的 release manifest；
- 从 clean checkout 可重跑的 typecheck、full Vitest、PostgreSQL integration、build 命令及结果；
- 不连接 Feishu、不改变任何 feature gate 的证据；
- 明确的 baseline commit/tag 候选和发布 Owner 审阅记录。

FDEV-001 🥇前，不得让 FDEV-002 及后续需求使用“当前未提交代码”作为发布或测试基线。

### FDEV-005 circular dependency resolution

FDEV-005 被定义为 **Dev 环境预检**：独立 App ID、数据库、secret store、bridge host、scheduler、route/network policy 和 kill switch 都配置完成，但 bridge 不消费真实 Feishu 事件。

FDEV-006 才是第一个接收真实 Dev Bot 事件的需求，按如下门槛推进：

```text
Shadow（command/card 均关闭）
  → Dark task（仅一名工程测试者，card 关闭）
  → 单用户开发验收卡
  → 1–3 名 Dev allowlist
```

因此 FDEV-005 不再依赖 R1 rehearsal，循环被移除。

## 5. Per-requirement delivery workflow

每一个 FDEV 或子需求固定遵循：

```text
1. 拿到需求
2. 出方案
3. 开发
4. 出测试方案（新 Test-Plan Agent）
5. 本地/隔离环境测试
6. 修复 Bug
7. 🥇 验收完成
8. 开发下一个需求
```

### Agent and worktree contract

| 阶段 | 责任方 | 允许工作 | 禁止工作 |
| --- | --- | --- | --- |
| 1–3 | Lead + 实现 Agent | 需求、方案、代码、migration/contract 设计 | 不启用真实 Feishu、不得自行宣布 🥇 |
| 4 | 新 Test-Plan Agent，独立 worktree | 仅输出测试策略、case matrix、fault model、evidence template | 不修改共享 migration、feature/kill switch、secret、线上配置 |
| 5 | QA/Test Agent，独立 worktree | 增加/执行测试、形成结果和缺陷报告 | 不将 mock/local 结果表述为真实 Feishu 成功 |
| 6–7 | Lead 集成 | 合并测试、修复、完整回归、更新台账与验证记录 | 不跳过 Owner/QA/运行审阅 |

Lead 是共享 contracts、migration 编号、环境变量、Dev App、真实 scheduler/bridge、部署、回滚的唯一集成者。所有 Agent 的提交在合并前必须基于同一 FDEV baseline。

## 6. Required documentation changes

| 文档 | 变更 |
| --- | --- |
| `coupon-oa-feishu-dev-requirements-tracker-v1.md` | 将 FDEV-003/FDEV-004 拆成独立子需求；重写 FDEV-005/FDEV-006 的边界、步骤和 🥇条件；记录每项测试 Agent 交接字段。 |
| `coupon-oa-feishu-dev-command-intake-release-plan-v1.md` | 将 R2-dev 改为 R1-dev；使 release Gate 与 FDEV 顺序无循环；明确 R1-dev 使用 `r1-intake` 和独立 command/card gate。 |
| `coupon-oa-durable-control-plane-risk-remediation-backlog-v1.md` | 将 CP-RISK 映射到唯一 FDEV 子需求，并把每项的测试 Agent 作为第 4 步硬门槛。 |
| `coupon-oa-durable-command-intake-worker-design-v1.md` | 修订 PostgreSQL 已验证的事实，移除已过时的“仍未集成”表述；明确 R1-dev 不等于完整 R2。 |
| `coupon-oa-durable-command-intake-worker-test-plan-v1.md` | 区分已验证 PostgreSQL evidence 与待做 HTTP/bridge/Dev Bot rehearsal；补测试 Agent 输入/输出和 evidence 约束。 |
| `coupon-oa-feishu-unified-skill-upgrade-plan-v1.md` | 统一 W/Ring 名称，防止 command-only canary 被解释为完整 R2。 |
| `proposals/README.md` / `docs/requirements-backlog.md` | 更新索引和跨产品排期链接。 |

## 7. Error handling and release controls

- 环境、签名、bridge、scheduler、lease、feature gate、allowlist、task/revision/hash 任一不满足时必须 fail closed。
- R1-dev 的 card effect 发生 timeout 或未知结果时必须停在 `outcome_unknown` / DLQ，对账完成前禁止重发。
- 任何需求发现范围、接口、共享 contract、migration 或安全边界变化时，状态回到第 2 步“出方案”。
- 任何测试失败或未覆盖关键故障时，状态回到第 6 步“修复 Bug”，不能推进 🥇或后继需求。

## 8. Verification and acceptance

本次文档治理完成后，验证：

1. 搜索 `R2-dev`，不得再作为 command-to-card release ring 使用。
2. 每个 CP-RISK 恰好映射一个 FDEV/FDEV 子需求，且没有多个“当前正在开发”的依赖需求。
3. FDEV-005 不要求消费真实事件；FDEV-006 才允许 R1-dev Dev Bot rehearsal。
4. 所有测试计划将 Test-Plan Agent 置于实现冻结之后，且明确零真实 Feishu/OA 默认路径。
5. Markdown links、`git diff --check`、full Vitest 和 server typecheck 通过。
6. 发布 Owner 审阅 FDEV-001 baseline 清单后，才能开始 FDEV-001 的实际开发与测试 Agent 交接。
