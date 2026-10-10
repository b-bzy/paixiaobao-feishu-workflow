# 优惠券 OA：R0.5 本机长连接 → Vercel 手工 Smoke 测试用例 v1

> **状态**：提议中；未执行，不是上线 checklist 或 R1-dev 验收记录。
>
> **适用范围**：仅 [ADR-0008](../../../adr/0008-limit-local-lark-cli-to-vercel-integration-smoke.md) 定义的 `R0.5-manual-smoke`。
>
> **目的**：验证本机 `lark-cli` → 本机 bridge → Vercel `/api/feishu/bridge` 的最小 transport 连通性，同时证明所有业务副作用与 Bot 用户回复均保持关闭。

## 1. 禁止推断的结论

本用例通过也不能证明：`lark-cli` source ACK 晚于持久化、事件不丢失、断网/重连/崩溃恢复、durable outbox、R1-dev、正式 R2、方案 A 的文件/Card adapter、OA 测试稿 handoff 或原生 OA 已完成。当前 `lark-cli 1.0.96` 在 stdout bridge 转发/Vercel 写入前可返回 SDK 成功，因此 forward failure 必须按可能丢失处理。

它不改变 `FEISHU_RUNTIME_STAGE`，不启动 FDEV-002，不替代新的 Test-Plan Agent 或独立 QA/Test。Vercel 在 PostgreSQL 中完成 receipt/outbox transaction 后才形成系统内可核对边界；本用例不将该事实转换成用户可见回复。

## 2. 测试前置条件

| 检查项 | 必须事实 |
| --- | --- |
| Vercel | 独立测试 deployment 健康；目标 URL 使用 HTTPS 且精确为 `/api/feishu/bridge`。 |
| 数据库 | Vercel 使用隔离测试 PostgreSQL；不得把本机 Docker PostgreSQL 当作 Vercel 运行数据库。 |
| Bot / consumer | 独立 Dev App/Bot；测试窗口内只有本机这一份 `lark-cli` consumer。 |
| 本机 bridge | 使用当前 `pnpm dev:events`；`FEISHU_BRIDGE_EVENT_TYPES` 必须精确为 `im.message.receive_v1`，`FEISHU_BRIDGE_FORWARD_TIMEOUT_MS` 为 `1000–60000` 的整数（默认 `10000`）；不得后台启动第二份。 |
| 密钥 | `FEISHU_BRIDGE_TARGET_URL`、`FEISHU_BRIDGE_KEY_ID`、`FEISHU_BRIDGE_SHARED_SECRET` 只存在于安全的本机环境；不打印、截图或上传。`FEISHU_BRIDGE_EVENT_TYPES=im.message.receive_v1` 不启动 card callback consumer。 |
| Gate | command、card-send、`FEISHU_COUPON_THREE_SOURCE_R2_ENABLED`、native-submit 和 Approval create 均保持关闭；worker tick 不运行。 |
| 观察 | 测试 Owner 可查看 Vercel request log 和测试 PostgreSQL 中脱敏 receipt/outbox 计数。 |

任一前置条件不能证实时，结论为 **No-go**，不得启动 bridge。

## 3. 测试步骤

| ID | 动作 | 期望 / 可记录证据 |
| --- | --- | --- |
| S01 | 在本机确认没有其它 `lark-cli`、SDK runner、HTTP callback consumer 或旧 bridge。 | 单一 consumer 事实、时间窗、Owner。 |
| S02 | 从安全环境启动 `pnpm dev:events`。 | 日志仅显示脱敏目标 host、事件类型和 stable ID，不记录 shared secret、完整 payload、完整 open ID、附件数据或远端错误响应 body；只启动一个消息 consumer。 |
| S03 | 由测试 Bot allowlist 用户发送一条**非**`/OA优惠券提报`的普通单聊文本。 | 本机只显示已接收/已转发的脱敏 stable ID；Vercel request log 返回 bridge 请求结果。 |
| S04 | 查看 Vercel 和测试 PostgreSQL。 | 合法请求由 Vercel durable-accept；至多有预期 transport receipt/workflow outbox，零 task、effect、Bot 回复、card、文件、Base/Drive、AI、Approval/OA 副作用。 |
| S05 | 停止本机 `pnpm dev:events`（正常 `SIGINT`）。 | 唯一消息 `lark-cli` child 停止；记录停止时间。 |
| S06 | 测试窗口结束后复核。 | 无未知积压/业务副作用；保存 deployment ID、时间窗、脱敏 correlation/delivery ID、receipt/outbox 计数和结论。 |

**不得**使用 `/OA优惠券提报`、上传文件、点击 Card action、调用 protected tick 或打开任一 feature gate 作为本用例的一部分。

## 4. 失败处理

| 观察到的情形 | 动作 | 结论 |
| --- | --- | --- |
| `[bridge] forward failed`、malformed stdout、Vercel 非预期响应或超时 | bridge 应立即停止唯一 consumer 并以非零状态退出；记录时间/脱敏 ID；`lark-cli` 可能已经 ACK，按可能丢失处理，不假设自动重发。 | No-go；不能重试到“看起来成功”为止。 |
| 多个 consumer 或未知长连接进程 | 停止所有 intake，确认唯一 consumer 后才可开始新的窗口。 | No-go。 |
| 意外 task/card/file/Base/Drive/AI/Approval/OA 副作用 | 关闭相关 Gate、保留 receipt/audit、按对应流程对账。 | 安全事件 / No-go。 |
| 签名、nonce、时间戳或路径遭拒绝 | 保持 Gate 关闭，检查测试配置；不记录/传播密钥。 | 负向验证事实，不等于可用。 |
| 敏感日志、凭据或完整 payload 暴露 | 停止测试、轮换受影响凭据并按安全流程处理。 | 安全事件 / No-go。 |

## 5. 记录模板

| 字段 | 值 |
| --- | --- |
| 日期与测试窗口 | Not yet recorded |
| Vercel deployment ID | Not yet recorded |
| Test App/Bot 标识（脱敏） | Not yet recorded |
| 本机 bridge 版本 / Git revision | Not yet recorded |
| 唯一 consumer 复核 | Not yet recorded |
| 启用的业务 Gate | Not yet recorded — 必须全为关闭 |
| S03 HTTP 结果 | Not yet recorded |
| receipt / workflow outbox / task / effect 计数 | Not yet recorded |
| 禁止副作用计数 | Not yet recorded |
| 停止与清理结果 | Not yet recorded |
| Owner / 结论 | Not yet recorded — 默认 No-go |

## 6. 后续边界

R0.5 成功后只允许记录“本机长连接至 Vercel ingress 的一次手工 smoke 已执行”。FDEV-002 仍必须将 `lark-cli` 替换为受支持 SDK durable runner，并由新的 Test-Plan Agent 和独立 QA/Test 验证 source ACK、持久 retry、重连、崩溃恢复和 DLQ，才可讨论 R1-dev。
