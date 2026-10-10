# 优惠券 OA：R0.5 本机长连接 → Vercel 部署 Smoke 方案 v1

> **状态**：提议中的 P1 transport smoke；仅定义手工部署 smoke，不授权 R1-dev、R2、R3、原生 OA 或业务流程测试，也不是 P0 最快 Bot POC 的前置。
>
> **关联**：[ADR-0008](../../../adr/0008-limit-local-lark-cli-to-vercel-integration-smoke.md) · [R0.5 测试用例](coupon-oa-r0.5-local-long-connection-smoke-test-case-v1.md) · [飞书运行阶段参考](../../../../.claude/skills/OA优惠券提报/references/runtime-boundaries.md)

## 1. 目标与非目标

目标是验证一次最小部署链路：测试 Bot 的事件可从本机 `lark-cli` / bridge 签名转发至 Vercel `/api/feishu/bridge`，并由 Vercel 写入隔离测试 PostgreSQL 的 receipt/workflow outbox。

```text
测试用户（普通非命令单聊）
  → 飞书 Dev Bot
  → Mac：lark-cli + pnpm dev:events
  → HTTPS + HMAC
  → Vercel /api/feishu/bridge
  → 测试 PostgreSQL receipt + workflow outbox
  → 脱敏证据核对，不回复用户
```

这不是业务 E2E：不接收 `/OA优惠券提报`、不运行 worker tick、不创建 task/effect/card/file/OA，也不证明飞书 source ACK、转发重试、重连、恢复或 R1-dev 已通过。

## 2. 责任和资源

| 资源 / 动作 | Owner | 边界 |
| --- | --- | --- |
| Vercel 测试 deployment | 工程 / Release Owner | 只部署已审阅 revision；不将此 smoke 写为正式 release baseline。 |
| 测试 PostgreSQL | 数据/运行 Owner | 与 Vercel 可安全连接的隔离测试库；不能使用本机 Docker PostgreSQL 作为 Vercel 运行数据库。 |
| 测试 Feishu App/Bot | 应用管理员 | 可见范围仅限具名测试用户；只有一个 active long-connection consumer。 |
| Mac runner | 测试窗口 Owner | 临时启动，结束立即停止；不作为 R1-dev 常驻 bridge。 |
| HMAC / DB / App secrets | 实际 secret Owner | 只通过 Vercel 或安全本机环境注入；不进入仓库、终端截图、卡片、Base 或证据。 |

## 3. Vercel 测试部署准备

### 3.1 固定输入

1. 选择已经通过本地 `pnpm test`、`pnpm typecheck:server` 和 `git diff --check` 的明确 revision。
2. 创建或选择隔离的 Vercel Preview/测试 deployment；记录 deployment ID、URL、revision、窗口 Owner 和开始时间。
3. 确认目标只使用 HTTPS，bridge target 精确为：

```text
https://<test-deployment-host>/api/feishu/bridge
```

不得指向 `/api/feishu/process`、任意 path、localhost 或带 query/hash 的 URL。

### 3.2 Vercel Preview 环境变量

由有权限 Owner 在 **Preview**（不是 Production）环境配置。下面的 `<...>` 表示只应在 Vercel secret UI 中填写的值，本文件、Git、卡片和聊天记录中不记录实际 secret。

| 环境变量 | R0.5 Preview 值 / 要求 |
| --- | --- |
| `FEISHU_RUNTIME_STAGE` | `r1-intake`；它只让 durable bridge ingress 使用 PostgreSQL，不打开 command/card/R2/OA。 |
| `FEISHU_LEGACY_POC_ENABLED` | `false`。 |
| `FEISHU_APP_ID` | `<测试飞书 App ID>`；必须与本机 `lark-cli` 所属测试 App 一致。 |
| `DATABASE_URL` | `<隔离测试 PostgreSQL URL>`；必须是 Vercel 可访问的 PostgreSQL，不能是本机 Docker URL。 |
| `FEISHU_BRIDGE_KEY_ID` | `<独立测试 HMAC key ID>`。 |
| `FEISHU_BRIDGE_SHARED_SECRET` | `<独立测试 HMAC secret，至少 32 字符>`。 |
| `FEISHU_COUPON_OA_MODE` | `disabled`。 |
| `FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED` | `false`。 |
| `FEISHU_COUPON_THREE_SOURCE_R2_ENABLED` | `false`。 |
| `FEISHU_APP_SECRET`、object-store、tick scheduler 参数 | R0.5 不需要；除非另一个已批准的 FDEV 明确需要，不设置/不调用。 |

`FEISHU_BRIDGE_TARGET_URL`、`FEISHU_BRIDGE_ALLOW_HTTP`、`FEISHU_BRIDGE_KEY_ID` 和 `FEISHU_BRIDGE_SHARED_SECRET` 的**转发目标配置**只属于 Mac runner；Vercel 只需要用于验签的 key ID/secret。`FEISHU_VERIFICATION_TOKEN` 不参与 `/api/feishu/bridge` 的 HMAC 合同。

在 Vercel 中保存变量后，重新部署或确认其已生效。不要通过浏览器控制台、前端变量、卡片或聊天把 secret 传给本机。

### 3.3 数据库 migration 与部署输入

1. 在部署 Preview 前，将 checked-in control-plane migration 安全应用到隔离测试 PostgreSQL；迁移命令只应在 secret 不会进入聊天/日志的受控终端中执行。
2. 记录 migration 文件版本、应用结果和测试数据库清理责任，但不记录连接串。
3. Vercel 控制台从 Git revision 部署，不能自动获得当前本机未提交文件；R0.5 deployment 必须使用明确、可追溯的 Git revision。当前工作区尚未达到 FDEV-001 的 clean release baseline 时，不能把 Dashboard Preview 标注为 FDEV-001、R1-dev 或 R2 证据。
4. 不启用 Vercel Cron、外部 scheduler 或 worker tick。

### 3.4 Vercel 预检

- deployment 可访问且仅使用 HTTPS；
- `/api/feishu/bridge` 对没有有效签名的请求 fail closed；
- 测试数据库连接、migration 状态和 receipt/outbox 所需 schema 已由 Owner 验证；
- 不存在 Vercel Cron、外部 scheduler 或人工请求在本窗口内调用 worker tick；
- Vercel 日志只对指定 Owner 开放。

任一项不成立即 No-go；不得先启动 `lark-cli` 再补配置。

## 4. Mac 长连接 runner 准备

1. 确认本机只有一份测试 App 的 `lark-cli` consumer；停止其它 `lark-cli`、SDK runner、旧 bridge、HTTP callback consumer 或终端复用进程。
2. 使用测试 App/Bot 的现有授权登录；不得使用生产 App 或不明来源凭据。
3. 从安全本机环境提供：

```text
FEISHU_BRIDGE_TARGET_URL=https://<test-deployment-host>/api/feishu/bridge
FEISHU_BRIDGE_KEY_ID=<test-key-id>
FEISHU_BRIDGE_SHARED_SECRET=<test-secret>
FEISHU_BRIDGE_EVENT_TYPES=im.message.receive_v1
FEISHU_BRIDGE_FORWARD_TIMEOUT_MS=10000
```

不要使用 `FEISHU_BRIDGE_ALLOW_HTTP=true`；R0.5 必须指向 Vercel HTTPS。`FEISHU_BRIDGE_EVENT_TYPES` 在本窗口必须精确为 `im.message.receive_v1`，因此不得启动 card callback consumer；`FEISHU_BRIDGE_FORWARD_TIMEOUT_MS` 只能为 `1000–60000` 的整数，默认 `10000`。

bridge 遇到 malformed stdout、超时、网络错误或非 `2xx` Vercel 响应会停止全部本机 consumer 并以非零状态退出。该 fail-closed 停止不提供重试或恢复语义；不要为了补偿而重发同一条消息。

4. 启动：

```bash
pnpm dev:events
```

5. 确认日志只显示目标 host 和脱敏 event ID；若显示 secret、完整 payload、完整用户 ID 或附件内容，立即停止并按安全事件处理。

> 当前 `lark-cli 1.0.96` 可能在 stdout bridge 转发与 Vercel 写入前 ACK。runner 启动成功不代表 delivery 已 durable，也不代表发生问题时飞书会重推。

## 5. 受控 smoke 执行

| 步骤 | 执行 | 预期事实 |
| --- | --- | --- |
| T01 | 由可见范围内的测试用户向 Bot 发送一条普通**非**`/OA优惠券提报`的单聊文本。 | 不触发业务 command、卡片或材料逻辑。 |
| T02 | 观察 Mac bridge。 | 只记录收到/转发的脱敏 stable ID；无 secret/payload 泄露。 |
| T03 | 观察 Vercel request log。 | 已到达的有效签名请求由 ingress 处理；非法 HMAC/path/timestamp/nonce 应被拒绝。 |
| T04 | 由授权 Owner 核对测试 PostgreSQL。 | 已到达 Vercel 的 delivery 只产生预期 receipt/workflow outbox；task、effect、用户回复、card、file、Base/Drive、AI、Approval/OA 计数均为零。 |
| T05 | 正常停止 Mac runner（`SIGINT`/Ctrl-C）。 | 唯一消息 `lark-cli` child 停止；记录停止时间。 |
| T06 | 关闭测试窗口并复核。 | 保存 deployment ID、时间窗、脱敏 delivery/correlation ID、receipt/outbox 计数、零副作用结果和结论。 |

不调用 `/api/internal/control-plane/tick`，不回复测试用户，也不把 Vercel `202` 解释为飞书 source ACK 成功。

## 6. 停止、异常与回滚

### 正常停止

```text
停止 Mac pnpm dev:events
→ 确认无第二 consumer
→ 保存脱敏 Vercel/数据库证据
→ 结束测试窗口
```

### 立即停止条件

- `[bridge] forward error`、Vercel 非预期响应或超时；
- 两个 active consumer；
- secret、原始 payload、open ID 或附件内容泄露；
- 意外 task/effect/Bot 回复/card/file/Base/Drive/AI/Approval/OA；
- 目标 URL 不是精确的 Vercel HTTPS bridge ingress；
- 有 worker tick、command/card/OA Gate 被打开。

停止后不要重复发送同一消息来“补齐”事件：`lark-cli` 可能已经 ACK，必须把事件记为可能丢失。若 secret 泄露，按安全流程轮换，而不是继续使用旧 key。

## 7. 结果分类与后续动作

| 结果 | 可记录结论 | 不可记录结论 |
| --- | --- | --- |
| R0.5 通过 | 一条已抵达 Vercel 的测试请求已通过 HMAC ingress 并产生预期 receipt/outbox；零业务副作用。 | 飞书可靠交付、R1-dev/R2、业务命令、卡片、OA 或上线就绪。 |
| R0.5 失败 | 记录失败时间、脱敏 ID、影响面和停止动作。 | “稍后会自动恢复”或“重试后等价成功”。 |

R0.5 结束后，主开发顺序不变：FDEV-001 baseline → FDEV-002 官方 SDK durable runner → FDEV-003A/003B → FDEV-004A–004C → FDEV-005 → FDEV-006 → FDEV-007 方案 A 完整材料/OA 测试稿 handoff → FDEV-008 原生 OA canary。
