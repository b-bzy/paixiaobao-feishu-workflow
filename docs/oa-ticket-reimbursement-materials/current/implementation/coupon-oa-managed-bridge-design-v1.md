# 优惠券 OA 企业托管长连接桥设计 v1

> **状态**：内网试点实施设计；除已明确标注为“现状”的内容外，均为上线前必须完成的目标，不代表当前代码已经具备。
> **日期**：2026-10-08
> **权威架构决策**：[ADR-0006](../../../adr/0006-use-managed-long-connection-bridge-for-internal-coupon-pilot.md)

## 1. 目的与边界

本设计将 `lark-cli` 长连接从本地调试工具改造成可受控验证的**临时内网试点**入口。它不改变 [ADR-0002](../../../adr/0002-use-http-callback-as-event-ingress.md) 的正式 HTTP callback 目标，也不授权 bridge 直接调用 OA、Base 或 Drive 业务 API。

bridge 的唯一职责是安全、可追溯地将 Feishu WebSocket 事件交给 Nitro 的接收边界；领域处理、授权、卡片状态机和审批提交仍在服务端。

## 2. 目标数据流

```text
lark-cli consumer
  → normalize (保留原始稳定标识，不丢失事件种类/操作者)
  → append durable outbox
  → POST signed envelope to Nitro ingress
  → Nitro validates envelope + atomically records transport receipt
  → 202 accepted / duplicate outcome
  → durable processing / recovery lease
  → coupon domain handler
```

“收到 HTTP 2xx”只代表 Nitro 已确认接收；bridge 不得推断草稿生成、文件上传或 OA 创建成功。

## 3. Signed bridge envelope

### 3.1 最小字段

```json
{
  "schema_version": "feishu-bridge-envelope-v1",
  "source": "lark-cli-websocket",
  "event_id": "stable Feishu event id or callback id",
  "event_type": "im.message.receive_v1 | card.action.trigger",
  "message_id": "when applicable",
  "callback_id": "when applicable",
  "actor_open_id": "operator when available",
  "tenant_or_app_id": "configured identifier",
  "bridge_instance_id": "immutable deployment instance id",
  "delivery_attempt": 1,
  "received_at": "ISO-8601",
  "timestamp": "epoch seconds",
  "nonce": "cryptographically random unique value",
  "body_sha256": "hex",
  "key_id": "active shared-key id",
  "payload": {},
  "signature": "HMAC-SHA256"
}
```

`signature` 覆盖 method、path、规范化传输字段、`timestamp`、`nonce` 和 payload 的原始 bytes/digest。签名使用轮换的 bridge 专用 shared secret；**不得**复用 `FEISHU_VERIFICATION_TOKEN`、App Secret 或 tenant token。

### 3.2 Nitro 拒绝条件

Nitro 在任何业务解析前拒绝：缺失/未知 `key_id`、非法签名、错误 body digest、超出允许时钟窗口、已见 nonce、未知 schema、空稳定 event ID、非法 event type 或不符合长度/大小上限的请求。拒绝日志只记录 correlation ID、原因、类型与脱敏标识，不记录原始业务 payload、文件 key 或 secret。

## 4. 幂等、状态与恢复

### 4.1 两层幂等

| 层级 | 键 | 必须防止 |
| --- | --- | --- |
| 传输收据 | Feishu 稳定事件/卡片 callback ID | bridge 重试、Feishu 重复投递、HTTP 响应丢失导致的重复领域处理 |
| 业务副作用 | draft/workflow + revision + action；原生 OA 另有持久 submission key | 重复发卡、重复状态推进、重复附件提升、重复 OA 创建 |

必须使用具有原子 insert-if-absent/唯一约束能力的持久存储。Base 未被证明拥有该能力，因此不能单独作为原生 OA 创建的最终并发锁。

### 4.2 收据状态机

```text
received → processing → succeeded
                    ↘ failed-retryable → retry / dead-letter / manual-review
```

记录 processing lease、attempt、最后错误、下一次重试与关联业务引用。lease 到期可以恢复处理，但不得绕过业务幂等 key。重复事件返回已有收据/结果，不重复副作用。

对于审批创建：API 异常或 readback 缺失不能直接写为 `Failed` 或重新 create，必须进入 `SubmissionUnknown`，由对账任务/人工按持久 submission key 和实例证据处理；已创建但回读差异为 `CreatedNeedsReview`，终止自动写入。

## 5. Bridge 运行要求

- 一个部署实例、两个独立管理的 consumer（message 与 card action）；任何子进程退出都必须被 supervisor 感知与退避重启。
- 失败采用上限明确的指数退避与 jitter；超过阈值时告警并保持 outbox，不能无限快速重试。
- outbox 位于加密的持久卷，至少保存 envelope、尝试次数、接收确认和必要的脱敏关联信息；保留期由数据 owner 批准。
- 优雅关闭顺序：停止 intake → 将内存事件写入 outbox → 完成/标记 in-flight → 退出；重启后从未确认记录继续。
- 固定并验证 `lark-cli` 版本与校验来源；升级须先在测试环境演练并可回退。
- 禁止记录完整消息、附件 bytes、token、签名 secret、原始 Open ID 或可识别业务内容。

## 6. 观测与告警

最低指标：服务/consumer 存活、最后 WebSocket 事件、最后 Nitro 持久接收、outbox 深度与最老年龄、重连次数、签名/重放拒绝数、重复命中数、失败/人工隔离数、处理延迟及 OA 状态异常数。

应对以下情况告警：任一 consumer 停止、连续认证失败、无活动超阈值、outbox 增长或超过时限、Nitro 拒绝签名、dead-letter 增长、重复原生 OA 风险或 `SubmissionUnknown` 超过对账时限。

## 7. 非目标和现有差距

现有 `scripts/long-connection-bridge.mjs` 是开发桥：缺少上述 envelope、持久 outbox、独立认证、持久去重、受监督运行、告警与恢复保证。它不能通过仅改变部署环境而成为本设计描述的 bridge。

本设计也不解决生产 HA、跨区域灾备、队列供应商选择、Base 事务限制、文件恶意内容扫描、DeepSeek 数据治理或审批全生命周期同步；这些应在 rollout gate 或后续生产决策中分别处理。

## 8. 验收证据

上线前必须保留脱敏证据：签名/过期/nonce/错误 key 拒绝测试；bridge 与 Nitro 重启恢复；HTTP 回应丢失重投；重复 message/card callback 仅产生一次副作用；outbox 重放；毒事件隔离；两个 consumer 分别失效与恢复；日志脱敏复核；以及在 draft-only 模式下证明零原生 `POST /approval/v4/instances`。
