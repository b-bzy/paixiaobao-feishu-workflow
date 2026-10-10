# 飞书开发版：R1-dev Command-to-Card 发布计划 v1

> **状态**：待业务、流程、飞书应用、平台/安全与运行 Owner 评审。本文只定义独立 Dev App/Bot 的 command-only canary，不代表正式 R2、材料流或 OA 已开放。
>
> **日期**：2026-10-09
>
> **权威进度**：[飞书开发版需求与进度台账](coupon-oa-feishu-dev-requirements-tracker-v1.md) 是每项 FDEV 的唯一生命周期记录入口。

## 1. R1-dev 的定义与目标

`R1-dev` 是正式 R2 前、独立 Dev App/Bot 的发布和验收 ring。它使用：

```text
FEISHU_RUNTIME_STAGE=r1-intake
+ 独立 Dev command gate
+ 独立 Dev card-send gate
```

它**不是**新的 runtime-stage 字符串，且不得使用 `r2-draft-only` 来运行 command/card canary。正式 R2 只指完整的 `r2-draft-only` 文件/材料 draft-only 流程。

### 1.1 R0.5-manual-smoke 不属于 R1-dev

在没有企业托管 bridge 资源的短期测试窗口，可按 [ADR-0008](../../../adr/0008-limit-local-lark-cli-to-vercel-integration-smoke.md) 使用本机 `lark-cli` → 本机 bridge → Vercel HTTPS ingress。它只验证 transport 连通性与全部 Gate 关闭时的安全拒绝：不新增 runtime stage、不启用 command/card/OA、不发送 Bot 用户回复、不取得 FDEV-002 证据，也不满足本发布计划中的 R1-dev Go 条件。

R1-dev 的目标是：具名测试者在独立 Dev Bot 单聊输入精确 `/OA优惠券提报` 后，受控验证 receipt/outbox、创建或恢复 `Collecting` task、审计和一张明确标注“材料通道尚未开放”的开发验收卡。

```text
Dev Bot 单聊命令
  → 企业托管 durable bridge
  → HMAC /api/feishu/bridge
  → PostgreSQL receipt + job
  → worker 创建/恢复 task + audit + effect
  → effect worker 重新验证 gate 后发送开发验收卡
```

它只验证 event、transport、worker、effect、卡片和回滚能力；不承诺材料提报，更不创建 OA。

## 2. 固定边界

| R1-dev 允许 | R1-dev 禁止 |
| --- | --- |
| 精确单聊命令、receipt/outbox、task/audit、开发验收卡、DLQ/unknown 对账 | 文件收取/下载/解析、card action、Base、Drive、对象存储、renderer、AI、两次确认、审批附件、原生 OA |
| 独立 Dev App/Bot、1–3 名具名测试者、严格 allowlist | 修改线上“拍小宝”、迁移/删除 legacy 路线、生产发布、正式 R2/R3 |
| PostgreSQL、managed bridge、受认证 scheduler、监控和回滚演练 | `POST /approval/v4/instances`；该调用数必须为零 |

现有 “拍小宝” 和 `/api/feishu/process` 保持原样。开发版必须使用独立 App ID、bridge HMAC key、数据库/环境、allowlist、scheduler token；不得让两个 WebSocket consumer 竞争同一个 App 的事件。

## 3. 顺序化需求与无循环前置

具体步骤、Agent 分工、测试与 🥇 以[需求台账](coupon-oa-feishu-dev-requirements-tracker-v1.md)为准：

```text
FDEV-001  可复现 Dev release baseline
  → FDEV-002   CP-RISK-001 durable long-connection ACK / transport
  → FDEV-003A  CP-RISK-002 effect timeout + lease fencing
  → FDEV-003B  CP-RISK-003 effect hash/task/owner binding
  → FDEV-004A  CP-RISK-004 unknown/DLQ reconciliation
  → FDEV-004B  CP-RISK-005 health/metrics/runbook
  → FDEV-004C  CP-RISK-006 retention/redaction/RBAC
  → FDEV-005   独立 Dev 环境预检（不消费真实事件）
  → FDEV-006   R1-dev Shadow → Dark task → card canary
  → FDEV-007   正式 R2 draft-only 文件链路
  → FDEV-008   R3 native OA canary
```

每个条目都必须完成“需求 → 方案 → 开发 → **新的 Test-Plan Agent** → 独立 QA/Test → Bug 修复 → 🥇 → 下一个需求”。任何未 🥇 的条目都不能作为后继需求的已完成前置条件。

### 3.1 FDEV-005：环境预检，不消费事件

FDEV-005 只确认独立 Dev App identity、托管 PostgreSQL、secret store、bridge host、scheduler、route/network policy、allowlist、kill switch 和运行 Owner 值守条件已经配置且默认关闭。它必须证明：

- bridge 不连接、不消费、也不 ACK 任何真实 Feishu 事件；
- command/card-send gate 都保持关闭；
- scheduler 未领取业务 job，或在受控 preflight 中被证明不能产生副作用；
- 不调用 Feishu、Base、Drive、object storage、renderer、AI、Approval 或 native OA。

因此 FDEV-005 不包含 rehearsal，也不形成“先接收事件才能证明可接收事件”的循环。

### 3.2 FDEV-006：首个真实 Dev Bot event 需求

只有 FDEV-001 至 FDEV-005 均取得 🥇，FDEV-006 才能按以下顺序消费独立 Dev Bot 的真实事件：

| Gate | 可打开能力 | 必测结论 |
| --- | --- | --- |
| G1 Shadow | Dev bridge 接收；command/card-send 均关闭 | 签名、nonce、outbox、scheduler、告警和重启恢复正确，且零 task/card side effect。 |
| G2 Dark task | 仅 1 名工程测试者；command 开启、card-send 关闭 | 恰有一笔 task/audit/effect；重复 delivery/job/命令不新增。 |
| G3 Card canary | 单名具名用户、值守窗口；card-send 开启 | 一张开发验收卡；effect 发送前重新验证 stage/flag/allowlist/task/revision/hash。 |
| G4 小 allowlist | 1–3 名开发测试者 | 重放、群聊、非 allowlist、重启、DB 中断、timeout/unknown、kill switch 都安全。 |

卡片不得要求用户上传材料。发送前或发送后任何开关关闭、allowlist 移除、task/revision/hash 不一致、超时或外部结果不明，均应进入 suppressed/DLQ/`outcome_unknown`，不得盲目重发。

## 4. R1-dev Go/No-go 条件

FDEV-006 的真实事件消费前，必须已经由各前置 FDEV 独立证明：

1. clean protected commit/tag 的 FDEV-001 baseline、完整验证和三方 🥇；
2. FDEV-002 的受支持 SDK durable bridge：source ACK 晚于 durable write，relay 重试持久、可恢复、重新签名；
3. FDEV-003A/003B 的 timeout、lease fencing、payload/task/owner/revision integrity；
4. FDEV-004A/004B/004C 的 unknown/DLQ 对账、health/metrics/alerts/runbook、脱敏/retention/RBAC；
5. FDEV-005 的独立环境配置预检与默认关闭证据；
6. 每项的 Test-Plan Agent 测试方案和独立 QA/Test 证据均已纳入对应 🥇。

**立即 No-go / 暂停**：签名/nonce 异常被接收、非 allowlist side effect、task/effect 重复、outbox 过期积压、unknown 未对账、敏感日志、任何材料/Base/Drive/object-store/AI/renderer/Approval 调用，或任何 Approval instance create。

## 5. 验收记录与回滚

每个 FDEV-006 Gate 的 release ref、deployment ID、bridge image digest、migration hash、Dev App 版本、Owner/reviewer、时间窗、脱敏 correlation/task/effect ID 和实际结论必须写入：

- [需求与进度台账](coupon-oa-feishu-dev-requirements-tracker-v1.md)；
- [readiness checklist](../../current/operations/coupon-oa-pilot-launch-readiness-checklist-v1.md)；
- managed bridge runbook；
- 日期化 verification record。

**固定回滚顺序**：关闭 card-send → 关闭 command feature → 冻结 allowlist → 暂停 scheduler/worker claim → 必要时停止 bridge intake → 保留 receipt/outbox/task/audit/effect 证据 → 对账 unknown/DLQ。不得删除积压，也不得盲目重发未知卡片。

## 6. 正式 R2 与 R3 的后续边界

FDEV-007 是独立的正式 R2 发布。只有对象存储、durable file/card-action handlers、来源/产物 hash、标准 workbook/screenshot、两次确认、Base/Drive projection、完整故障 E2E，以及零 native OA create 审计均取得 🥇 后，才可使用 `r2-draft-only` 讨论材料流程。

FDEV-008 的 R3 native OA canary 更晚且独立：必须有隔离审批定义、create/readback、`SubmissionUnknown` 对账、kill switch、回滚演练和 Owner 书面批准。R1-dev 绝不提前获得这些权限。
