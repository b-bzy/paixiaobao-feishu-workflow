# ADR-0006：以企业托管长连接桥作为优惠券内网试点的临时事件入口

- **状态**：已接受，仅限内网试点；不构成正式生产架构接受
- **日期**：2026-10-08
- **决策 Owner**：优惠券流程 Owner、应用管理员、平台技术 Owner、运行 Owner（上线前在试点清单中实名/角色确认）
- **关联**：[ADR-0002](0002-use-http-callback-as-event-ingress.md) · [ADR-0003](0003-separate-miaoda-control-plane-and-vercel-execution-plane.md) · [ADR-0004](0004-bot-confirmed-submit-for-coupon-oa.md) · [三源流程 ADR-0005](0005-three-source-coupon-workflow.md)

## 背景

当前本地调试使用 `lark-cli event consume` 的长连接消费飞书消息与 Card action，并将事件转发到 Nitro 服务。该模式能快速验证 Bot 交互，但开发者电脑、个人登录会话、本地网络与无监管进程均不能成为试点运行依赖。

[ADR-0002](0002-use-http-callback-as-event-ingress.md) 已接受“飞书 HTTPS callback → 快速校验/持久接收 → 异步执行”作为长期目标架构。优惠券首发选择长连接，是为了以受控方式先完成有限内网试点；它不是对 ADR-0002 的否定，也不能被解释为正式生产的永久入口。

## 决策

### 试点拓扑

在本 ADR 的有效范围内，允许以下临时拓扑：

```text
Feishu message / card action WebSocket event
  → 企业托管、常驻且受监督的 Linux VM 或容器
      → lark-cli consumers
      → 持久 outbox、重试与健康报告
      → 已签名、带时间戳与 nonce 的 bridge envelope
  → Vercel / Nitro HTTPS ingress
      → bridge 鉴权、重放拒绝、事件去重与阶段授权
      → 优惠券领域流程
      → Base / Drive 草稿与冻结产物
      → 仅满足阶段二门禁时调用原生 OA API
```

- bridge 宿主必须由企业管理，使用非 root 服务账号、企业凭据存储、持久卷与受监督的进程/容器运行方式。
- bridge 只做事件消费、稳定标识保留、受控转发、失败重试和健康报告；不得复制 Nitro 的业务规则、审批策略或授权判断。
- Vercel/Nitro 仍是业务处理 API。bridge 不能把“HTTP 可达”当作业务成功，也不能绕过服务端的 owner、revision、feature flag、allowlist 或审批定义校验。
- 首期仅允许指定优惠券路线和服务端 allowlist 用户。新增路线、扩大人群、双活消费者或 HA 部署均需要独立评审。

### 与 ADR-0002 的关系

1. ADR-0002 的 HTTP callback 与持久异步处理仍是正式生产目标。
2. 本 ADR 是有明确适用范围、补偿控制和退出条件的临时例外；不修改 ADR-0002 的正文或长期目标。
3. 任何文档描述本试点时，必须使用“企业托管长连接内网试点”而非“生产长连接架构”。

### 必须先实施的控制

本 ADR 记录部署方向，并**不宣称以下控制已经实现**。进入草稿试点前至少必须完成并验收：

- 独立的 bridge-to-Nitro shared secret；不得复用 `FEISHU_VERIFICATION_TOKEN`。
- 覆盖方法、路径、规范化 body、`key_id`、时间戳、nonce 与 body digest 的 HMAC；Nitro 必须拒绝未知 key、错误签名、过期时间、重放 nonce、未知 envelope 版本和副作用事件缺少稳定 ID 的请求。
- 持久化 transport event/card callback 收据的原子去重，以及与其分离的业务幂等键。
- 一个活动消费者。多副本只能在 leader election、租约与 split-brain 策略完成后启用。
- 每个 consumer 的独立重连、退避与告警；在 Nitro 确认**持久接收**前保留 outbox 记录，不能只依赖 TCP 成功或 HTTP 连接建立。
- 可观测指标：bridge/子 consumer 存活、最后 WebSocket 活动、最后成功持久接收、outbox 深度及最老年龄、重连次数、认证失败、重复率与失败队列。
- 经演练的停止、积压重放、Vercel 故障、凭据丢失、毒事件隔离和回滚流程。

### 原生 OA 的阶段边界

本 ADR 不授权自动提交。内网试点的服务端写入仅按 rollout 文档分阶段开放：

| 阶段 | 允许的服务端副作用 |
| --- | --- |
| Draft-only | 草稿、受控产物、hash 与状态记录；禁止 `POST /approval/v4/instances` |
| Native-submit canary / allowlist | 仅当前 revision 的最终确认、服务端 allowlist、全局 kill switch、批准 approval code、完整材料、原子业务幂等 claim 与 definition hash 均通过时，才可创建并回读 OA |

手动打开 `OA优惠券审批` 后由用户在原生页面提交，仍是独立的人工路线，并不表示自动化原生写入已启用。

## 后果

### 正向

- 试点不再依赖个人电脑常驻或开发 shell。
- 可在不立即改变 Bot 交互与 Nitro 领域服务的前提下，完成受控真实环境验证。
- 为 HTTP callback 迁移保留统一的“被安全接收的事件”边界和审计要求。

### 代价与限制

- 新增 VM/容器、凭据、持久卷、监控、版本治理和跨平台故障处理责任。
- 当前 `scripts/long-connection-bridge.mjs`、`pnpm dev:events`、重启脚本和个人 `lark-cli` 登录仅适用于开发，不是此 ADR 的已实现桥接服务。
- 长连接本身不解决 Vercel 超时、Base 并发、审批未知结果、数据治理或生产 SLA；这些仍需专项改造和门禁。

## 失效、退出与迁移条件

立即停止本例外并进入回滚/复盘，若出现任一情形：bridge 运行在个人设备或个人身份下、未签名请求被接收、去重或 outbox 不可验证、无法监控连接状态、`lark-cli` 版本不再受支持、产生重复/越权原生 OA，或运维无法判断事件/审批是否已处理。

返回 ADR-0002 的 HTTP callback 目标前，应完成：等价事件合同、callback 鉴权与持久接收、幂等与恢复验证、无 bridge 积压、受控切换和回滚演练。正式生产是否接受仍需单独决策，不能由完成桥接迁移自动推导。

## 相关运行材料

- [Bridge 设计](../oa-ticket-reimbursement-materials/current/implementation/coupon-oa-managed-bridge-design-v1.md)
- [内网试点 rollout](../oa-ticket-reimbursement-materials/current/operations/coupon-oa-internal-pilot-rollout-plan-v1.md)
- [Bridge runbook](../oa-ticket-reimbursement-materials/current/operations/coupon-oa-managed-bridge-runbook-v1.md)
- [上线 readiness checklist](../oa-ticket-reimbursement-materials/current/operations/coupon-oa-pilot-launch-readiness-checklist-v1.md)
