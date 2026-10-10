# ADR-0008：将本机 lark-cli 长连接限定为 Vercel 集成 smoke 测试

- **状态**：提议中；待优惠券流程、应用、工程与运行 Owner 评审
- **日期**：2026-10-10
- **决策 Owner**：优惠券流程 Owner、应用管理员、工程 Owner、运行 Owner
- **关联**：[ADR-0002](0002-use-http-callback-as-event-ingress.md) · [ADR-0006](0006-use-managed-long-connection-bridge-for-internal-coupon-pilot.md) · [ADR-0007](0007-adopt-durable-control-plane-for-coupon-pilot.md)

## 背景

飞书 Dev App 已采用长连接事件模式。短期需要验证本机长连接消费、签名 HTTPS 转发和 Vercel/Nitro ingress 的连通性，但没有企业托管 bridge/容器资源，也不需要为这次验证建立长期运行面。

当前 `scripts/long-connection-bridge.mjs` 以 `lark-cli event consume` 获取消息和 card callback，并对精确的 Vercel/Nitro `/api/feishu/bridge` 发送 HMAC 请求。已安装的 `lark-cli 1.0.96` 在将事件发布到其非阻塞内存 bus 后就返回 SDK 成功响应；stdout、父进程 bridge 转发和 Vercel/PostgreSQL 写入发生在该响应之后。因此一旦本机转发失败，飞书可能已经 ACK 该事件。该脚本没有 durable transport outbox、SDK ACK 时序证明、崩溃恢复、重连策略或 DLQ，不能作为 ADR-0006 的企业托管 bridge，也不能满足 ADR-0007 的 R1 durable transport Gate。

## 决策

### R0.5-manual-smoke 标签

允许使用以下**短期、手工、零新增云资源**拓扑，并将其标识为 `R0.5-manual-smoke`：

```text
Feishu Dev App（单一 active consumer）
  → 本机 lark-cli 长连接
  → 本机 scripts/long-connection-bridge.mjs
  → HTTPS + HMAC
  → Vercel /api/feishu/bridge
  → 隔离测试 PostgreSQL receipt + workflow outbox
  → Vercel / PostgreSQL 脱敏证据核对（不向用户回复）
```

`R0.5-manual-smoke` 是文档和测试标签，**不是**新的 `FEISHU_RUNTIME_STAGE`、release ring、FDEV 完成标志或部署批准。它的唯一稳定系统边界是 Vercel 已在 PostgreSQL 中提交 receipt/outbox 的时刻；由于 `lark-cli` ACK 可能更早，这也不是飞书 source-delivery 成功边界。

R0.5 不向测试用户发送 Bot 消息或卡片。当前本机 bridge 是单向 `lark-cli → Vercel` 转发器，Vercel 的 HTTP `202` 不会沿长连接自动回传为用户消息。任何用户可见回复都必须作为 worker 领取后的独立 effect，以稳定语义键去重、记录不确定结果，并且只可在未来相应 FDEV 🥇 后的 R1-dev Gate 中设计和验证。

### 允许与禁止范围

允许证明：

- 测试 App 的长连接可由本机唯一 `lark-cli` consumer 接收；
- 本机 bridge 只向精确的 Vercel HTTPS `/api/feishu/bridge` 转发 HMAC envelope；
- Vercel 能拒绝错误签名/路径/时间戳/nonce，且能 durable-accept **已经到达 bridge 的** transport delivery；
- 停止本机进程会停止此测试窗口的 intake。

明确禁止：

- 打开 command、card-send、R2 文件/material、native-submit 或 OA feature gate；
- 运行 worker tick，或直接/间接向测试用户发送 Bot 文本、卡片或任何 user-visible effect；
- 宣称 source ACK 在 durable write 之后、事件不会丢失、重连可恢复、R1-dev/R2 已完成或可生产部署；
- 与另一份 `lark-cli`、SDK runner、HTTP callback consumer 或旧 bridge 双活；
- 将本机日志、个人终端或 `lark-cli` 输出作为 durable evidence。

Vercel 只承载 HTTP/API、现有 HMAC ingress、PostgreSQL transaction 与必要时受保护的 tick。它不持有或重连长连接 WebSocket；本机测试进程不暴露公网端口。

## 前置条件与停止条件

运行前必须具备独立 Dev App/Bot、Vercel 测试部署、隔离且可由 Vercel 访问的测试 PostgreSQL、测试 HMAC key、严格允许范围和明确的测试窗口 Owner。不得将本机 Docker PostgreSQL 用作 Vercel 的运行数据库。

任一 bridge 转发失败、Vercel 不可用、双 consumer、意外业务副作用、凭据/原始 payload 泄露或无法明确记录时间窗时，立即停止本机 bridge，保持业务 Gate 关闭并记录事实；由于 `lark-cli` 可能已 ACK，绝不得假设事件会在之后安全重发。

## 后果

### 正向

- 可使用现有 Vercel 和本机工具验证长连接到 HTTPS ingress 的最小集成，无需临时申请企业 bridge 资源。
- 保留既有 HMAC、Vercel ingress 和 PostgreSQL receipt/outbox，实现不需要重写三源/OA 代码。
- 明确区分“手工连通性 smoke”与“可恢复的 R1-dev transport”，避免将一次成功转发误写成上线证明。

### 限制与后续

本 ADR **不修改** ADR-0006 的企业托管内网试点条件，也不降低 ADR-0007 的 durable control-plane Gate。需要 R1-dev command/card canary 时，FDEV-002 仍须用受支持 SDK runner + durable transport outbox 替代 `lark-cli`，并在 source handler 返回前持久化、证明重试/恢复/DLQ/single-consumer 语义。

完成 R0.5 smoke 后，应停止本机 consumer、保存脱敏 Vercel/receipt 证据并清理本机进程。下一步仍是 FDEV-001 的 release baseline，而非把本机 smoke 标记为 FDEV-002 或部署就绪。
