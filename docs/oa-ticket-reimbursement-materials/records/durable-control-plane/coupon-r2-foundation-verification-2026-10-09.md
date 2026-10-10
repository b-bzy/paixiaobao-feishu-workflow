# 优惠券 R2 基础验证记录（2026-10-09）

> **记录类型**：本地代码与自动化验证记录
>
> **适用范围**：三源领域 R0/W1、durable-control-plane SQL contract、默认关闭的 R2 feature gate。
>
> **结论**：本记录覆盖的自动化测试均已通过，且已修复两项 worker lease 阻断缺陷。2026-10-09 已在本地 PostgreSQL 17 成功执行 migration、验证 migration runner 的重复执行，并运行 disposable-schema 的 delivery/task/effect-outbox 并发、`FOR UPDATE SKIP LOCKED` 与过期 lease 集成测试；但对象存储、常驻 worker、飞书/Drive/Base、renderer、审批及 R2 E2E 仍未验证。因此当前状态仍为 **R2 No-go / foundation only**，不是上线或 rollout Gate 通过证明。

## 1. 运行上下文

| 项目 | 实际值 |
| --- | --- |
| 执行日期 | 2026-10-09 |
| Git HEAD | `45ae50f` |
| 工作区状态 | 有 120 个待提交路径；本记录覆盖执行时的工作区，而非干净发布版本 |
| Node.js | `v22.22.2` |
| pnpm | `10.14.0` |
| Vitest | `4.1.11` |
| 环境 | macOS / darwin-arm64，本地开发机 |
| 外部副作用 | 已启动本地 PostgreSQL 17（healthy），未连接飞书、Base、Drive、renderer 或 Approval；MinIO 镜像拉取受本机 Docker mirror 的 403 阻断；未部署 |

## 1.1 与 FDEV-001 release baseline 的关系

本记录是执行当时工作区的本地验证证据，**不是** clean release baseline：第 1 节记录的 `Git HEAD` 和 120 个待提交路径不能作为 FDEV-001 或任何 Dev App/bridge/canary 的 release ref。

[FDEV-001 Dev release baseline 候选清单](fdev-001-dev-release-baseline-v1.md)已单独建立为默认 No-go 模板。它的 clean commit/tag、protected-ref、工具链/migration 指纹、重复命令、Test-Plan/QA 结果与三方 🥇均为 **Not yet recorded**；在用户明确授权 commit/tag 且 FDEV-001 完成独立生命周期前，本记录只能作为 foundation 输入。

## 2. 本轮发现与修复

### CP-LEASE-001：过期 leased 作业无法被重新认领

**发现**：`PostgresWorkflowJobRepository.claim()` 原先只选择 `ready` / `retry` 状态。作业被 worker 领取后状态改为 `leased`，即使 `lease_expires_at` 已过期也不会再次进入候选集合，worker 崩溃会造成作业永久滞留。

**修复**：`server/lib/control-plane/postgres-workflow-job-repository.ts` 的 claim SQL 现在选择：

```sql
(state IN ('ready', 'retry') AND next_attempt_at <= now)
OR (state = 'leased' AND lease_expires_at <= now)
```

保留 `FOR UPDATE SKIP LOCKED`、原子换发 lease token/expiry 和 `attempts + 1`。

### CP-LEASE-002：过期 worker 仍可完成或失败处理作业

**发现**：`complete()` 与 `retryOrDeadLetter()` 仅核验 `state = 'leased'` 和 lease token，未核验 `lease_expires_at`；旧 worker 在 lease 到期后仍可能写入完成、retry 或 dead-letter 结果。

**修复**：两个更新语句均增加 `lease_expires_at > currentTime` 条件，并使用 repository 注入的 `now()` 作为 SQL 参数，保证边界测试可重复。更新影响行数为零时仍返回既有的 lost-lease 错误。

### 回归用例

`server/lib/control-plane/postgres-workflow-job-repository.test.ts` 新增/加强以下 SQL contract 断言：

| 编号 | 场景 | 结果 |
| --- | --- | --- |
| L01 | 到期 `leased` 作业进入 claim 候选并换发 lease | 通过 |
| L02 | 未到期 `leased` 作业不因 lease 条件进入候选 | 通过 |
| L03 | 回收后返回递增的 attempts | 通过 |
| L04 | 过期/被抢 lease 不能 complete | 通过 |
| L05 | 过期/被抢 lease 不能 retry 或 dead-letter | 通过 |
| L06 | ready 作业仍使用 `FOR UPDATE SKIP LOCKED` 领取 | 通过 |

新增 complete/retry 的过期 lease 断言在修复前先失败（2 个失败用例），修复后目标套件为 **5/5 通过**。

> 这些是 SQL contract tests：它们验证生成 SQL、时间参数与仓库接口行为，不替代真实 PostgreSQL 的锁、事务回滚或并发集成测试。

### CP-LEASE 增量：durable ingress、command-intake 和 card effect 意图

**实现范围**：

- `server/api/feishu/bridge.post.ts` 在非 `local` stage 执行 HMAC 验签、1 MiB envelope 限制、稳定 event ID / chat context 规范化，并以 `PostgresIngressReceiver` 在同一数据库事务写入 nonce、delivery receipt 和 `process_feishu_delivery` outbox job；该路径不调用 legacy `handleFeishuPocEvent()`。
- `PostgresCouponCommandIntakeRepository` 将 delivery outcome、单 owner task 的 create-or-resume、audit 与唯一 intake-card effect intent 放在一个 transaction；`DurableCouponCommandIntakeHandler` 只接受严格的 `/OA优惠券提报` 单聊文本，且重验 allowlist/runtime gate。
- `PostgresDurableEffectRepository`、effect worker 和 `coupon_three_source_intake_card` handler 使用独立 effect lease、retry/DLQ 与 `outcome_unknown` 停止状态；retry 达到 worker 上限后进入 effect DLQ。对远端结果不明的卡片发送不会自动重发。
- 内部 `POST /api/internal/control-plane/tick` 仅在非 `local` stage、配置 32+ 字符 scheduler bearer token 与 worker ID 后才可调用 composition；其余情况下 fail closed。该路由未部署或调用，测试以 fake worker 执行，未产生飞书网络请求。
- 新增 `chat_id`、effect lease/DLQ 的增量 migration；`pg` adapter 与 hash-protected migration runner 现已存在。

**自动化证据**：

| 编号 | 命令 | 结果 | 范围 |
| --- | --- | --- | --- |
| V12 | `pnpm test:control-plane` | 18 files / 56 tests 通过；1 file / 5 PostgreSQL integration tests 按预期 skip | ingress receipt、command intake transaction、task/effect idempotency、worker/effect lease、runtime lease/config、authenticated tick fail-closed behavior |
| V13 | `pnpm exec vitest run server/lib/feishu/bridge-ingress.test.ts server/lib/feishu/bridge-auth.test.ts` | 通过，2 files / 12 tests | HMAC、body size、durable 202/duplicate、无同步 POC handler、fail-closed config |
| V14 | `pnpm typecheck:server` | 通过 | 本次新增 server TypeScript |
| V15 | `pnpm test` | 50 files / 236 tests 通过；1 file / 5 PostgreSQL integration tests 按预期 skip | 当前完整 Vitest 回归，包含本 slice 的 ingress/worker/effect contracts |
| V16 | `pnpm build` | 通过 | 当前 Nitro server build |
| V17 | `pnpm lint` | 通过；5 条既有 admin warning | 本次 server/bridge 文件无 error；warning 见 §4 |
| V18 | `git diff --check` | 通过 | 无空白错误 |
| V19 | `CONTROL_PLANE_TEST_DATABASE_URL=postgresql://… pnpm test:control-plane:postgres` | 通过，1 file / 5 tests | disposable schema 中重复执行所有 migration；验证 delivery 去重、receipt→worker→task/audit/effect/outcome 事务、同 owner 并发 create-or-resume、fake card gateway 的完整 worker tick、`outcome_unknown` 后新数据库连接模拟重启时不重发、真实 `SKIP LOCKED` 竞争与 stale lease reclaim/fencing |
| V20 | `DATABASE_URL=postgresql://… pnpm db:migrate:control-plane`（第二次） | 通过 | 四个 migration 均报告 `already applied`，runner hash/版本保护有效 |

这些仍主要是 unit/SQL contract tests；V19 补充了列出的本地 PostgreSQL 事务/锁证据，但不构成真实 bridge ACK 或任何 Feishu side effect 的证明。

## 3. 已执行验证

| 编号 | 命令 | 结果 | 证据/范围 |
| --- | --- | --- | --- |
| V01 | `pnpm exec vitest run server/lib/control-plane/postgres-workflow-job-repository.test.ts` | 通过，1 file / 5 tests | lease 回收与最终写入的 SQL contract |
| V02 | `pnpm test:control-plane` | 通过，8 files / 23 tests | receipt/outbox、worker、lease、task repository、object integrity、runtime config |
| V03 | `pnpm test:coupon-three-source:offline` | 通过，1 file / 8 tests | 任意布局识别、黑名单/交集、标准产物、零网络离线工作流 |
| V04 | 聚焦三源/config/service/events Vitest | 通过，3 files / 37 tests | 精确命令、默认关闭、任务幂等、legacy 路由隔离 |
| V05 | `pnpm test` | 通过，39 files / 197 tests | 当前全量 Vitest 单元/合同回归 |
| V06 | `pnpm lint` | 通过；5 条既有 admin warning | 无 error；warning 见 §4 |
| V07 | `pnpm typecheck:server` | 通过 | 服务端 TypeScript |
| V08 | `pnpm build` | 通过 | Nitro server build |
| V09 | `git diff --check` | 通过 | 无空白错误 |
| V10 | `pnpm typecheck` | 未通过 | server 通过；admin TypeScript 依赖/声明问题，见 §4 |
| V11 | `pnpm build:admin` | 未通过 | 其前置 admin TypeScript 检查失败，见 §4 |

## 4. 未通过项与不属于本轮修复的质量问题

`pnpm build:admin` 在其前置 `tsc --noEmit` 失败，因此没有进入 Vite 构建。错误集中于 `apps/miaoda-admin`：

- 缺少 `react`、`react-dom`、`react/jsx-runtime` 的 TypeScript 声明；
- 缺少 JSX intrinsic elements/`React` namespace；
- `ImportMeta.env` 与 CSS side-effect import 类型未配置。

这不是本轮 control-plane 或三源服务端改动引入的问题，故未在本记录中顺带修改依赖或前端类型配置。它仍使**全仓 typecheck/admin build 不可通过**，后续需由 admin 模块单独修复并建立依赖锁定测试。

`pnpm lint` 的 5 条 warning 也位于 `apps/miaoda-admin`：一条非空断言和四条 CSS specificity 顺序 warning。本轮服务端/三源新增与变更文件均通过 scoped Biome check。

## 5. 未执行或不能由本记录证明的项

| 范围 | 状态 | 原因 |
| --- | --- | --- |
| PostgreSQL 17 migration 与 command-intake 并发测试 | 部分通过 | 本地 PostgreSQL 17 已执行 `0001`–`0004` migration，runner 重复执行已验证；disposable-schema integration 通过 delivery 去重、receipt→task/effect/outcome 事务与同 owner 并发 create-or-resume |
| 真正的 `FOR UPDATE SKIP LOCKED`、事务回滚、CAS race、lease reclaim | 部分验证 | integration 覆盖真实 PostgreSQL 的 concurrent command workers、`SKIP LOCKED` 单 claim、expired lease reclaim，以及过期 token 的 complete/retry fencing；显式 transaction rollback、task revision CAS race 与 effect lease recovery 仍未故障注入 |
| 对象存储 immutable put/get/hash | 未执行 | MinIO 镜像拉取被本机 Docker mirror 403 阻断，且没有 S3/MinIO adapter |
| durable ingress → receipt → worker → task/effect composition | PostgreSQL command path 已验证 | integration 覆盖 receipt、outbox、task、audit、effect intent、outcome；尚未验证真实 bridge、常驻 worker 或真实 card send |
| 飞书 HMAC/bridge ACK、消息/卡片 direct-chat 正规化 | 仅本地合同 | bridge 现保存验签后的 chat type/chat ID；未连接真实租户，未证明 SDK 的 ACK 时序 |
| Base/Drive/renderer/AI/审批附件/native OA | 未执行且禁止 | 本轮默认关闭；R2 仍不得访问这些能力 |
| R1/R2 E2E、故障演练、监控、DLQ runbook、rollout 签核 | 未执行 | 不具备实施或运营 Gate 证据 |

## 6. 当前结论与后续门槛

在已执行的本地自动化范围内，没有保留已知的三源/worker lease 阻断缺陷；CP-LEASE-001 和 CP-LEASE-002 已修复并有回归测试。

这只能表述为：

> **默认关闭的 R0/W1 foundation、durable command-intake 与 card-effect intent 在列出的 unit/SQL-contract 测试范围内通过验证。**

它不能表述为 R1-dev ready、R2 ready、飞书已打通、真实任务可运行或 OA 可创建。后续整改的唯一顺序、依赖与验收口径见[飞书开发版需求与进度台账](../../proposals/three-source/coupon-oa-feishu-dev-requirements-tracker-v1.md)：先完成 FDEV-001 的可复现 clean baseline 🥇，之后才依次处理 durable bridge、effect fencing、完整性绑定、对账、观测、数据治理、Dev 环境预检与 R1-dev canary。对象存储、PostgreSQL fault injection、Base/Drive、renderer 和 Approval 仍留在正式 R2/R3 的后续需求，不得由本记录提前宣告通过。
