# 三源优惠券本机长连接 draft-only POC 运行手册 v1

> **状态**：需求方已选择的单用户、限时测试手册；仍待相关 Owner 审阅。不是 R1/R2/R3、生产上线、可靠事件接收或原生 OA 授权。
> **日期**：2026-10-10
> **适用拓扑**：飞书测试 App 长连接 → 本机 `lark-cli` / P0 bridge runner → Vercel `POST /api/feishu/poc-bridge` → 三业务模式三源 Bot → OA 测试稿。
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

禁止：真实原生 OA 创建、最终发送、多人/群聊、批量、R1/R2/R3/FDEV 完成声称、长期常驻、把本地 Claude Code Skill 当作运行时代码，或把 P0 AI effect 的局部持久化表述为完整事件可靠性。仅当本节 AI Gate 全部满足时，允许 worker tick 处理 `coupon_three_source_ai_recognition`；它不修复本机 runner 可能丢事件的限制。

## 1. 固定范围

| 项目 | P0 行为 |
| --- | --- |
| 用户与会话 | 一个 allowlist 用户、Bot 单聊、同一时刻一笔任务。 |
| 业务 | 仅常规满减券、SKU 名单；支持 `严选`、`寄卖`、`POP`。白名单必传，黑名单可选但必须显式确认无黑名单。严选无测算图片；寄卖/POP 必须有确认后的用户图或自动生成图。 |
| 事件接入 | 唯一 `lark-cli` consumer → HMAC → `/api/feishu/poc-bridge`；不切换开发者服务器回调。 |
| 文件 | runner 的预渲染文件文本不能替代真实元数据；服务端只在 active allowlisted P0 任务内回读消息获得 `file_key`。 |
| 产物 | 标准配券表、标准白名单、可选标准黑名单；源文件不进入 OA 附件。 |
| OA | 只创建既有 OA 测试稿；`FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false`。 |
| 恢复 | 不保证。forward failure、timeout、重复或未知状态一律停止并人工核对。 |
| AI | 默认关闭；启用 AI-primary 时优先理解任意 Excel 布局并提出带证据候选和活动文案。第二轮 owner 确认后由确定性模板生成，DeepSeek 不生成 Excel。 |

## 2. 部署前配置

所有值只能由有权限 Owner 写入 Vercel secret/configuration store 或受控 Mac 环境。不要将值放进 Git、文档、截图、终端命令行、日志或聊天。

### 2.1 Vercel Preview/测试环境

部署明确 Git revision 后，配置现有 App/OA 草稿/三源资源变量，以及：

`p0-three-source-direct-http` 的 Preview 构建会在 `DATABASE_URL` 有效时先执行仓库内追加式 control-plane migration；其他 Preview 分支、本地构建和 Production 均跳过。构建日志只能记录 migration 文件名与 applied/already applied 状态，不能打印连接串。

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
| `FEISHU_COUPON_THREE_SOURCE_P0_AI_RECOGNITION_ENABLED` | 默认 `false`。只有完成迁移、worker、隐私与 kill-switch 核对后才可在单次窗口设为 `true`。 |
| `FEISHU_COUPON_THREE_SOURCE_P0_AI_PRIMARY_ENABLED` | 默认 `false`。仅在 AI recognition 已启用时可设为 `true`；开启后 AI 候选优先，规则只补缺项。 |
| `FEISHU_COUPON_THREE_SOURCE_P0_AI_SHADOW_ENABLED` | 默认 `false`。只记录候选、不改变用户可见结果；不得与 primary 同时开启。 |
| `FEISHU_COUPON_THREE_SOURCE_P0_ACTIVITY_COPY_ENABLED` | 默认 `false`。开启后才把通过事实校验的活动名称/背景候选回填第二轮卡。 |
| `FEISHU_COUPON_THREE_SOURCE_P0_PUBLIC_CALENDAR_ENABLED` | 默认 `false`。只用于缺年份日期和公开活动主题的软证据，不是通用互联网搜索。 |
| `FEISHU_COUPON_THREE_SOURCE_P0_PUBLIC_CALENDAR_ENDPOINT`、`..._TIMEOUT_MS` | 仅日历 Gate 开启时配置受控 HTTPS JSON endpoint；请求不得包含工作簿、员工、SKU 或券额。 |
| `FEISHU_COUPON_THREE_SOURCE_P0_AI_TIMEOUT_MS` | 默认 `45000`，允许范围 1000–120000。 |
| `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` | 只在 AI Gate 开启时需要；base URL 必须是官方 HTTPS endpoint。实际值不得进入聊天、日志或文档。 |
| `DATABASE_URL`、`FEISHU_WORKER_ID`、`CONTROL_PLANE_TICK_TOKEN` | AI Gate 开启时必须配置；用于 migration 0005、durable effect 与受保护 tick。 |

`FEISHU_VERIFICATION_TOKEN` 不参与 P0 bridge 的 HMAC 合同，也不需要配置 URL challenge；保留已有值不会授权此路径。

### 2.2 Mac runner 环境

Mac 仅在窗口内保存以下值并执行；不要把真实值复制到 shell history、截图或聊天：

```dotenv
FEISHU_BRIDGE_P0_MODE=true
FEISHU_BRIDGE_TARGET_URL=https://<已部署测试域名>/api/feishu/poc-bridge
FEISHU_P0_EXPECTED_GIT_SHA=<该 Preview 对应的完整 40 位 Git SHA>
FEISHU_BRIDGE_KEY_ID=<与 Vercel 相同的测试 key ID>
FEISHU_BRIDGE_SHARED_SECRET=<与 Vercel 相同的测试 secret>
FEISHU_BRIDGE_EVENT_TYPES=im.message.receive_v1,card.action.trigger
FEISHU_BRIDGE_FORWARD_TIMEOUT_MS=10000
VERCEL_AUTOMATION_BYPASS_SECRET=<仅当 Preview 开启 Deployment Protection 时填写>
```

- 不设 `FEISHU_BRIDGE_ALLOW_HTTP=true`；P0 对 Vercel 必须 HTTPS。
- P0 mode 要求精确 `/api/feishu/poc-bridge`；不能指向 `/api/feishu/bridge`、`/api/feishu/process`、任意 query/hash 或其它域名路径。
- P0 bridge 与 worker 启动前都必须通过 `/api/deployment-identity` 回读并严格匹配 `FEISHU_P0_EXPECTED_GIT_SHA`。旧 Preview 没有身份端点、SHA 缺失或不一致时立即退出，禁止消费共享 PostgreSQL 队列。
- Preview 开启 Deployment Protection 时，本机 runner 必须从受控环境读取 `VERCEL_AUTOMATION_BYPASS_SECRET`。runner 仅把它放入 `x-vercel-protection-bypass` header；它不参与飞书 HMAC、不得复用 `FEISHU_BRIDGE_SHARED_SECRET`，也不得写入日志或聊天。
- 通过受控本机环境保持测试 App/Bot 授权；不能使用生产 App 或不明来源凭据。

### 2.3 飞书测试 App

1. **保持长连接事件模式**；不要切换为开发者服务器回调，不配置 callback URL，也不做 URL challenge。
2. 订阅并对测试 Bot 生效 `im.message.receive_v1` 和 `card.action.trigger`，且 Bot 只对唯一测试用户可见。
3. 测试前确认没有其它 `lark-cli`、SDK runner、旧 bridge 或 HTTP callback consumer。一次只能有一个 active consumer。
4. 不为解决问题扩大权限或可见范围。消息、文件下载、Base、Drive、Approval 所需权限缺失时关闭 POC，交应用管理员做最小权限评审。

## 3. 启动顺序

### 3.0 日常 Preview 快速迭代

首次把本机凭据写入权限为 `0600`、Git 忽略的
`.local/p0-preview.env` 后，日常迭代使用仓库命令，不再手工复制部署 URL、
修改临时 relay 或编写 `curl` tick 循环：

```bash
pnpm p0:preview:check   # 只读检查
pnpm p0:preview:deploy  # 仅部署并回读完整 revision
pnpm p0:preview:up      # 部署后启动唯一 bridge 与 worker
pnpm p0:preview:status  # 只读状态与 revision 回读
pnpm p0:preview:down    # 只停止状态文件中验证为本次会话的进程
```

`deploy`/`up` 只允许 `p0-three-source-direct-http` 的干净、可复现工作区，
并直接使用 `x-vercel-protection-bypass` 请求头访问受保护 Preview。
命令成功只证明部署身份和本机进程状态，不代表飞书 E2E、Base/Drive 产物或
OA 测试稿成功。详细操作边界由仓库 Skill `p0-preview-deploy` 约束。

### 3.1 飞书测试前本地 Gate

开始 bridge 或邀请 owner 在飞书测试前，必须同时满足：相关单元/集成测试通过；
脱敏 Excel 的显式 DeepSeek 预检通过；`pnpm typecheck` 与 `pnpm build` 通过；
变更文件的 Biome 检查和 `git diff --check` 通过；Preview 身份端点回读的 Git SHA
与预期 revision 完全一致。任何一项失败都不得启动新测试窗口。原生 OA、native submit
与未授权生成副作用必须继续关闭。

1. 使用只含 P0 long-connection scope 的 Git revision 部署 Vercel；不得发布当前脏工作区或 P1 control-plane 文件。
2. 复核 Vercel 中 native kill switch 为 `false`、三源 pilot 为 `false`，并确认 `/api/feishu/poc-bridge` 对无效 HMAC fail closed。
3. 若本次不测 AI，确认 AI 开关仍为 `false`，跳过 migration/tick。若本次明确测试 AI，先执行 `pnpm db:migrate:control-plane`，确认 `0005_coupon_ai_recognition_runs.sql` 已应用，再对受保护的 control-plane tick 做无业务副作用健康检查；`local` 阶段仅在 AI Gate 明确开启时允许该 tick，且仍必须通过独立 Bearer token、数据库与 worker 配置检查。任一失败都关闭 AI 开关。
4. 在 Mac 确认单 consumer 后启动：
   ```bash
   pnpm dev:coupon-three-source:p0
   ```
   AI Gate 开启时，在同一组 `FEISHU_BRIDGE_TARGET_URL`、`FEISHU_P0_EXPECTED_GIT_SHA` 和 Protection Bypass 环境下另启受控 worker：
   ```bash
   pnpm dev:coupon-three-source:p0-worker
   ```
   worker 启动时会扫描本机进程；发现第二个 guarded worker 或任何包含 `/api/internal/control-plane/tick` 的旧 `curl` 循环时立即退出。不再用手写 `curl` 循环触发 tick，也不得从未校验 revision 的临时 URL 文件恢复 worker。
   日志只能显示目标 host、event type 和脱敏 ID；若看到 secret、完整 payload、完整 open ID 或附件内容，立刻停止。
5. runner 的启动/HTTP 成功不代表可恢复，也不代表业务成功。启动后保持 pilot flag 关闭，直到明确记录测试窗口。

## 4. 单次 E2E

首次只使用本仓库 `reference/fixtures/three-mode-screenshots/` 中的脱敏 fixture，并先完成本地测试计划。真实飞书验证按严选无图、寄卖用户图、POP 自动图的顺序逐个执行。

1. 在明确窗口为唯一测试用户打开 `FEISHU_COUPON_THREE_SOURCE_PILOT_ENABLED=true`。
2. 在 Bot 单聊发送精确 `/OA优惠券提报`，确认收到材料收集卡。
3. 发送原始配券表和 SKU 白名单 `.xlsx`；可发送 SKU 黑名单。文件事件由服务端按 message ID 回读原始 `file_key`，但源文件不得出现在 OA 附件中。上传阶段不应逐文件发卡或调用 DeepSeek；全部材料发送完后，在最初的收集卡点击“材料已上传完毕，开始统一识别”。
4. AI-primary 开启时只应出现一张“AI 识别中”；worker 完成整批识别后只应再出现一条汇总第二轮卡片消息。后续无黑名单、超扣选择和补充说明识别必须原位更新这条消息，聊天中不得再追加第二、第三张同名卡片。卡片必须只显示中文业务字段、摘要及不含敏感信息的 DeepSeek 状态，不得出现 Sheet、列号、坐标、内部 key、prompt version 或技术映射选择器。在该卡检查系统识别的唯一券模板、全部券档、缺失字段、名单摘要、OA 活动点位，以及未上传黑名单时的“本次无黑名单”声明；同一常规满减模板的多行是多个券档，不要求只选一行。已登记的名单多 Sheet 自动对应全部券档。无年份日期或公开活动主题必须标记“系统推测”并由 owner 确认。活动名称不得是占位语，活动背景必须覆盖全部券档。业务员也可用系统输入法把语音转写到可编辑补充说明框，检查文字后点击识别回填；AI 只填补空白字段，不能覆盖 owner 已输入的非空内容，提交前仍可修改。有白黑名单交集时再作出明确决定。
5. 确认生成标准附件，记录脱敏 revision、角色和 hash 前缀。严选不得含 `calcImage`；寄卖/POP 需核对所有图片页数和顺序。用户发送新图片批次时，必须明确选择“追加”或“整组替换”。

### 三业务模式与图片回归矩阵

- 严选无图：生成 Excel 产物，渲染器和审批图片上传均不调用；
- 寄卖用户图：直接图片消息与 PNG/JPEG 文件均可归一化，用户图优先且保持顺序；
- POP 自动图：未上传用户图时，从最终标准配券表显示值生成全部分页；
- 多图追加/替换：重复消息、重复 hash、重复 callback 不增加条目，整组替换遇到任一无效图片时保留旧集合；
- 错误与回滚：伪装图片、损坏图片、渲染失败、部分 Drive 上传失败、回读 hash 变化均不得创建 OA 测试稿；
- Gate：全程验证 native-submit 未调用，系统只创建既有 OA 测试稿。
6. 点击“确认并创建 OA 测试稿”。收到既有 OA 草稿预览卡即为本次成功终点。
7. **不点击**预览卡中的最终正式发送动作。核对 native kill switch 仍关闭，审批中心没有新增原生实例，草稿无 instance code/link。
8. 立即关闭 pilot flag、停止 runner，并写入脱敏结论。

若测试任务因错误卡片、错误材料或中断而无法继续，当前测试用户发送精确 `/clear`。确认收到“当前三源提报已清空”或“当前已是清空状态”后，再重新发送 `/OA优惠券提报` 并重新上传材料。`/clear` 只把活动任务标记为 `Canceled`，不会删除 Base/Drive 审计记录，也不会复用旧文件；不得通过手工删除 Base 行或 Drive 文件代替该恢复路径。

## 5. 停止与回滚

以下任一项立即停止 runner，关闭 pilot flag；不要重发同一消息或卡片：forward failure/timeout、runner/child 退出、malformed event、重复 callback、Vercel 重启、Base/Drive/消息回读失败、双 consumer、敏感日志、陌生用户副作用或原生 OA 迹象。

处理顺序：

1. 保持 `FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false`；有疑义先关闭所有 coupon pilot flag。
2. 立即设置 `FEISHU_COUPON_THREE_SOURCE_P0_AI_PRIMARY_ENABLED=false`、`FEISHU_COUPON_THREE_SOURCE_P0_ACTIVITY_COPY_ENABLED=false`、`FEISHU_COUPON_THREE_SOURCE_P0_PUBLIC_CALENDAR_ENABLED=false` 和 `FEISHU_COUPON_THREE_SOURCE_P0_AI_RECOGNITION_ENABLED=false`，停止新的 AI effect；已是终态但尚未投影的 run 只允许人工核对，不得重新外发。
3. Ctrl-C 停止本机 runner，确认其 child consumer 已退出。
4. 不把飞书 ACK、runner stdout、HTTP 200 或卡片重试解释为已安全处理。
5. 人工核对已有 Base/Drive 标准产物和 OA 测试稿；不得以“补偿”为由创建真实 OA。
6. 只保留脱敏的窗口、revision、事件类型、状态、hash 前缀和动作，不记录 secret、签名、完整 payload、file key、完整 open ID、prompt/response 或附件内容。

## 6. 证据与退出

每个窗口至少记录：部署 revision、测试时间、测试 Owner、single-consumer 核对、allowlist/kill-switch/pilot 状态、命令/卡片/材料阶段、标准产物 hash 摘要、OA 测试稿状态、没有原生 OA 的核对结论、runner 停止时间和任何 blocker。

完成不代表完整 Skill 迁移、可靠长连接或生产部署。需要多用户、恢复、长期运行、完整 Skill 合同或真实 OA 时，另行进入 P1 评审。
