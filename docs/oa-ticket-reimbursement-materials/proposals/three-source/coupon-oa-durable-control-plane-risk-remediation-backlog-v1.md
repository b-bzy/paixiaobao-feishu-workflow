# 优惠券三源提报：耐久控制面风险整改开发清单 v1

> **状态**：已冻结为 **P1** 耐久控制面与正式运行的需求清单；不代表 R1-dev、正式 R2 或 R3 已开放，也不是 P0 最快 Bot POC 的前置。
>
> **日期**：2026-10-09
>
> **范围**：P1 中解决 command-only durable intake 在进入受控 Feishu 试点前的 transport、外部副作用、可观测性与数据治理风险。P0 最快 Bot POC 使用独立的 direct HTTP、单用户、native-off 路线；不得把本清单的 FDEV 前置误写为 P0 阻塞，也不得把 P0 成功当作本清单任何风险已解决。
>
> **权威生命周期**：[飞书开发版需求与进度台账](coupon-oa-feishu-dev-requirements-tracker-v1.md)。本清单定义风险和验收，不得覆盖台账中的步骤、🥇 或发布结论。
>
> **现有验证输入**：[R2 foundation 验证记录](../../records/durable-control-plane/coupon-r2-foundation-verification-2026-10-09.md) · [本地命令验收用例](../../records/durable-control-plane/coupon-command-intake-local-acceptance-test-case-v1.md)

## 1. Canonical CP-RISK → FDEV 映射

每一个 `CP-RISK-*` 只能由下表中一个 FDEV/FDEV 子需求获得 🥇。每个对应 FDEV 必须依次完成需求 → 方案 → 开发 → **新的 Test-Plan Agent（第 4 步）** → 独立 QA/Test → Bug 修复 → 🥇；已有本地 PostgreSQL foundation 只能作为输入证据，不能跳过这些门槛。

| 风险 | 唯一交付需求 | 当前状态 | 🥇 的额外硬门槛 |
| --- | --- | --- | --- |
| CP-RISK-001 durable long-connection ACK / transport | FDEV-002 | 第 1 步；受 FDEV-001 阻断；R0.5 smoke 不计入 | Test-Plan Agent + SDK ACK/DB failure/202 丢失/restart/DLQ 的隔离与受控证据 |
| CP-RISK-002 effect timeout / lease fencing | FDEV-003A | 第 1 步；受 FDEV-002 阻断 | Test-Plan Agent + timeout/hang/lease renewal/旧 lease fencing/no resend 证据 |
| CP-RISK-003 effect hash/task/owner binding | FDEV-003B | 第 1 步；受 FDEV-003A 阻断 | Test-Plan Agent + task/revision/owner/hash 篡改 fail-closed 证据 |
| CP-RISK-004 unknown / DLQ reconciliation | FDEV-004A | 第 1 步；受 FDEV-003B 阻断 | Test-Plan Agent + 可见性、受审计人工决策/replay/readback 证据 |
| CP-RISK-005 health / metrics / runbook | FDEV-004B | 第 1 步；受 FDEV-004A 阻断 | Test-Plan Agent + DB/backlog/DLQ/unknown/scheduler failure 告警与 runbook 证据 |
| CP-RISK-006 retention / redaction / RBAC | FDEV-004C | 第 1 步；受 FDEV-004B 阻断 | Test-Plan Agent + 脱敏、保留、restore、least privilege 证据 |
| CP-RISK-007 controlled object storage | FDEV-007 的正式 R2 前置 | 第 1 步；受 FDEV-006 阻断 | Test-Plan Agent + immutable object/hash/access/outage/restore 证据 |
| CP-RISK-008 PostgreSQL fault injection | FDEV-007 的正式 R2 前置 | 第 1 步；受 FDEV-006 阻断；部分本地 foundation 已有 | Test-Plan Agent + rollback/CAS/effect recovery/retry-DLQ fault-injection 证据 |

FDEV-001 是所有风险项的 release-baseline 前置；FDEV-005 是环境预检且不消费真实事件；FDEV-006 是第一项可接收真实 Dev Bot event 的 R1-dev canary。二者不替代任何 `CP-RISK-*` 的交付和 🥇。ADR-0008 的 `R0.5-manual-smoke` 只能验证本机 `lark-cli` → Vercel 的受限连通性，不完成 CP-RISK-001，也不允许业务副作用或 Bot 用户回复。

## 2. 现状与目标

本地 PostgreSQL 已验证：migration repeatability、delivery 去重、transactional task/effect intent、同 owner 并发 create-or-resume、`SKIP LOCKED`、expired/stale lease fencing、fake card 成功路径及 `outcome_unknown` 后的新 worker/连接不重发。

尚未解除的根因集中在：

```text
Feishu long connection 的 ACK/转发可靠性
→ 外部 card effect 的 timeout / lease 生命周期
→ payload/task/owner 的外部 effect 完整性
→ 不确定结果的对账与人工恢复
→ backlog/DLQ/unknown 的运行观测
→ 持久 payload/effect 的保留、脱敏与访问控制
```

本清单的完成标准不是“能发一张卡”，而是：任何 delivery、worker、网络或进程故障都能被**安全接收、受控重试、停止并对账，或被运营人员定位**，且不会重复创建业务任务、重复发送未知外部副作用或放开原生 OA。

## 3. 范围与硬边界

- `/OA优惠券提报` 在 R1-dev 仍只允许 command-only `Collecting` task 与 intake-card effect；`R1-dev` 使用 `r1-intake`，不是 `r2-draft-only`。
- native OA、Approval、Base/Drive、来源文件下载、对象存储写入、renderer、AI 均不属于 R1-dev 可执行副作用。
- 所有新增工作默认 fail closed；任何健康检查、鉴权、签名、租约或外部结果不明都不得降级为“成功”。
- 真实 Feishu **业务副作用**只可在 FDEV-006、独立 test Bot、具名 allowlist、受控 scheduler 和运行 Owner 值守条件下发生；ADR-0008 的 R0.5 仅允许 Gate 全关闭的 transport smoke。
- 正式 R2 文件/material flow 仅可在 FDEV-007 🥇 后使用 `r2-draft-only`；R3 不属于本清单。

## 4. 优先级风险需求

### P1-A：入站可靠性与外部副作用 fencing

| ID | 需求 / 开发项 | 主要改动 | 验收标准 | 必须新增测试 | 状态 |
| --- | --- | --- | --- | --- | --- |
| CP-RISK-001 | 替换 `lark-cli` 开发 bridge，建立 durable transport adapter | 新建受支持 SDK bridge role；在 source ACK 前写 transport outbox；relay 对每次 HTTP retry 重新签名；支持 backoff、drain、DLQ | DB 不可写时 source 不得 ACK；HTTP 202 丢失时稳定 delivery 可重送且只有一个 receipt/job；bridge 崩溃恢复后不丢消息 | SDK ACK contract、断网、202 丢失、重连、bridge restart、重复 callback | FDEV-002 未开始 / R1-dev No-go |
| CP-RISK-002 | 为 card effect 引入 HTTP timeout、lease renewal 与运行上限 | `sendFeishuCard` 使用 `AbortSignal`；token/card 请求配置小于 lease 的硬超时；effect handler 执行期间 renew lease，或超时后转 `outcome_unknown` | 任意外部请求不得超过 lease；旧 lease 不能写成功/失败；超时不允许第二 worker 盲发 | 慢响应、fetch hang、lease expiry、两 worker、Feishu UUID 幂等证明 | FDEV-003A 未开始 / R1-dev No-go |
| CP-RISK-003 | 强化 effect intent 的 payload 与 owner 绑定 | claim 时验证 `request_sha256`；从 `coupon_tasks.owner_open_id` 获取唯一 receiver；要求 task/revision/payload/semantic key 一致 | 被篡改 hash、owner 或 task ID 的 effect 进入 DLQ，绝不调用 gateway | hash mismatch、owner mismatch、task closed/revision changed、DB corruption fixture | FDEV-003B 未开始 / R1-dev No-go |

### P1-B：可恢复性、运维与数据治理

| ID | 需求 / 开发项 | 主要改动 | 验收标准 | 必须新增测试 | 状态 |
| --- | --- | --- | --- | --- | --- |
| CP-RISK-004 | `outcome_unknown` 与 effect DLQ 对账闭环 | 建立只读列表、原因/时间/semantic key 查询、受审计的人工决策与受限 replay；针对 card 定义可验证的 Feishu UUID 查询策略 | unknown/DLQ 在阈值内可见并告警；任何 replay 记录操作者/原因；未知结果不得自动重发 | response lost、worker restart、operator replay、重复 replay、readback found/not found | FDEV-004A 未开始 |
| CP-RISK-005 | worker/bridge 健康、指标和运行手册 | 私有 `/livez`、`/readyz`、backlog age、retry、DLQ、unknown、lease reclaim、tick skipped 指标；阈值告警和 owner runbook | DB 不可写、queue 超龄、DLQ/unknown 增长、scheduler 失效均能阻止 ready 并触发告警 | DB down、lease lost、backlog threshold、tick unauthorized/timeout、graceful drain | FDEV-004B 未开始 |
| CP-RISK-006 | 数据保留、脱敏和访问控制 | 定义 receipt/payload/audit/effect retention；按策略清理；日志只记录 correlation/hash/枚举；托管 PostgreSQL encryption/backup/RBAC checklist | payload、完整 open ID、token、file key 不进入日志；保留期作业可重跑且不破坏审计关联 | log redaction、retention job、backup/restore、least-privilege migration role | FDEV-004C 未开始 |

### P1-C：正式 R2 文件链路前置条件

| ID | 需求 / 开发项 | 主要改动 | 验收标准 | 必须新增测试 | 状态 |
| --- | --- | --- | --- | --- | --- |
| CP-RISK-007 | 解决受控对象存储与本地演练阻断 | 修复可信 MinIO/registry 来源或接入批准的托管 S3；实现 immutable object adapter、bucket policy、encryption、key namespace | hash 不匹配/重复 key/权限不足均 fail closed；来源与标准产物可按 revision 重放读取 | put/get hash、并发 key、access denied、object-store outage、restore drill | FDEV-007 前置 / R2 No-go |
| CP-RISK-008 | 完成真实 PostgreSQL 故障注入矩阵 | 扩展 disposable-schema integration suite，覆盖 command transaction rollback、task revision CAS race、effect lease recovery、effect retry/DLQ | 任一失败都不留下半成 task/audit/effect/outcome；恢复后满足一次性语义 | DB trigger rollback、connection kill、effect retry max attempts、stale effect completion | FDEV-007 前置；部分 foundation 已验证，完整风险未开始 |

## 5. 实施顺序与 Gate

```text
FDEV-001 🥇 release baseline
  → FDEV-002 / CP-RISK-001
  → FDEV-003A / CP-RISK-002
  → FDEV-003B / CP-RISK-003
  → FDEV-004A / CP-RISK-004
  → FDEV-004B / CP-RISK-005
  → FDEV-004C / CP-RISK-006
  → FDEV-005 环境预检（零真实事件）
  → FDEV-006 R1-dev Shadow → Dark task → card canary
  → FDEV-007 / CP-RISK-007 + CP-RISK-008 → 正式 R2
  → FDEV-008 → R3
```

- **R1-dev real-event Go 条件**：FDEV-001 至 FDEV-005 均 🥇；FDEV-006 的每个 Shadow/Dark/card gate 单独记录真实 Dev Bot、故障和 rollback 证据；`FEISHU_COUPON_THREE_SOURCE_R2_ENABLED` 仍默认 `false`。
- **R2 file/material Go 条件**：FDEV-006 🥇，且 FDEV-007 内 CP-RISK-007、CP-RISK-008 和完整材料链路分别取得证据；对象存储、来源文件、renderer 和 Drive/Base projection 不得以 R1-dev 证据替代。
- **R3 native-submit Go 条件**：不属于本清单；必须另行完成 Approval create/readback、`SubmissionUnknown` reconciliation 与 canary 评审。

## 6. 每项交付物检查表

每个 `CP-RISK-*` 对应 FDEV 在 🥇 前必须同时具备：

- [ ] 需求/ADR 或设计文档更新，写清失败语义、所有权和回滚；
- [ ] server-side fail-closed 配置与 `.env.example` 说明；
- [ ] 实现冻结后由**新的 Test-Plan Agent**产出 case matrix、预期副作用数、failure/rollback model 与不可测外部 Gate；
- [ ] 独立 QA/Test Agent 的 unit + PostgreSQL integration + 适用 HTTP/bridge/Dev Bot/fault-injection 测试；
- [ ] 不产生真实 Feishu/OA 副作用的默认测试路径；
- [ ] scoped Biome、`pnpm typecheck:server`、`pnpm test:control-plane`、适用的显式 PostgreSQL suite 通过；
- [ ] metrics、日志脱敏、runbook、DLQ/unknown 运营路径（适用项）；
- [ ] 验证记录注明已覆盖证据与仍未证明的外部 Gate；
- [ ] rollout/rollback Owner 签字后，才允许切换对应 feature flag。

## 7. 非目标与禁止项

- 不以“先打开 feature flag、后补可靠性”替代本清单。
- 不使用内存 Map、card UUID 或 Base 字段代替 PostgreSQL receipt/effect/task 约束。
- 不因卡片发送、Approval 创建或请求超时而自动创建新的 provider UUID 或第二笔业务任务。
- 不将 `outcome_unknown` 自动标记为成功、失败或可安全重发。
- 不把 R1-dev、R2 foundation 或本地 PostgreSQL 证据表述为真实 Feishu/OA 已打通。
