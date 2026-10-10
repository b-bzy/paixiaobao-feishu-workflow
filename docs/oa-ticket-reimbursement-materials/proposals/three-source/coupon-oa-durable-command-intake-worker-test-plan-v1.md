# 三源优惠券提报：持久 Command-Intake Worker 测试方案 v1

> **状态**：测试设计待按具体 FDEV 实现冻结后交由新的 Test-Plan Agent 细化。command-only ingress / worker / effect 的 unit、SQL-contract 与本地 PostgreSQL disposable-schema foundation 已实现并有自动化证据；HTTP rehearsal、durable bridge ACK、常驻 worker、真实 card 行为、R1-dev Dev Bot 与正式 R2 均未验证。
>
> 本文定义 command-only 风险需求的验证门槛；已实现代码或本地 PostgreSQL 结果不代表 R1-dev、R2 或 OA 已开放。
>
> **日期**：2026-10-09
>
> **关联**：[需求台账](coupon-oa-feishu-dev-requirements-tracker-v1.md) · [风险整改清单](coupon-oa-durable-control-plane-risk-remediation-backlog-v1.md) · [持久 Command-Intake Worker 设计 v1](coupon-oa-durable-command-intake-worker-design-v1.md) · [R2 foundation 验证记录](../../records/durable-control-plane/coupon-r2-foundation-verification-2026-10-09.md)

## 1. 测试目标与不可推断范围

目标是在不接触业务材料、Base、Drive、renderer 或 Approval 的前提下，证明 durable command-intake 能可靠地将一笔**已验签、allowlist 单聊**的 `/OA优惠券提报` delivery 转换为：

1. 一笔创建或恢复的 `Collecting` 三源 task；
2. 一条持久、可幂等对账的 intake-card effect 意图；
3. 一条可审计的 delivery outcome。

R1-dev 是 pre-R2 的 command/card ring，使用 `FEISHU_RUNTIME_STAGE=r1-intake` 与独立 Dev command/card gates。它**不得**访问文件、Base、Drive、对象存储、renderer、AI、Approval 附件或 OA。正式 R2 才是 `r2-draft-only` 的完整材料流程。

所有测试通过也**不能**证明真实飞书租户可用、bridge 满足 source-ACK 契约、文件收集已完成、R2 可开放、截图/产物可生成或 OA 可以创建。

## 2. 每个 FDEV 的 Test-Plan / QA 交接合同

实现 Agent 的开发期 unit/regression 只属于第 3 步。每个 FDEV/FDEV 子需求在实现与接口冻结后，必须进入以下独立交接：

| 步骤 | 责任方与隔离 | 必须输入 | 必须输出 | 禁止 |
| --- | --- | --- | --- | --- |
| 4. 出测试方案 | **新的 Test-Plan Agent，独立 worktree** | frozen revision、设计、CP-RISK/FDEV 边界、允许环境事实 | case matrix、预期 side-effect count、failure/rollback model、local/PostgreSQL/HTTP/Dev-Bot evidence、未可测外部 Gate | 修改实现、共享 migration、secret、feature/kill switch、Dev App、bridge/scheduler 或真实 Feishu 设置 |
| 5. 测试 | **独立 QA/Test Agent，独立 worktree** | frozen code、经审阅测试方案、允许的测试环境 | 实际命令、revision、环境/版本、退出码、时长、结果、Bug、剩余风险和证据路径 | 擅自改共享环境或开关、调用未授权外部服务、将 mock/local 表述为真实 Feishu 成功 |
| 6–7. 修复/🥇 | Lead + Owners | QA 结果、Bug 和复测结果 | 修复整合、回归、三方 No-go/Go | 跳过未执行用例或将未证明外部 Gate 标为通过 |

Test-Plan Agent 的产物是第 4 步硬门槛，QA/Test 的实际结果是第 5 步硬门槛；两者都不能单独推进 🥇。精确的当前序列和前置 🥇 见[需求台账](coupon-oa-feishu-dev-requirements-tracker-v1.md)。

## 3. 已验证的本地 PostgreSQL 证据与未验证边界

| 结论 | 证据状态 | 具体范围 |
| --- | --- | --- |
| migration repeatability | 已验证 | disposable schema 重复应用 checked-in `0001`–`0004` migration；migration runner 再执行也受 hash/版本保护。 |
| delivery/task/effect 原子性 | 已验证 | delivery 去重、receipt → worker → task/audit/effect/outcome transaction、同 owner 并发 create-or-resume。 |
| PostgreSQL 并发与 lease | 已验证 | 真实 `FOR UPDATE SKIP LOCKED` claim race、expired lease reclaim、stale lease completion/retry fencing。 |
| effect 安全基础 | 已验证 | fake card success；`outcome_unknown` 后以新数据库连接/new worker 模拟重启，不自动重发。 |
| durable bridge ACK / source transport | 未验证 | 当前 `lark-cli` bridge 不是 durable transport；尚未证明 DB durable write 前不会 ACK。 |
| HTTP/worker rehearsal 与长期运行 | 未验证 | 未以隔离进程验证 ingress restart、真实 scheduler、timeout/lease renewal 或 bridge recovery。 |
| 真实 card 行为 / Feishu UUID 查询 | 未验证 | fake gateway 不能证明 provider timeout、response loss 或外部幂等行为。 |
| R1-dev Dev Bot / 正式 R2 | 未验证 | 未接收真实 Dev Bot event；未访问文件、Base/Drive、对象存储、renderer 或 OA。 |

这些已验证结果是后续 FDEV 的输入。它们不解除 CP-RISK-001 至 CP-RISK-008，也不替代新的 Test-Plan Agent 与 QA/Test evidence。

## 4. 测试层级与环境

| 层级 | 环境 | 允许依赖 | 必须证明 | 不能替代 |
| --- | --- | --- | --- | --- |
| Unit | Node/Vitest + fake ports | 内存 repository、固定 clock/ID | normalizer、gate、状态与错误分类 | PostgreSQL 锁/事务、真实发送 |
| SQL contract | Vitest + recording SQL executor | SQL 字符串/参数 | predicate、CAS、semantic key、lease 条件 | 数据库语义/迁移有效性 |
| PostgreSQL integration | disposable PostgreSQL 17 | 真实 migration/driver | FK、索引、JSONB、事务、并发、`SKIP LOCKED`、lease 回收 | 飞书/bridge E2E |
| HTTP/worker rehearsal | 本地隔离进程 + fake card gateway | durable ingress、worker composition | ACK、重启、replay、effect outbox | 真实飞书权限/生产运行 |
| R1-dev Dev Bot | 经批准的独立测试租户 | managed bridge、独立 Dev App/Bot | Shadow → Dark task → card canary 的受控命令流程 | 正式 R2 文件流或 native OA |
| 正式 R2 E2E | 经批准的材料/存储测试环境 | `r2-draft-only` 完整 adapter | 文件、产物、两次确认与零 native OA create | R3 原生 OA canary |

真实 PostgreSQL integration 必须使用显式 `CONTROL_PLANE_TEST_DATABASE_URL`、每例随机 disposable schema、checked-in migrations 与清理结果。当前 suite 已按这些规则完成部分实测；SQL contract 通过仍不得单独写作 PostgreSQL 通过。

## 5. 前置 fixture 与测试期禁止

### 5.1 必需 fixture

- 版本化 `feishu-delivery-v1` direct-message text payload；
- group / unknown chat、空 actor、空 message ID、错误 schema、hash 不符、重复 stable delivery ID 的变体；
- allowlisted 与非 allowlisted `open_id`；
- 固定 `Clock`、UUID/token generator、correlation ID；
- fake card effect gateway，默认记录请求但不联网；
- PostgreSQL test database 的每例独立 schema 或事务隔离；
- 仅含 task ID/revision/card purpose 的 effect payload；不使用真实文件、密钥或飞书 token。

### 5.2 测试期禁止

- 禁止调用 `sendFeishuCard()` 真实实现；
- 禁止 HTTP 调用 `open.feishu.cn`、Base、Drive、DeepSeek、renderer 或 Approval；
- 禁止 `POST /approval/v4/instances`；
- 禁止记录完整 raw payload、open ID、file key、secret 或附件字节；
- 禁止用本地 `lark-cli` 长连接代替 durable ingress/replay 测试；
- R1-dev suite 禁止文件、Base/Drive、对象存储、renderer、AI、Approval 附件与 OA；这些只属于 FDEV-007/R2 及更后阶段。

## 6. 用例矩阵

### A. Delivery 规范化与输入安全

| ID | 场景 | 预期 |
| --- | --- | --- |
| D01 | 合法 `feishu-delivery-v1`、p2p、精确命令 | 生成 command candidate，不触发外部副作用 |
| D02 | 旧命令、普通文本、状态提问 | `ignored`，不创建 task/effect |
| D03 | file/image/card action 等非文本 event | `ignored`，不创建 task/effect |
| D04 | schema/version/event type/stable ID/message ID/actor 缺失或非法 | `rejected`，写脱敏 outcome，无 task/effect |
| D05 | payload hash 与持久 receipt 不符 | `rejected`，不信任 payload |
| D06 | `chatType=group` 或 `unknown` | `rejected`，不允许以全局 ready flag 绕过 |
| D07 | 错误中包含业务文本、open ID、file key 或 secret | 测试日志捕获后断言不泄露原值 |

### B. Gate 与授权

| ID | 场景 | 预期 |
| --- | --- | --- |
| G01 | R1-dev command feature 缺失/false | `rejected`，零 task/effect |
| G02 | runtime stage 不是 `r1-intake`，或试图以 `r2-draft-only` 运行 command/card canary | `rejected`，零 task/effect |
| G03 | durable runtime 配置不完整 | fail closed，classification 可观测 |
| G04 | allowlist 格式非法/为空 | fail closed |
| G05 | actor 不在 allowlist | `rejected`，不暴露资源配置信息 |
| G06 | config 在 job retry 期间被关闭 | 重验后停止，既有 task 不被误改 |
| G07 | 被允许的 p2p actor | 仅允许进入 C01/C02 处理 |

### C. Task、delivery 与 effect 的原子性

| ID | 场景 | 预期 |
| --- | --- | --- |
| C01 | 首次有效命令 | 一笔 `Collecting` task、一条 audit、一条 intake effect、一个 handled outcome |
| C02 | 同 owner 再次有效命令 | 恢复同一活动 task；不新增 task 或 effect semantic intent |
| C03 | 相同 delivery / 相同 worker job 重放 | 返回持久 outcome；无新 task/effect |
| C04 | 两个不同 delivery 并发来自同 owner | partial unique/CAS 后仅保留一笔活动 task |
| C05 | 同一 effect key 重复 enqueue | 返回原 effect receipt |
| C06 | revision 改变后的 intake purpose | 产生新的合法 semantic effect，而不是复用旧 revision |
| C07 | transaction 中 effect insert 或 audit insert 失败 | task/outcome/effect 全部回滚 |
| C08 | domain commit 后、parent job complete 前进程崩溃 | job 回收后读取既有 outcome，不重复 task/effect |

### D. Job/effect lease、retry 与 DLQ

| ID | 场景 | 预期 |
| --- | --- | --- |
| L01 | due ready/retry job | 仅一个 worker 获得 lease |
| L02 | lease 到期的 leased job | 可被回收、换发 token、attempts 增加 |
| L03 | lease 未到期的 leased job | 不可领取 |
| L04 | 旧 lease holder complete/retry/DLQ | 被拒绝 |
| L05 | transient DB/network error | 按有界 retry/backoff 重新调度 |
| L06 | permanent payload/gate error | outcome 持久化，parent job 可成功结束，不无意义重试 |
| L07 | 达到 max attempts 或未知 effect 外部结果 | 进入可见 DLQ/对账状态 |
| L08 | 两个 worker 与 runtime lease/heartbeat 竞争 | 单 scheduler 行为可观测；数据库 row lock 是最终安全线 |

### E. 零副作用断言

每个 command-intake happy path 测试均必须统计并断言：

```text
Feishu card HTTP = 0
Base/Drive HTTP = 0
Object store put/get = 0
Renderer/AI HTTP = 0
Approval HTTP = 0
POST /approval/v4/instances = 0
```

这里只允许向数据库写 receipt/task/audit/outbox/effect。effect 发送需要在**独立** effect-worker suite 测试，仍必须使用 fake gateway。

## 7. PostgreSQL、HTTP 与 Dev Bot 的分层证据

### 7.1 PostgreSQL integration 必测项

仓库提供 `pnpm test:control-plane:postgres`。该 suite 只读取显式的 `CONTROL_PLANE_TEST_DATABASE_URL`，为每次运行创建随机 schema、重复应用 checked-in migration，再在结束时删除该 schema；未设置变量时 Vitest skip，绝不回退到 `DATABASE_URL` 或连接默认环境。

已覆盖：migration repeatability、delivery dedupe、receipt→worker→task/audit/effect/outcome、same-owner concurrency、fake card success、`outcome_unknown` restart no-resend、真实 `SKIP LOCKED` 竞争，以及 stale lease reclaim/fencing。

FDEV-007/CP-RISK-008 仍须补足：nonce rollback fault、task revision CAS race、任一 task/audit/effect/outcome insert rollback、effect lease recovery、JSONB corruption/foreign-key 边界和 retry/DLQ 上限故障注入。不得把已覆盖的局部矩阵写为这些未实现场景已通过。

### 7.2 HTTP / worker rehearsal（未执行）

在 fake card gateway 与隔离 PostgreSQL 下，未来至少验证：

1. 有效已签名请求先持久 receipt/outbox 后返回 accepted；
2. 错误 key/signature/digest/timestamp/nonce 不写 receipt/task；
3. ACK 后 worker 正常运行，产生一笔 task 和一条 effect intent；
4. 模拟 HTTP response 丢失后重发，不产生重复业务副作用；
5. receipt 插入与 worker 启动之间重启，job 可恢复；
6. task/effect commit 与 job complete 之间重启，replay 安全；
7. `r1-intake` 与 `r2-draft-only` 不触发 legacy `handleFeishuPocEvent()`；
8. health/backlog/DLQ 输出只含枚举、ID hash/correlation ID 与计数，不含敏感业务 payload。

这不是 CP-RISK-001 的 SDK ACK 证明，也不是任何真实卡片/Dev Bot 证据。

### 7.3 R1-dev Dev Bot（FDEV-006，未执行）

只有 FDEV-001–FDEV-005 🥇 后，才按 Shadow → Dark task → 单用户 card → 小 allowlist 验证真实 Dev Bot。每个 gate 都必须记录 side-effect count、allowlist、值守窗口、rollback drill、unknown/DLQ 状态和零材料/zero OA evidence。

## 8. 通过标准与报告要求

对应 FDEV 进入 🥇 前必须同时满足：

- 冻结实现后有新的 Test-Plan Agent 方案，且独立 QA/Test 已按方案执行；
- 适用的 Unit、SQL contract、real PostgreSQL、HTTP/worker、bridge、Dev Bot/fault-injection 证据均通过，或未可测外部 Gate 被明确保留为 No-go；
- C01–C08、L01–L08 和零副作用断言按对应范围通过；
- no-go 情形可追溯、不会创建额外 task/effect；
- 报告注明代码 revision、依赖版本、数据库镜像、命令、退出码、时长、环境边界、已覆盖/未覆盖范围；
- Requirement Owner、工程 QA 与运行 Owner 复核后，才可推进相应 ring；不得从 R1-dev 推断正式 R2 材料收集或 native OA 权限。

未达到这些条件时，对应 command/card feature 保持关闭；`FEISHU_COUPON_THREE_SOURCE_R2_ENABLED` 仍必须保持 `false`，不得部署/启用完整 R2 worker 路线。
