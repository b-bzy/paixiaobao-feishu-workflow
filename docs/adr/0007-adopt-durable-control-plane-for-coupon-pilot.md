# ADR-0007：为优惠券内网试点采用耐久控制面

- **状态**：已接受；仅限受控内网试点，云供应商与正式生产部署仍待企业批准
- **日期**：2026-10-09
- **决策 Owner**：优惠券流程 Owner、平台技术 Owner、运行 Owner、应用管理员
- **关联**：[ADR-0002](0002-use-http-callback-as-event-ingress.md) · [ADR-0003](0003-separate-miaoda-control-plane-and-vercel-execution-plane.md) · [ADR-0005](0005-three-source-coupon-workflow.md) · [ADR-0006](0006-use-managed-long-connection-bridge-for-internal-coupon-pilot.md)

## 背景

当前 POC 直接在回调请求中处理卡片、文件、Base、Drive 和原生审批。飞书 Base 也不提供用于事件收据、提交锁和状态迁移的事务/唯一约束。这导致重放、并发提交、进程重启、HTTP 响应丢失和原生审批创建结果未知时无法可靠恢复。

P0 已实施入口验签、默认禁用、allowlist、kill switch 和 `SubmissionUnknown` 止损，但它们不能取代耐久的事件收据、outbox、业务状态与副作用审计。

## 决策

优惠券内网试点采用以下耐久控制面：

```text
Feishu long connection（试点）或 HTTPS callback（长期）
  → transport adapter
  → PostgreSQL：receipt/inbox + transactional outbox
  → containerized worker：租约、重试、DLQ、领域任务与 effect handler
  → encrypted object store：原始材料与冻结产物
  → Feishu Drive/Base projection、卡片与 Approval adapter
```

1. **PostgreSQL 是任务、revision、确认快照、事件收据、outbox、submission attempt、审批观察、effect receipt、DLQ 和审计的唯一事实源。**Base 不承担唯一约束、提交锁或跨表事务；其用途限制为运营投影和飞书可见资料。
2. **对象存储是来源和冻结产物的 canonical bytes 存储。**Drive/Base 附件仅存投影引用；原始材料、标准表和系统截图均记录 hash、大小、保留策略和关联 revision。
3. **容器化 bridge/worker 是常驻执行面。**bridge 只消费/标准化事件、持久化 transport outbox 与签名转发；worker 执行耗时工作。Vercel/Nitro 仅提供 HTTP/API、HMAC ingress 和管理查询，不运行长连接或耗时业务。
4. **低并发 R1/R2 使用 PostgreSQL outbox/lease 作为唯一队列实现。**领域层通过 `EventInbox`、`JobQueue`、`TaskRepository`、`EffectRepository` 接口访问；后续引入企业 broker 不改变任务/审批逻辑。
5. **所有副作用使用持久语义键。**事件传输去重键与业务 action、artifact、卡片和审批的语义键分离。原生审批 attempt 在外部调用前持久化不可变 provider UUID；未知结果只能进入对账，不能创建新的 attempt。
6. **长连接是可替换 transport adapter。**bridge 必须用固定版本的官方 SDK，在 source handler 返回前完成一次 PostgreSQL durable write，并用故障注入证明 ACK 时序。若无法证明该语义，bridge 不得进入 R1，改用同一 receipt/outbox 合同下的 HTTPS callback。

## 后果

### 正向

- 事件重投、worker 重启、卡片双击和 bridge/Nitro 中断可以通过收据、唯一键和 lease 恢复。
- `/OA优惠券提报` 的三源 revision、两次确认、标准产物、截图和原生审批都使用同一审计链。
- 从内网 bridge 切换到标准 HTTPS callback 时只替换 transport adapter，不重写任务、附件或审批提交。
- 原生 OA 的响应丢失会保留为可见、可对账的 `SubmissionUnknown`，不会被伪装为创建失败。

### 代价与限制

- 新增托管 PostgreSQL、加密对象存储、常驻容器、备份恢复、密钥管理、指标告警与运行值守。
- 用户会先获得快速接收/处理中反馈，耗时结果通过后续卡片通知；不再依赖同步 HTTP 请求完成业务。
- 现有 Base 驱动 P1 Excel POC 不可与新控制面双活。它保留为本地/legacy 测试路径，托管试点默认关闭，并在旧草稿对账后由新命令替代。
- 数据驻留、对象存储供应商、密钥服务、备份周期和正式 HA 仍需企业批准；本 ADR 不授权生产发布或原生 OA canary。

## 强制 Gate

在 R1 前必须具备：数据库迁移、bridge SDK ACK 时序证据、持久 outbox/retry/DLQ、单活动 consumer lease、健康/指标/告警、恢复/回滚演练和不记录 payload/secret 的日志复核。

在 R2 前必须具备：`/OA优惠券提报` 的 durable task、source/artifact hash、系统截图、两次确认、draft-only 零审批创建证据以及严格 allowlist。

在 R3 前必须具备：唯一 submission attempt、definition/产物/确认 Gate、审批 attachment effect receipt、`SubmissionUnknown` 对账、审批观察同步、隔离审批定义 E2E 和人工值守。
