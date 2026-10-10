# 优惠券 OA 综合 Skill 飞书适配升级方案 v1

> **状态**：本文件现为 **P1** 完整 Skill 合同与长期架构目标；需求方当前优先执行更小的 [P0 最快 Bot POC](coupon-three-source-fast-poc-delivery-plan-v1.md)。P1 仍待业务、流程、模板、应用与技术 Owner 评审，不代表 Bot 路线已经上线或 native-submit 已开放。
> **日期**：2026-10-09
> **唯一目标命令**：`/OA优惠券提报`
> **关联**：[P0 最快 Bot POC 交付计划](coupon-three-source-fast-poc-delivery-plan-v1.md) · [综合 Skill](../../../../.claude/skills/OA优惠券提报/SKILL.md) · [三源 PRD](coupon-oa-three-source-workflow-prd-v1.md) · [三源离线测试](coupon-oa-three-source-offline-test-plan-v1.md) · [内网试点 rollout](../../current/operations/coupon-oa-internal-pilot-rollout-plan-v1.md) · [ADR-0004](../../../adr/0004-bot-confirmed-submit-for-coupon-oa.md) · [ADR-0006](../../../adr/0006-use-managed-long-connection-bridge-for-internal-coupon-pilot.md)

## 0. P0 与 P1 的边界

P0 只交付单用户、严选、SKU、direct HTTP、OA 测试稿的可逆演示，使用已经实现的 adapter 与既有草稿 handoff。它不必等待 FDEV-001～008，也不实现截图、补充/覆盖、非 SKU、耐久控制面或真实 OA。

本文剩余内容保留为 P1：当 P0 已证明业务价值后，再选择性补齐完整 Skill 合同、长期运行架构和原生 OA canary。P1 不反向阻断 P0，也不要求 P0 为未来的所有能力预建抽象。

## 1. 背景、目标与边界

本地三源流程已能以合成、脱敏数据执行“配券表 + 白名单 + 黑名单/无黑名单确认 → 映射 → 两次确认 → 标准产物与由已验证标准配券表生成的截图 → OA 预填”的零副作用验证。这并不验证飞书消息、用户身份、卡片、Base、Drive、审批权限、真实审批定义或原生 OA 创建。

本方案将原本分散的 `OA优惠券填报` 与 `OA优惠券三源填报` Claude Code 本地合同收敛为一个业务入口：

```text
业务员在现有测试 Bot 单聊发送 /OA优惠券提报
  → 服务端创建/恢复一笔三源优惠券任务
  → 收集、解析并核验原始配券表、白名单和可选黑名单
  → 第一次确认来源映射、无黑名单/重叠决策和补充字段
  → 生成同一 revision 的标准产物与 OA 预填快照
  → 交接到既有 OA 测试稿
  → 业务员沿用既有明确“发送”动作
  → 仅当既有服务端 Gate 允许时，创建并回读原生 OA
```

本方案复用已经存在的 OA 测试稿、最终发送和 readback 行为；它不以新建通用工作流平台、替代 bridge/worker 或重写 native-submit 为前提。该复用决定不改变正式 R1-dev/R2/R3 的命名和验收含义，也不授权绕过现有服务端 Gate。
### 1.1 本次方案的范围

- Bot 单聊中的唯一目标命令为 `/OA优惠券提报`；不保留两个旧 Claude Code Skill 或旧命令的兼容入口。
- 首期只覆盖已登记的常规满减券、字段、公式、模板和 SKU ID 维度，且仅开放严选业务模式；寄卖/pop 在受控服务端截图渲染器可用并通过独立验证前明确拒绝。“任意布局”仅指 Sheet/表头/说明行布局，不表示支持任意业务语义或券型。
- 复用当前测试 Bot、既有系统 OA 测试稿和既有测试 OA 模板；三源 adapter 只交接冻结 revision，不实现第二套提交/回读链路。
- 不合并 `OA优惠券审批` 手工原生 OA 导航，也不改变 `优惠券Excel试点` 的 P1-1 产品边界；它们是独立的当前路线。
- 不把本次适配扩大为通用工作流框架、替代 bridge/worker 平台、跨路线草稿重构、群协作、批量提报或未登记模板/券型支持。

### 1.2 不可变原则

1. `.claude/skills/` 不会被 `server/` 自动导入。合并 `SKILL.md` 只能统一本地业务合同，**不能**让飞书 Bot 自动获得路由、状态、权限、存储或 OA 创建能力。
2. 配券表是业务字段第一来源；飞书身份优先决定最终申请人和部门；补充文本仅补缺或以可审计理由显式覆盖。
3. 白名单必传。黑名单未上传、黑名单无效和已确认无黑名单是三个不同状态；系统不得默认名单优先级。
4. 原始配券表、原始白/黑名单绝不成为 OA 正式附件。只有从当前 canonical revision 生成、冻结、重新下载并完成 hash 校验的标准产物可被提升为审批附件。
5. 创建飞书审批实例就是提交。确认前对原生 OA 零写入；服务端不设置审批人、抄送人或审批路由。
6. AI、卡片、bridge、文件名和本地 Skill 都不能决定授权、状态迁移或最终业务事实；这些均由确定性服务端代码复验。

## 2. 当前基线与升级缺口

| 范围 | 已具备/已定义 | 飞书升级前的缺口 |
| --- | --- | --- |
| 三源领域规则与 adapter | `server/lib/coupon-oa/three-source/` 已提供 mapping、名单、revision 与标准产物；`server/lib/feishu/coupon-oa/three-source/` 已提供 default-disabled 的文件/Card adapter 和 OA 测试稿 handoff | P0 只验证严选、SKU、无截图子集；完整字段补充/覆盖、非 SKU、完整最终预览和截图仍为 P1。 |
| Claude Code Skill | 已收敛为 `/OA优惠券提报` 的本地综合业务合同 | 本地执行不共享 Bot 草稿、文件引用、凭据或状态；P0 只实现其中明确列出的子集。 |
| 当前 Bot 路线 | `server/lib/feishu/events.ts` 已路由三源文本、文件和 callback；`dispatcher.ts` 由 feature flag、OA allowlist 和测试资源 fail closed | 需要按 P0 手册配置 direct HTTP callback、专属资源和单用户测试；不因此成为正式 R2。 |
| 当前附件处理 | 三源路径生成冻结标准产物，以 Drive 重下载/hash 复验后交接既有 OA 测试稿；来源文件不会被直接提升为 approval `file_code` | P0 不生成 `calcImage`；完整截图合同与非严选附件范围留在 P1。 |
| 原生 OA 提交 | `approval-schema.ts` 可做 definition hash 绑定、表单编码和回读差异；`submit-service.ts` 已有创建后回读方向 | 三源路线必须交接到这条既有路径并保留其 Gate、幂等、`SubmissionUnknown` 与人工告警语义；不新建并行提交实现 |
| 配置与并发 | `FEISHU_COUPON_OA_MODE` 默认 `disabled`；通用 tester allowlist、native-submit kill switch 和独立 native-submit allowlist 已由服务端复验；`production` 仅为兼容别名，仍须通过全部门禁 | Base 的读后 PUT 不是原子 CAS，且尚无持久业务 submission key/lease，不能作为最终提交锁 |
| 事件入口 | 开发 bridge 已要求显式目标、HMAC key ID/secret、timestamp、nonce 和 body digest；Nitro `/api/feishu/bridge` 仅接受验签请求；本地 nonce cache 可拒绝同进程重放 | 当前 `lark-cli` / `pnpm dev:events` 可按 [ADR-0008](../../../adr/0008-limit-local-lark-cli-to-vercel-integration-smoke.md) 执行一次本机 → Vercel 的 `R0.5-manual-smoke`，但仍没有 durable outbox、持久 transport receipt、跨实例 nonce/event 去重、监督运行、告警或 runbook，故不满足 R1-dev/R2 Gate |
| 公网 callback | `/api/feishu/process` 在未配置 `FEISHU_VERIFICATION_TOKEN` 时拒绝请求；常规构建已停止注入 `/api/feishu/events` Edge ACK 路径 | 若未来采用公网 callback，仍须设计一条唯一、受测试保护且具备持久接收/投递语义的正式合同；不能恢复 `waitUntil` best-effort 转发作为可靠入口 |
| 本地 bridge 目标 | `scripts/long-connection-bridge.mjs` 要求显式 `FEISHU_BRIDGE_TARGET_URL`（或显式 legacy target），并只允许精确的 `/api/feishu/bridge`；HTTPS 是默认要求，回环 HTTP 仅限显式开发开关 | 该脚本仍无持久 outbox/retry/reconnect/队列边界；可作为 ADR-0008 的 R0.5 手工 smoke 工具，但不能把它当作托管 bridge、R1-dev 或正式 R2 证明 |

**结论：**“本地测试已打通”是 R0 的必要输入，不是 R1-dev、R2 或 R3 的上线证明。正式 ring 仍须补足运行时边界、持久状态、权限与回滚控制；方案 A 的代码范围则是将三源 canonical revision 适配到既有 OA 测试稿/发送路径，不重建本表列出的 bridge、worker 或 native-submit 能力，也不因此降低已有 Gate。

### 2.1 R1-dev：正式 R2 前的 command/card 验证 ring

为避免将 command-to-card canary 误称为正式 R2，开发路径使用以下定义：

```text
R0                  = 本地 domain、fake gateway、disposable PostgreSQL
R0.5-manual-smoke   = 本机 lark-cli → 本机 bridge → Vercel HTTPS ingress
R1-dev              = 独立 Dev App/Bot 的 Shadow → Dark task → command-to-card canary
R2                  = `r2-draft-only` 的完整 draft-only 文件/材料流
R3                  = 原生 OA canary
```

`R0.5-manual-smoke` 是 ADR-0008 的测试标签，不是新的 `FEISHU_RUNTIME_STAGE`，也不是 R1-dev 的别名。它只允许在所有业务 Gate 关闭时验证本机长连接、HMAC 转发和 Vercel ingress；不能推断 durable ACK、消息恢复、真实 command/card、R2 文件流或 OA 权限。

`R1-dev` 是发布/验收 ring，运行时映射为 `FEISHU_RUNTIME_STAGE=r1-intake` 加独立 Dev command/card gate；它不是新的 runtime-stage 字符串，也不得选择 `r2-draft-only`。R1-dev 禁止文件、Base、Drive、对象存储、renderer、AI、Approval 附件和 OA。其顺序、独立 Test-Plan Agent/QA handoff 和 🥇 前置条件以[飞书开发版需求台账](coupon-oa-feishu-dev-requirements-tracker-v1.md)为准。

## 3. 目标命令、会话与材料合同

### 3.1 命令路由

飞书 Bot 仅精确识别 `/OA优惠券提报`（可安全忽略首尾空白和命令前缀符号），并将其路由到 `dispatchCouponThreeSourceText` 的三源 adapter。不为 `OA优惠券填报`、`OA优惠券三源填报` 或其他旧语句保留启动新任务的兼容分支。

- 同一 owner 在同一时刻仅允许一笔活动的综合提报；存在未终态任务时，提示继续或先结束当前任务。
- 已存在的旧 OA 草稿/Excel 试点可以继续通过其**既有卡片**完成或取消，但不再从旧命令创建新任务。
- 默认只支持与 Bot 的单聊。群聊、代理提报、代确认、批量提报均需要独立产品与权限决策，不得默认开放。

### 3.2 输入材料

| 材料 | 必传 | 作用 | 接收规则 |
| --- | ---:| --- | --- |
| 原始配券表 `.xlsx` | 是 | OA 字段与券规则第一来源 | 可任意布局；服务端识别并在歧义时发起最小化映射确认 |
| 原始白名单 `.xlsx` | 是 | 本次纳入范围第一来源 | 确认 Sheet、列与 SKU/SPU/商家 ID 维度 |
| 原始黑名单 `.xlsx` | 否 | 本次排除范围第一来源 | 未上传时必须点击/回复“本次无黑名单”；无效文件不能替代该确认 |
| 已填充标准配券表截图 | 是（按当前目标 OA 定义） | OA 图片附件证据 | 在同一 revision 的标准配券表 round-trip 验证后由系统完整渲染；登记源产物、模板版本、渲染范围和图片 hash；不读取图片中的业务事实，也不得以用户上传图片或原始源表截图替代 |
| 补充文本 | 条件必需 | 补齐缺失字段、确认候选或显式覆盖 | 不能静默覆盖配券表事实 |
| 飞书身份 | 系统提供 | owner、最终申请人和部门候选 | 仅服务端解析，不能由卡片传值替代 |

文件允许乱序到达。文件名只可用于候选提示，角色识别还必须综合工作簿结构、表头、单元格类型、样例值和已发布的字段/模板规则。

## 4. 目标任务状态机与两次确认

### 4.1 建议状态机

```text
三源 task
  Collecting
    → Recognizing
    → NeedsClarification
    → AwaitingSourceConfirmation
    → GeneratingArtifacts
    → AwaitingFinalConfirmation
    → DraftOnlyConfirmed（已交接既有 OA 测试稿）

既有 OA 测试稿
  Draft → Confirmed → Submitting → Submitted
                         ↘ CreatedNeedsReview
                         ↘ SubmissionUnknown
                         ↘ Failed

任一三源可编辑状态 → Canceled / Expired
任一源、映射、覆盖、决定或模板变化 → revision + 1 → 旧确认、产物和 OA 测试稿失效
```

每个三源 task 记录 `ownerOpenId`、`revision`、来源/产物 hash、映射/模板版本、确认人/时间、操作事件 ID、OA 测试稿交接引用和状态转换审计。交接后的审批定义 hash、submission key、实例 code/link 与 readback 结果由既有 OA 草稿记录。卡片只能包含 task 或 draft ID、revision、action、nonce；服务端从持久快照读取业务字段，绝不接受卡片回传的自由业务 JSON。

### 4.2 第一次：来源确认

解析完成后，Bot 展示：

- 配券表字段的候选映射、Sheet/单元格/原值和任何显式覆盖；
- 白/黑名单 Sheet、列、ID 维度、数量、重复/异常样例；
- 黑名单状态：已上传、待确认无黑名单、已确认无黑名单或无效；
- 配券表缺失的 OA 字段、补充内容冲突和最小化追问；
- 白黑名单交集及 owner 的选择：白名单优先、黑名单优先或替换源文件。

确认后锁定 `sourceConfirmation`，形成可以生成标准产物的 canonical revision。文件、映射、补充、黑名单状态或交集决定发生任意变更时，该确认立即失效。

### 4.3 第二次：最终确认与既有 OA 测试稿

从已锁定的 canonical revision 生成：标准配券表、标准白名单、可选标准黑名单、无黑名单记录、OA 预填字段、计算结果、模板版本和附件 hash。最终卡完整回显这些内容、警告和当前 revision。

方案 A 在第二次确认后把该冻结快照交接给既有 OA 测试稿；用户随后使用已经验证的明确“发送”路径。三源 task 不自行执行审批创建，也不复制现有最终确认/提交卡片。

| 阶段 | 用户动作 | 服务端副作用 |
| --- | --- | --- |
| 三源第二次确认 | `确认生成 OA 测试稿` | 写 task 审计、冻结标准产物与预填快照，并创建/更新既有系统 OA 测试稿；不自动创建原生 OA |
| 既有最终发送 | 既有 OA 测试稿中的明确“发送”动作 | 沿用既有 owner、revision、allowlist、kill switch、审批定义、附件 hash、提交幂等与 readback Gate；仅所有 Gate 通过时创建一笔 OA |

最终发送是唯一可能授权原生 OA 创建的动作。旧卡、重复点击、非 owner 或 revision 不一致均应拒绝或返回已有终态。

## 5. 目标运行架构与信任边界

### 5.1 R0.5-manual-smoke：本机长连接、Vercel ingress

ADR-0008 允许一次受控、短期的本机 `lark-cli` → `scripts/long-connection-bridge.mjs` → Vercel HTTPS ingress 测试。已安装的 `lark-cli 1.0.96` 可能在 stdout bridge 转发和 Vercel 写入之前 ACK，因此该路径只验证“已到达 Vercel 的请求”的 transport 连通性和 Gate 关闭时的安全拒绝；不运行 worker tick，不处理命令/卡片/文件，不创建 OA，也不向测试用户回复。Vercel receipt/outbox commit 是系统内可核对边界，但不是飞书 source ACK 边界。任何未来用户可见回复必须是 worker 领取后的幂等 effect，不能由 ingress 直接发送。该路径没有 durable ACK、retry、reconnect、DLQ 或恢复保证，故不能写作本节正式目标架构的已实现前置。

### 5.2 正式 R1-dev/R2/R3 的长期目标

下图是正式 R1-dev/R2/R3 的长期运行目标，不是方案 A 为完成三源适配而新建的基础设施清单。方案 A 复用现有受限测试入口与 OA 测试稿/发送链路；若未来扩大为正式 ring，仍须逐项满足本节的运行边界。

内网试点仍遵守 ADR-0006；长期生产仍以 ADR-0002 的 HTTP callback 为目标：

```text
飞书消息 / Card action
  → 企业托管 bridge（或长期 HTTP callback）
      - 稳定 event/callback ID
      - durable outbox、重试、健康
      - HMAC、timestamp、nonce、body digest
  → Nitro ingress
      - bridge 身份、重放拒绝、持久 transport receipt
      - 快速 ACK；不执行耗时解析或 OA 写入
  → 异步/可恢复 CouponTask application service
      - task 状态、owner/revision、确定性规则、审计
  → Base / Drive（试点草稿和冻结产物）
  → 仅 native-submit Gate 通过时：Feishu Approval Gateway
```

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| Bot/Card | 命令、收集、展示、通知 | 业务授权、持久状态、OA 写入 |
| bridge | 消费、签名转发、outbox、重试、健康 | 业务规则、审批决策、身份授权 |
| Nitro ingress | 验签、收据、去重、投递 | AI、文件解析、长事务、原生 OA 创建 |
| 三源任务服务 | 映射、状态机、产物、确认、审计与 Gate | 依赖卡片字段或函数内存保存关键状态 |
| Approval gateway | 定义读取、附件上传、实例创建/回读 | 覆盖审批人、抄送人或路由 |
| Base/Drive | 草稿、产物引用与展示 | 原子提交锁、长期生产主库 |

## 6. 数据、文件与副作用设计

### 6.1 canonical revision

每个三源 revision 最少保存：

```text
taskId、ownerOpenId、revision、schemaVersion、
三份源表的角色、文件名、hash、bytes、来源引用，以及由同 revision 已验证标准配券表生成的截图及其源产物/图片 hash、
Sheet/列/ID 维度与字段来源定位、
显式覆盖与原因、无黑名单确认、overlap hash/决定、
template ID/version/fingerprint、生成规则版本、
标准产物的行数/hash/Drive 引用、OA 预填快照、
第一次/第二次确认与既有 OA 测试稿的 handoff 引用。
```

交接后，既有 OA 草稿保存审批定义 hash、submission key、实例 code/link 与 readback 结果；三源任务不复制这套提交状态。

### 6.2 文件身份

| 标识 | 用途 | 不能代替 |
| --- | --- | --- |
| 源消息/文件引用 | 下载并提取源材料 | 审批附件文件码 |
| Drive `fileToken` | 当前 revision 标准产物的冻结、重下载与 hash 校验 | Base 附件 token、审批文件码 |
| Base 附件 token | POC 草稿/运营可见性 | Drive 冻结身份和审批控件值 |
| Approval `file_code` | 原生 OA 附件控件值 | 源文件或 Drive token |

源文件只读保留，标准附件只从同一 revision 的 frozen output 产生。R2 不得调用审批附件上传；R3/R4 在所有 Gate 通过后才可立即重验、上传标准产物并获取 `file_code`。黑名单处于 `absent_confirmed` 时只记录状态，不上传空文件。

## 7. 运行配置、权限与 Gate

### 7.1 已实施的 P0 fail-closed 控制与三源路线必需配置

2026-10-09 已完成旧优惠券 OA 路线的 P0 防误触发修复：未配置 mode 时禁用、通用/原生两层 allowlist、native-submit kill switch、服务端最终创建门禁、原始附件直传禁用、bridge HMAC ingress 和默认构建停止生成 Edge ACK。它们降低了测试环境误触发风险，**不**构成 R1-dev、R2 或 R3 Gate 通过证据。

三源路线仍应采用显式、冲突即拒绝的配置；未知/缺失值禁止 native-submit。至少包括：

| 配置 | 用途 |
| --- | --- |
| launch stage | 明确 R0/R1-dev/R2/R3/R4；R1-dev 仅映射 `r1-intake`，未知/缺失值禁止 native-submit |
| 三源路线 feature flag | 单独开启 `/OA优惠券提报`；不影响旧 Excel 试点 |
| server-side allowlist | 发起、附件、确认、提交各步骤均复验，不依赖卡片隐藏 |
| global native-submit kill switch | 默认关闭；可立即停止原生 OA 写入 |
| approved approval code / definition hash | 仅允许批准的测试 OA 定义；发生 drift 则阻断 |
| dedicated Base/Drive resource IDs | 三源任务、源文件/产物和旧草稿/Excel 表隔离 |
| bridge key ID / secret reference | 专用轮换密钥，不能复用 Verification Token、App Secret 或 tenant token |
| retention / limits | 文件大小、行数、有效期、数据保留和日志脱敏策略 |

当前旧路线的 P0 变量为：`FEISHU_COUPON_OA_MODE=disabled|draft-demo|native-submit`（`production` 仅兼容映射到 `native-submit`）、`FEISHU_COUPON_OA_ALLOWED_OPEN_IDS`、`FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=true`、`FEISHU_COUPON_OA_NATIVE_SUBMIT_ALLOWED_OPEN_IDS`、`FEISHU_BRIDGE_TARGET_URL`、`FEISHU_BRIDGE_KEY_ID` 和 `FEISHU_BRIDGE_SHARED_SECRET`。它们必须由服务端、ADR-0008 限定的安全本机 R0.5 runner 或企业托管 bridge 配置；不得把 allowlist、共享密钥或开关值放入卡片回调。

Secret 只可存在于 ADR-0008 限定的安全本机 R0.5 runner、企业托管 bridge、服务端环境变量或密钥服务；不得写入 Skill、卡片、Base 业务字段、前端构建变量或日志。

### 7.2 飞书资源与权限证据

在每个 Ring 前由飞书应用管理员保留可重验、脱敏证据：

1. 测试 Bot 对 allowlist 用户可见，能接收消息、附件和 Card action；
2. 应用能按最小权限下载消息资源，读写隔离 Base 与冻结 Drive 文件夹；
3. R2 可以写系统草稿与冻结产物，但审计证明没有实例创建请求；
4. R3 前已经在隔离审批定义验证：definition read、目标 `approval_code`、`is_external=false`、申请人资格、审批附件 upload、instance create/get；
5. OA 流程 Owner 已确认申请人、节点、抄送、撤回/驳回和人工对账职责。

## 8. P1：完整 Skill 合同与长期架构工作包

以下工作包不是 P0 的前置，不得在 P0 阶段抢跑；只在 POC 证明需要后按业务价值选择启动。

### A1：冻结三源到 OA 测试稿的合同

- 由业务、流程与模板 Owner 冻结首期券型、字段、公式、渠道、日期、业务模式、超扣点、白/黑名单模板、ID 维度与重叠规则；
- 冻结同 revision 标准配券表、标准名单和截图的生成/验证规则；不得接受原始源表、人工上传图片或未登记模板作为正式附件；
- 定义 canonical revision 如何映射为现有系统 OA 草稿字段和标准产物引用；指定三源 handoff 与既有草稿失效/替换规则；
- 保持当前 `优惠券Excel试点`、`OA优惠券填报` 与 `OA优惠券审批` 的合同不变。

### A2：实现最小三源 Bot adapter

- 以 `dispatcher.ts` 的精确 `/OA优惠券提报` matcher 为入口，绑定已有 `CouponThreeSourceTaskService`，而不是在旧命令上增加隐式分支；
- 只补三源文件接收、解析候选、角色/Sheet/列/ID 维度卡片、补充值、无黑名单和重叠决定，以及 task/revision/owner 的服务端复验；
- 从同一冻结 revision 生成标准配券表、白名单、可选黑名单和截图，并保存来源/产物 hash；源文件绝不直接提升为 OA 附件；
- 不引入通用工作流框架、替代 bridge/worker、跨路线状态机重构或第二套 native-submit 服务。

### A3：交接既有 OA 测试稿与显式发送

- 在三源第二次确认后，创建或更新既有系统 OA 测试稿，交接 OA 预填字段及重新下载/hash 校验所需的冻结产物引用；
- 复用既有 OA 测试稿卡片、最终发送按钮、`submit-service.ts` 的 Gate、审批定义绑定、附件提升、创建/readback 和未知结果语义；
- 三源 adapter 不直接调用 Approval create API；生成或交接成功不等于 OA 已发送；
- 现有 native-submit 开关、双层 allowlist、owner、revision、definition hash 和 readback 的任何拒绝均保持拒绝。

### A4：验证并准备受限测试

- 用现有离线三源测试覆盖乱序材料、角色/字段歧义、黑名单缺失或无效、ID 维度不一致、重叠决策、revision 失效和 source/standard-artifact 边界；
- 为 adapter 和 handoff 增加 fake/mocked 飞书、Drive、审批网关测试，证明生成期间零 OA create，最终发送只走既有服务端路径；
- 在不改变当前配置、allowlist、开关或部署的前提下完成本地/隔离验证；任何真实飞书或 OA 测试仍须由有权限的 Owner 在既有 Gate 下另行授权；
- 通过受限测试后，才将真实已实现的行为和证据同步到 `current/`、rollout、readiness checklist 与 Skill 合同文档。

## 9. 正式 Ring、Gate 与验收矩阵（方案 A 的后续扩大范围）

本节描述将来把三源路线宣称为正式 R1-dev/R2/R3 能力时的额外 Gate；它不要求方案 A 为完成受限 adapter 而重建这些平台能力，也不放松现有 OA 测试稿/发送路径的服务端控制。

| Ring | 可开放范围 | 允许副作用 | 最小验收 |
| --- | --- | --- | --- |
| R0 | 合成/脱敏本地样本 | 无飞书写入 | 离线单元/合同测试、`fetch` 零调用、文档与模板规则评审 |
| R0.5-manual-smoke | 本机 `lark-cli` → bridge → Vercel HTTPS ingress | 仅 transport receipt/安全拒绝验证；所有业务 Gate 和 Bot 用户回复关闭 | ADR-0008 用例通过；单 consumer；零 task/effect/user-visible reply/card/file/Base/Drive/AI/Approval/OA；不宣称 durable ACK 或 R1-dev |
| R1-dev | 独立 Dev App/Bot 的 command/card pre-R2 验证 | 仅 receipt/outbox/task/audit/开发验收卡；使用 `r1-intake` | FDEV-001–FDEV-005 🥇 后，FDEV-006 逐步完成 Shadow、Dark task、单用户 card、小 allowlist；零文件/Base/Drive/object-store/renderer/AI/Approval/OA |
| R2 | 严格 allowlist 业务员 | 系统草稿、Drive/Base 冻结产物 | 三源 draft-only E2E；证明没有 `POST /approval/v4/instances`；源表不入 OA 附件 |
| R3 | 1–2 位具名 canary | 当前 revision 的单次 native-submit + readback | G4、submission 对账、kill switch/回滚演练、manual/API 路径比对 |
| R4 | 预批准小范围用户 | 同 R3 | canary 经业务/OA/安全/运行 Owner 书面签核，逐次扩容 |
| R5 | 不在本方案中 | 另行决定 | 新 ADR、正式入口/存储/队列/合规和生产 Gate |

必须覆盖下列测试场景：

| 类别 | 场景 |
| --- | --- |
| 材料与映射 | 乱序上传、角色歧义、缺配券表/白名单/图片、黑名单未传/无效、ID 维度不一致、前导零、多 ID、模板子集/未登记券档 |
| 业务决定 | 配券表与补充冲突、无黑名单确认、白黑名单交集的三种决定、单/全渠道口径、超扣点和日期待确认 |
| revision 与授权 | 文件替换、旧卡、跨 owner、重复点击、并发 callback、allowlist 外用户、kill switch、definition hash drift |
| 文件与副作用 | 源文件绝不进入审批附件、冻结 Drive 文件下载 403、hash/大小不符、Base/Drive 失败、R2 零 OA create 证据 |
| 提交与恢复 | 业务幂等、bridge/Nitro 重启、HTTP 回应丢失、create timeout、`SubmissionUnknown`、readback mismatch、`CreatedNeedsReview`、对账与回滚 |

## 10. 正式 Ring 的 Go / No-go 与回滚

### 10.1 R2 Go 条件

- A1/A2 已完成且三源流程仍明确标为试点/提议，未误称为已生产；
- bridge 和 ingress 已完成签名、持久收据、去重、outbox、监控和 runbook；
- 所有新配置 fail closed，native-submit kill switch 默认关闭；
- 至少三次完整 R2 正常 E2E，另含重复、旧卡、重启、Drive/Base/文件下载故障注入；
- 审计能够证明源表没有进入审批附件，且没有 OA 实例创建请求。

### 10.2 R3 No-go 条件

以下任一项未提供证据时，禁止 canary：

- 目标测试 OA 的 approval code、definition hash、组件映射、申请人资格和 `is_external=false` 未验证；
- approval attachment upload、create/get instance、手工/API 差异报告未在隔离定义完成；
- 无服务端 allowlist、kill switch、原子 business idempotency claim、`SubmissionUnknown` 对账和人工值守；
- 无法证明当前 revision 的源/产物 hash、owner 和最终确认完整一致。

### 10.3 回滚顺序

1. 关闭 native-submit kill switch，保留日志、收据、outbox、草稿和审批证据；
2. 如 transport 仍可信，可退回 R2 draft-only；否则停用综合路线并由运行 Owner 停止 bridge intake；
3. 冻结 allowlist 与 Bot 可见范围，禁止新 task/确认；
4. 对账 `Submitting`、`SubmissionUnknown`、`CreatedNeedsReview`；禁止删除或盲目再次创建 OA；
5. 经业务 Owner 批准，可引导业务员使用独立的 `OA优惠券审批` 手工路线；
6. 修复、复盘并重验失败 Gate 后才恢复。

## 11. 文档与实现同步规则

- 综合 Skill 只定义本地评审合同和飞书目标合同；服务端路由、状态机和权限必须单独实现。
- 本文件和三源 PRD 在获批前都属于 `proposals/`。`current/`、MVP PRD、rollout、ADR-0004 里的当前 `OA优惠券填报` 路线不能因为新增文档而被宣称已迁移。
- 当方案 A 的三源 adapter 已实现并通过受限测试后，才更新 `current/product/`、`current/implementation/`、rollout、readiness checklist 与 `claude-code-skill-contract.md`，并保留 proposal 的决策追溯。
- 当三源路线的实际 native-submit 边界、受限测试范围或正式 Ring 发生变化时，必须评估并新增/修订 ADR；不得只在 Skill 文本中扩大授权。

## 12. 默认关闭的控制面与 R2 代码基础（2026-10-09）

仓库已有默认关闭的 durable ingress、PostgreSQL receipt/outbox、command intake、task/audit/effect transaction、workflow/effect lease、scheduler tick 和三源领域状态机基础。它们已在 unit/SQL contract 与本地 disposable-schema PostgreSQL 范围验证 migration repeatability、delivery dedupe、同 owner 并发、`SKIP LOCKED`、stale lease fencing、fake card success 和 `outcome_unknown` restart no-resend。

这些代码只构成 R0 foundation；ADR-0008 允许用当前 `lark-cli` bridge 做一次 R0.5 手工 transport smoke，但它没有 durable transport/ACK 证明。outbound timeout/lease renewal、effect task-owner/hash binding、unknown/DLQ 运营闭环、观测、retention/RBAC、对象存储与真实 Dev Bot 都未完成。因此它们不构成 R1-dev/R2/R3 已开放的证据，也不能据此打开 `FEISHU_COUPON_THREE_SOURCE_R2_ENABLED` 或扩大文件、Base/Drive、审批附件和原生 OA 权限。

方案 A 不以启用上述控制面开关或完成另一套 durable 平台为实现手段；它只把三源 canonical revision 交接到已经存在的 OA 测试稿/显式发送路径。该路径的真实 OA 写入仍必须由既有服务端 Gate 和有权限 Owner 的单独测试授权控制。

本节不代表 A1–A4、R1-dev、R2 或 R3 Gate 已通过。任何将三源路线作为正式 R1-dev/R2/R3 能力的真实飞书测试，仍需按[需求台账](coupon-oa-feishu-dev-requirements-tracker-v1.md)完成相应 FDEV 🥇；任何受限测试都不得据此宣称已满足正式 ring。
