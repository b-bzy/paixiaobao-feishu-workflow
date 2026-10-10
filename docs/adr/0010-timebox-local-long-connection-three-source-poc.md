# ADR-0010：用本机长连接执行限时三源 draft-only POC

- **状态**：需求方已选择；仅记录单用户 P0 测试边界，仍待优惠券流程、应用与工程 Owner 审阅；不构成 R1/R2/R3、生产批准或原生 OA 授权。
- **日期**：2026-10-10
- **决策 Owner**：优惠券流程 Owner、工程 Owner、飞书应用管理员
- **取代**：[ADR-0009](0009-timebox-direct-http-callback-for-three-source-draft-poc.md) 的本次 P0 事件接入选择
- **关联**：[ADR-0002](0002-use-http-callback-as-event-ingress.md) · [ADR-0006](0006-use-managed-long-connection-bridge-for-internal-coupon-pilot.md) · [ADR-0007](0007-adopt-durable-control-plane-for-coupon-pilot.md) · [ADR-0008](0008-limit-local-lark-cli-to-vercel-integration-smoke.md)

## 背景

已实现的 strict-only 三源 adapter 可以收集 `.xlsx` 配券表、SKU 白名单与可选黑名单，完成材料角色、字段映射、无黑名单/名单重叠决定，生成冻结标准 Excel，并只交接给既有 OA **测试稿**。需求方选择保持飞书测试 App 的长连接模式，而不是将 App 切换到开发者服务器回调。

现有本机 `lark-cli` runner 的事件输出可经 HMAC 转发到 Vercel，但它不是 durable transport：已安装 CLI 可能在 stdout 转发和 Vercel 成功处理前确认来源事件。电脑休眠、进程退出、网络失败、Vercel 超时或转发失败都可能导致事件已被确认但未抵达服务端。此 POC 接受该限制以换取最快的单用户真实体验验证；它不能被表述为可靠交付、恢复能力或上线架构。

## 决策

只在明确、短暂的测试窗口内，允许以下 **P0 local-long-connection draft-only POC**：

```text
飞书测试 App（长连接；唯一 active consumer）
  → Mac：lark-cli event consume
  → scripts/long-connection-bridge.mjs（P0 mode）
  → HTTPS + HMAC
  → Vercel POST /api/feishu/poc-bridge
  → local-only、threeSourceOnly 的 legacy POC handler
  → 严选三源 adapter
  → 隔离 Base 任务记录 + Drive 冻结标准产物
  → 既有 OA 测试稿
```

`/api/feishu/poc-bridge` 只在 `FEISHU_RUNTIME_STAGE=local` 时接受带 method/path/key ID/timestamp/nonce/body digest 签名的请求，并以进程内 nonce cache 拒绝重放。它只把认证 envelope 交给 `handleFeishuPocEvent(..., { trustedIngress: "bridge", threeSourceOnly: true })`；不得导入或调用 PostgreSQL receipt/outbox、worker tick 或 P1 durable ingress。

### 允许范围

仅限一个严格 allowlist 用户、Bot 单聊、常规满减券、`严选` 与 SKU：

- 精确命令 `/OA优惠券提报`；
- `.xlsx` 配券表与白名单、可选黑名单的乱序接收、角色/歧义选择、无黑名单和名单重叠决定；
- 标准产物生成、Drive 冻结后重新下载/hash 校验；
- 既有 OA **测试稿**与预览卡。

`lark-cli` 的文件事件只带预渲染文本，可能没有 `file_key`。只有三源 dispatcher 已确认 pilot 开启、用户 allowlist 通过、恰有一个 active 三源任务且不存在跨流程冲突后，服务端才按消息 ID 回读原始飞书消息体以获得 `file_key`/`file_name`，再走既有安全下载与 source-hash 路径。源文件仍绝不直接成为 OA 附件。

### 不可变边界

1. `FEISHU_COUPON_THREE_SOURCE_PILOT_ENABLED` 默认关闭，只在测试窗口为唯一用户开启。
2. `FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false` 必须全程保持；本 POC 绝不调用 `POST /approval/v4/instances`，也不点击既有测试稿的最终发送动作。
3. 运行时只能有一个 `lark-cli`/SDK/HTTP consumer；不得与开发者服务器回调、旧 bridge 或第二个本机 consumer 双活。
4. Mac runner 仅在窗口中运行，不能以个人电脑、个人会话或本地日志充当持久运行/审计证据。
5. `threeSourceOnly` 必须忽略非三源文本、文件和 card action，不能顺带开放 legacy OA、Excel pilot、报销或其它流程。

### 立即停止条件

任一情况都立即停止 runner、关闭 pilot flag，并把当前事件视为可能丢失或状态未知：转发失败/超时、CLI child 退出、解析错误、重复事件或卡片点击、Vercel 重启、Base/Drive/文件回读失败、两个 consumer、敏感日志、陌生用户副作用或任何 native OA 迹象。不得为补偿盲目重发消息、重启后假定自动恢复，或创建真实 OA。

## 与既有 ADR 的关系

- [ADR-0002](0002-use-http-callback-as-event-ingress.md) 仍是长期生产目标。本 ADR 不推翻 HTTPS callback、持久接收与异步处理的方向。
- [ADR-0006](0006-use-managed-long-connection-bridge-for-internal-coupon-pilot.md) 仍要求企业托管 bridge、持久 outbox、重试、健康和运行治理。本机 runner 不满足其中任一上线条件。
- [ADR-0007](0007-adopt-durable-control-plane-for-coupon-pilot.md) 仍是 R1+ 及任何耐久/原生 OA 路线的强制边界。
- [ADR-0008](0008-limit-local-lark-cli-to-vercel-integration-smoke.md) 的 R0.5 smoke 仍只允许零业务副作用。本 ADR 是不同的、明确标注为不可靠的 P0 业务体验例外；它不把 R0.5 变为 R1，也不获得其未实现的恢复语义。

## 后果与退出

本 POC 的正向结果只是证明在一次受控窗口内，严格范围的 Bot 卡片、材料、标准产物与 OA **测试稿**能工作。它不能证明飞书 ACK 时序、事件不丢失、重连、重试、监控、业务幂等、P1 durable-control-plane、完整 Skill 合同或原生 OA 权限。

完成或停止后立即关闭 pilot flag 并停止本机 runner。任何扩大用户、增加协作/群聊、长期运行、恢复/retry 要求、完整 Skill 能力或“确认发送即真实 OA”都转入 P1 独立评审。

## 相关运行材料

- [P0 最快 Bot POC 交付计划](../oa-ticket-reimbursement-materials/proposals/three-source/coupon-three-source-fast-poc-delivery-plan-v1.md)
- [本机长连接 POC 运行手册](../oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md)
- [R0.5 本机长连接 smoke ADR](0008-limit-local-lark-cli-to-vercel-integration-smoke.md)
