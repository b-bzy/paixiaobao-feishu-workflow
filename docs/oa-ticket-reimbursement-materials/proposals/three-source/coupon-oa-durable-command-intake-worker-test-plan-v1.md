# 三源优惠券提报：持久 Command-Intake Worker 测试方案 v1

> **状态**：设计待评审；command-only ingress / worker / effect 的 unit 与 SQL-contract foundation 已实现并通过本地测试，但 PostgreSQL integration、受控 HTTP rehearsal 和 R1/R2 仍待实施。
>
> 本文定义下一模块的验证门槛；已实现的代码不代表 R1/R2 已开放。
>
> **日期**：2026-10-09
>
> **关联设计**：[持久 Command-Intake Worker 设计 v1](coupon-oa-durable-command-intake-worker-design-v1.md) · [R2 foundation 验证记录](../../records/durable-control-plane/coupon-r2-foundation-verification-2026-10-09.md) · [升级方案](coupon-oa-feishu-unified-skill-upgrade-plan-v1.md)

## 1. 测试目标与不可推断范围

目标是在不接触业务材料、Base、Drive、renderer 或 Approval 的前提下，证明 durable command-intake 能可靠地将一笔**已验签、allowlist 单聊**的 `/OA优惠券提报` 交付转换为：

1. 一笔创建或恢复的 `Collecting` 三源 task；
2. 一条持久、可幂等对账的 intake-card effect 意图；
3. 一条可审计的 delivery outcome。

所有测试通过也**不能**证明真实飞书租户可用、bridge 满足 R1、文件收集已完成、R2 可开放、截图/产物可生成或 OA 可以创建。

## 2. 测试层级与环境

| 层级 | 环境 | 允许依赖 | 必须证明 | 不能替代 |
| --- | --- | --- | --- | --- |
| Unit | Node/Vitest + fake ports | 内存 repository、固定 clock/ID | normalizer、gate、状态与错误分类 | PostgreSQL 锁/事务、真实发送 |
| SQL contract | Vitest + recording SQL executor | SQL 字符串/参数 | predicate、CAS、semantic key、lease 条件 | 数据库语义/迁移有效性 |
| PostgreSQL integration | disposable PostgreSQL 17 | 真实 migration/driver | FK、索引、JSONB、事务、CAS、`SKIP LOCKED`、lease 回收 | 飞书/bridge E2E |
| HTTP/worker rehearsal | 本地隔离进程 + fake card gateway | durable ingress、worker composition | ACK、重启、replay、effect outbox | 真实飞书权限/生产运行 |
| 受控 R1/R2 E2E | 经过签核的测试租户 | managed bridge 与测试资源 | 端到端受控命令流程 | 原生 OA canary/生产批准 |

真实 PostgreSQL 集成必须由脚本创建可销毁库、应用 `infra/postgres/migrations/0001_durable_control_plane.sql`，并在报告中记录镜像/版本、migration hash、命令、日志位置和清理结果。SQL contract 通过不得写作 PostgreSQL 通过。

## 3. 前置条件与 fixture

### 3.1 必需 fixture

- 版本化 `feishu-delivery-v1` direct-message text payload；
- group / unknown chat、空 actor、空 message ID、错误 schema、hash 不符、重复 stable delivery ID 的变体；
- allowlisted 与非 allowlisted `open_id`；
- 固定 `Clock`、UUID/token generator、correlation ID；
- fake card effect gateway，默认记录请求但不联网；
- PostgreSQL test database 的每例独立 schema 或事务隔离；
- 仅含 task ID/revision/card purpose 的 effect payload；不使用真实文件、密钥或飞书 token。

### 3.2 测试期禁止

- 禁止调用 `sendFeishuCard()` 真实实现；
- 禁止 HTTP 调用 `open.feishu.cn`、Base、Drive、DeepSeek、renderer 或 Approval；
- 禁止 `POST /approval/v4/instances`；
- 禁止记录完整 raw payload、open ID、file key、secret 或附件字节；
- 禁止用本地 `lark-cli` 长连接代替 durable ingress/replay 测试。

## 4. 用例矩阵

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
| G01 | feature flag 缺失/false | `rejected`，零 task/effect |
| G02 | runtime stage 非 `r2-draft-only` | `rejected`，零 task/effect |
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

## 5. PostgreSQL integration 必测项

仓库现提供 `pnpm test:control-plane:postgres`。该 suite **只**读取显式的 `CONTROL_PLANE_TEST_DATABASE_URL`，为每次运行创建随机 schema、重复应用 checked-in migration，再在结束时删除该 schema；未设置该变量时 Vitest 会 skip，绝不回退到 `DATABASE_URL` 或连接任何默认环境。只有指向可销毁测试 PostgreSQL 17 的 URL 才可运行它。

对 disposable PostgreSQL 17 至少验证：

1. migration 可重复应用；
2. receipt unique constraint 阻止 duplicate delivery 并只产生一条 outbox job；
3. nonce unique/TTL 处理与 transaction rollback；
4. owner active-task partial unique index 在并发 start 时只保留一笔；
5. task revision CAS 只允许一个 mutation 成功；
6. operation replay 回读已提交结果；
7. `FOR UPDATE SKIP LOCKED` 阻止重复 claim；
8. expired lease 可 reclaim，过期 token 不能完成/失败处理；
9. parent job、task、audit、effect 其中任一 insert 故障时 transaction rollback；
10. effect semantic key 唯一性与 revision 边界；
11. JSONB 反序列化、非法 persisted JSON 和外键行为；
12. retry/DLQ 达到配置上限后的可见状态。

## 6. HTTP / Worker rehearsal

在 fake card gateway 与隔离 PostgreSQL 下执行：

1. 有效已签名请求先持久 receipt/outbox 后返回 accepted；
2. 错误 key/signature/digest/timestamp/nonce 不写 receipt/task；
3. ACK 后 worker 正常运行，产生一笔 task 和一条 effect intent；
4. 模拟 HTTP response 丢失后重发，不产生重复业务副作用；
5. receipt 插入与 worker 启动之间重启，job 可恢复；
6. task/effect commit 与 job complete 之间重启，replay 安全；
7. 在 `r1-intake` / `r2-draft-only` 中断言 legacy `handleFeishuPocEvent()` 没有被调用；
8. health/backlog/DLQ 输出只含枚举、ID hash/correlation ID 与计数，不含敏感业务 payload。

## 7. 通过标准与报告要求

模块实现完成前，必须同时满足：

- 全部 Unit 与 SQL contract 测试通过；
- real PostgreSQL integration 与 HTTP/worker rehearsal 通过，并有可复现日志；
- C01–C08、L01–L08 和零副作用断言通过；
- no-go 情形可追溯、不会创建 task/effect；
- 所有报告注明代码 revision、依赖版本、数据库镜像、命令、退出码、时长和未执行项；
- 业务/OA/安全/运行 Owner 复核后，才讨论是否进入 R1 intake；仍不得推断 R2 材料收集或原生 OA 权限。

未达到上述条件时，`FEISHU_COUPON_THREE_SOURCE_R2_ENABLED` 必须保持 `false`，且不得部署/启用该 worker 路线。
