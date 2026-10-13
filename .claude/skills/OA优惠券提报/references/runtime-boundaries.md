# OA 优惠券提报：飞书运行阶段与事件边界

> **定位**：综合 Skill 的运行时边界参考。它不实现 Bot、bridge、worker、PostgreSQL 或 OA；实际上线 Gate 以 `docs/adr/`、`current/operations/`、FDEV 台账及服务端代码为准。
>
> **关联**：[综合 Skill](../SKILL.md) · [ADR-0008](../../../../docs/adr/0008-limit-local-lark-cli-to-vercel-integration-smoke.md) · [飞书开发版需求台账](../../../../docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-dev-requirements-tracker-v1.md)

## 1. 阶段矩阵

| 阶段 | 拓扑 / 目标 | 可验证范围 | 不允许或不能推断 |
| --- | --- | --- | --- |
| Claude Code 本地 | 本地 Skill、离线文件评审 | 三源规则、映射候选、底稿、标准产物准备和确认问题 | 飞书、Base、Drive、卡片、OA、线上任务状态 |
| R0.5-manual-smoke | 测试 Bot → Mac `lark-cli` / 本机 bridge → 签名 HTTPS → Vercel ingress → PostgreSQL receipt/outbox | 已抵达 Vercel 的请求、HMAC 拒绝/接受、receipt/outbox、单 consumer、停止 intake | 不处理 `/OA优惠券提报`、不运行 worker tick、不回复用户、不创建 task/effect/card/file/OA；不证明 durable ACK/retry/reconnect/R1-dev/R2 |
| R1-dev | FDEV-001–005 🥇 后的 Shadow → Dark task → card canary | command/task/effect、严格 allowlist、零材料/OA | 正式 R2 文件流、Base/Drive、对象存储、renderer、Approval |
| R2 draft-only | FDEV-007 | 三源材料、canonical revision、两次确认、标准产物/截图、交接既有 OA 测试稿 | 原生 OA 创建、Approval 附件上传 |
| R3/R4 | FDEV-008 | 既有 OA 测试稿的明确“发送”动作、服务端 Gate、readback、`SubmissionUnknown` 对账 | 盲目重试、客户端提交、绕过 owner/revision/hash/审批定义 Gate |

`R0.5-manual-smoke` 是文档标签，不是新的 `FEISHU_RUNTIME_STAGE`，不是 FDEV 完成证据，也不能改变业务 feature gate。

## 2. R0.5 的唯一稳定边界

```text
Feishu Dev App
  → Mac：lark-cli + scripts/long-connection-bridge.mjs
  → Vercel /api/feishu/bridge
  → PostgreSQL receipt + workflow outbox
  → 脱敏证据核对（不向用户回复）
```

当前 `lark-cli 1.0.96` 可能在 stdout bridge 转发、Vercel ingress 和 PostgreSQL 写入前 ACK。因此：

- Vercel receipt/outbox transaction commit 是**系统内可核对边界**；
- 它不是飞书 source ACK 的可靠边界；
- bridge forward error、Vercel 超时或不可用时，按事件**可能已 ACK 且丢失**处理；
- 不假定自动重投，也不以重复发送测试消息“补齐”事实。

Vercel `202` 也不会自动沿 `lark-cli` 长连接回复用户。用户可见文本/卡片必须是 worker 领取后的独立、幂等 effect；不能由 ingress 直接发送。

## 3. 方案 A 与 Skill 的状态边界

Skill 的完整业务合同在正式 R2/R3 才实现：

```text
三源材料
  → canonical revision
  → 第一次确认
  → 标准产物 + 系统生成截图
  → 第二次确认
  → 创建/更新既有 OA 测试稿
  → 用户在既有草稿执行明确“发送”
  → 仅服务端 Gate 全通过时创建并回读 OA
```

三源 adapter 不复制或直接调用第二套提交器。第二次确认交接 OA 测试稿不等于 OA 已发送；既有明确“发送”动作是唯一可能授权原生 OA 创建的动作。

## 4. 对本 Skill 的使用规则

- 本地 Skill 可以继续收集、审阅和生成零副作用底稿；它不启动 R0.5 bridge，也不读取 Vercel/数据库证据。
- R0.5 只能作为飞书运行前的 transport smoke，不能用于验证 Skill 的完整业务流程。
- 若用户要求“收到 Bot 回复”“创建测试任务”或“上传材料”，必须切换到对应的 FDEV/R1-dev/R2 需求，不得在 R0.5 中临时打开 Gate。
- 运行时事实与 Skill 不一致时，以 ADR、FDEV 台账、正式 runbook 和服务端行为为准，并回写修订 Skill 文案。
