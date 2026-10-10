# 三源优惠券本机长连接 draft-only POC 运行手册 v1

> **状态**：需求方已选择的单用户、限时测试手册；仍待相关 Owner 审阅。不是 R1/R2/R3、生产上线、可靠事件接收或原生 OA 授权。
> **日期**：2026-10-10
> **适用拓扑**：飞书测试 App 长连接 → 本机 `lark-cli` / P0 bridge runner → Vercel `POST /api/feishu/poc-bridge` → 严选三源 Bot → OA 测试稿。
> **权威边界**：[ADR-0010](../../../adr/0010-timebox-local-long-connection-three-source-poc.md)；业务范围以 [P0 最快 Bot POC 交付计划](../../proposals/three-source/coupon-three-source-fast-poc-delivery-plan-v1.md) 为准。

## 0. 目的与限制

本手册验证一个严格 allowlist 用户从精确 `/OA优惠券提报` 到标准附件和既有 OA **测试稿**的闭环：

```text
精确命令 + 三源 .xlsx
  → 材料/映射/无黑名单/交集卡片
  → 严选标准 Excel 产物
  → OA 测试稿和预览
```

它使用本机长连接是为了保持测试 App 的现有事件模式，**不是**因为本机 runner 已具备可靠交付能力。`lark-cli` 可能在转发完成前 ACK；电脑休眠、断网、runner 停止或 HTTP 失败可能造成已确认事件丢失。任何这种事件均停止而非重发。

禁止：真实原生 OA 创建、最终发送、多人/群聊、批量、R1/R2/R3/FDEV 完成声称、长期常驻、worker tick、持久化/retry/DLQ 声称，或把本地 Claude Code Skill 当作运行时代码。

## 1. 固定范围

| 项目 | P0 行为 |
| --- | --- |
| 用户与会话 | 一个 allowlist 用户、Bot 单聊、同一时刻一笔任务。 |
| 业务 | 仅常规满减券、`严选`、SKU 名单；白名单必传，黑名单可选但必须显式确认无黑名单。 |
| 事件接入 | 唯一 `lark-cli` consumer → HMAC → `/api/feishu/poc-bridge`；不切换开发者服务器回调。 |
| 文件 | runner 的预渲染文件文本不能替代真实元数据；服务端只在 active allowlisted P0 任务内回读消息获得 `file_key`。 |
| 产物 | 标准配券表、标准白名单、可选标准黑名单；源文件不进入 OA 附件。 |
| OA | 只创建既有 OA 测试稿；`FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false`。 |
| 恢复 | 不保证。forward failure、timeout、重复或未知状态一律停止并人工核对。 |

## 2. 部署前配置

所有值只能由有权限 Owner 写入 Vercel secret/configuration store 或受控 Mac 环境。不要将值放进 Git、文档、截图、终端命令行、日志或聊天。

### 2.1 Vercel Preview/测试环境

部署明确 Git revision 后，配置现有 App/OA 草稿/三源资源变量，以及：

| 变量 | POC 要求 |
| --- | --- |
| `FEISHU_RUNTIME_STAGE` | `local`。 |
| `FEISHU_LEGACY_POC_ENABLED` | `false`。 |
| `FEISHU_BRIDGE_KEY_ID`、`FEISHU_BRIDGE_SHARED_SECRET` | 独立测试 HMAC key ID/32+ 字符 shared secret；与 Mac 一致。 |
| `FEISHU_APP_ID`、`FEISHU_APP_SECRET` | 当前测试 App 的服务端凭据，供 Bot、消息回读、Base、Drive 与 Approval API 调用。 |
| `FEISHU_COUPON_OA_MODE` | `native-submit`，仅为复用现有 OA 测试稿 handoff；不是 native 授权。 |
| `FEISHU_COUPON_OA_ALLOWED_OPEN_IDS` | 唯一测试用户。 |
| `FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED` | 必须 `false`。 |
| `FEISHU_COUPON_OA_NATIVE_SUBMIT_ALLOWED_OPEN_IDS` | 留空或仅测试用户；native kill switch 仍必须关闭。 |
| `FEISHU_COUPON_OA_APPROVAL_CODE`、`FEISHU_COUPON_DRAFT_TABLE_ID` | 已验证的隔离 OA 测试稿配置。 |
| `FEISHU_COUPON_THREE_SOURCE_PILOT_*` | 已创建的专属 Base/表/Drive；`..._PILOT_ENABLED=false` 直到测试窗口。 |

`FEISHU_VERIFICATION_TOKEN` 不参与 P0 bridge 的 HMAC 合同，也不需要配置 URL challenge；保留已有值不会授权此路径。

### 2.2 Mac runner 环境

Mac 仅在窗口内保存以下值并执行；不要把真实值复制到 shell history、截图或聊天：

```dotenv
FEISHU_BRIDGE_P0_MODE=true
FEISHU_BRIDGE_TARGET_URL=https://<已部署测试域名>/api/feishu/poc-bridge
FEISHU_BRIDGE_KEY_ID=<与 Vercel 相同的测试 key ID>
FEISHU_BRIDGE_SHARED_SECRET=<与 Vercel 相同的测试 secret>
FEISHU_BRIDGE_EVENT_TYPES=im.message.receive_v1,card.action.trigger
FEISHU_BRIDGE_FORWARD_TIMEOUT_MS=10000
```

- 不设 `FEISHU_BRIDGE_ALLOW_HTTP=true`；P0 对 Vercel 必须 HTTPS。
- P0 mode 要求精确 `/api/feishu/poc-bridge`；不能指向 `/api/feishu/bridge`、`/api/feishu/process`、任意 query/hash 或其它域名路径。
- 通过受控本机环境保持测试 App/Bot 授权；不能使用生产 App 或不明来源凭据。

### 2.3 飞书测试 App

1. **保持长连接事件模式**；不要切换为开发者服务器回调，不配置 callback URL，也不做 URL challenge。
2. 订阅并对测试 Bot 生效 `im.message.receive_v1` 和 `card.action.trigger`，且 Bot 只对唯一测试用户可见。
3. 测试前确认没有其它 `lark-cli`、SDK runner、旧 bridge 或 HTTP callback consumer。一次只能有一个 active consumer。
4. 不为解决问题扩大权限或可见范围。消息、文件下载、Base、Drive、Approval 所需权限缺失时关闭 POC，交应用管理员做最小权限评审。

## 3. 启动顺序

1. 使用只含 P0 long-connection scope 的 Git revision 部署 Vercel；不得发布当前脏工作区或 P1 control-plane 文件。
2. 复核 Vercel 中 native kill switch 为 `false`、三源 pilot 为 `false`，并确认 `/api/feishu/poc-bridge` 对无效 HMAC fail closed。
3. 在 Mac 确认单 consumer 后启动：
   ```bash
   pnpm dev:coupon-three-source:p0
   ```
   日志只能显示目标 host、event type 和脱敏 ID；若看到 secret、完整 payload、完整 open ID 或附件内容，立刻停止。
4. runner 的启动/HTTP 成功不代表可恢复，也不代表业务成功。启动后保持 pilot flag 关闭，直到明确记录测试窗口。

## 4. 单次 E2E

首次只使用已授权、脱敏的 `严选` 常规满减 fixture。

1. 在明确窗口为唯一测试用户打开 `FEISHU_COUPON_THREE_SOURCE_PILOT_ENABLED=true`。
2. 在 Bot 单聊发送精确 `/OA优惠券提报`，确认收到材料收集卡。
3. 发送原始配券表和 SKU 白名单 `.xlsx`；可发送 SKU 黑名单。文件事件由服务端按 message ID 回读原始 `file_key`，但源文件不得出现在 OA 附件中。
4. 完成材料角色、歧义字段/名单列、OA 活动点位；未提供黑名单时点“确认本次无黑名单”，有交集时作出明确决定。
5. 确认生成标准附件，记录脱敏 revision、角色和 hash 前缀；严选 P0 不要求 `calcImage`。
6. 点击“确认并创建 OA 测试稿”。收到既有 OA 草稿预览卡即为本次成功终点。
7. **不点击**预览卡中的最终正式发送动作。核对 native kill switch 仍关闭，审批中心没有新增原生实例，草稿无 instance code/link。
8. 立即关闭 pilot flag、停止 runner，并写入脱敏结论。

## 5. 停止与回滚

以下任一项立即停止 runner，关闭 pilot flag；不要重发同一消息或卡片：forward failure/timeout、runner/child 退出、malformed event、重复 callback、Vercel 重启、Base/Drive/消息回读失败、双 consumer、敏感日志、陌生用户副作用或原生 OA 迹象。

处理顺序：

1. 保持 `FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false`；有疑义先关闭所有 coupon pilot flag。
2. Ctrl-C 停止本机 runner，确认其 child consumer 已退出。
3. 不把飞书 ACK、runner stdout、HTTP 200 或卡片重试解释为已安全处理。
4. 人工核对已有 Base/Drive 标准产物和 OA 测试稿；不得以“补偿”为由创建真实 OA。
5. 只保留脱敏的窗口、revision、事件类型、状态、hash 前缀和动作，不记录 secret、签名、完整 payload、file key、完整 open ID 或附件内容。

## 6. 证据与退出

每个窗口至少记录：部署 revision、测试时间、测试 Owner、single-consumer 核对、allowlist/kill-switch/pilot 状态、命令/卡片/材料阶段、标准产物 hash 摘要、OA 测试稿状态、没有原生 OA 的核对结论、runner 停止时间和任何 blocker。

完成不代表完整 Skill 迁移、可靠长连接或生产部署。需要多用户、恢复、长期运行、完整 Skill 合同或真实 OA 时，另行进入 P1 评审。
