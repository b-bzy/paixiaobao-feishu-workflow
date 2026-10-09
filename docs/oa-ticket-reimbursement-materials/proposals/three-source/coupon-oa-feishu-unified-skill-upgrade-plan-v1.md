# 优惠券 OA 综合 Skill 飞书适配升级方案 v1

> **状态**：待业务、流程、模板、应用与技术 Owner 评审；本文件是从本地三源验证升级到飞书内网测试的实施方案，不代表 Bot 路线已经上线或 native-submit 已开放。
> **日期**：2026-10-09
> **唯一目标命令**：`/OA优惠券提报`
> **关联**：[综合 Skill](../../../../.claude/skills/OA优惠券提报/SKILL.md) · [三源 PRD](coupon-oa-three-source-workflow-prd-v1.md) · [三源离线测试](coupon-oa-three-source-offline-test-plan-v1.md) · [内网试点 rollout](../../current/operations/coupon-oa-internal-pilot-rollout-plan-v1.md) · [ADR-0004](../../../adr/0004-bot-confirmed-submit-for-coupon-oa.md) · [ADR-0006](../../../adr/0006-use-managed-long-connection-bridge-for-internal-coupon-pilot.md)

## 1. 背景、目标与边界

本地三源流程已能以合成、脱敏数据执行“配券表 + 白名单 + 黑名单/无黑名单确认 → 映射 → 两次确认 → 标准产物与由已验证标准配券表生成的截图 → OA 预填”的零副作用验证。这并不验证飞书消息、用户身份、卡片、Base、Drive、审批权限、真实审批定义或原生 OA 创建。

本方案将原本分散的 `OA优惠券填报` 与 `OA优惠券三源填报` Claude Code 本地合同收敛为一个业务入口：

```text
业务员在现有测试 Bot 单聊发送 /OA优惠券提报
  → 服务端创建/恢复一笔三源优惠券任务
  → 收集、解析并核验四类材料
  → 第一次确认来源映射、无黑名单/重叠决策和补充字段
  → 生成同一 revision 的标准产物与 OA 预填快照
  → 第二次确认最终预览
  → R2 停在系统草稿；只有 R3/R4 才由受认证服务端创建并回读原生 OA
```

### 1.1 本次方案的范围

- Bot 单聊中的唯一目标命令为 `/OA优惠券提报`；不保留两个旧 Claude Code Skill 或旧命令的兼容入口。
- 首期只覆盖已登记的券型、字段、公式、模板和 ID 维度；“任意布局”仅指 Sheet/表头/说明行布局，不表示支持任意业务语义或券型。
- 复用当前测试 Bot 和既有测试 OA 模板，按现有 R0–R5 rollout 模型分阶段验证。
- 不合并 `OA优惠券审批` 手工原生 OA 导航，也不改变 `优惠券Excel试点` 的 P1-1 产品边界；它们是独立的当前路线。

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
| 三源领域规则 | `server/lib/coupon-oa/three-source/` 及离线测试能在无网络条件下演练 mapping、名单、标准产物与本地确认 | 没有飞书消息/Card adapter、持久化 task、Drive/审批附件编排或 OA 提交路径 |
| Claude Code Skill | 已收敛为 `/OA优惠券提报` 的本地综合业务合同 | 本地执行不共享 Bot 草稿、文件引用、凭据或状态 |
| 当前 Bot 路线 | `server/lib/feishu/events.ts` 已处理旧 `OA优惠券填报`、`优惠券Excel试点` 与 `OA优惠券审批` | 尚无 `/OA优惠券提报` 三源 dispatcher；总路由承担过多业务分支 |
| 当前附件处理 | 旧优惠券 OA 消息附件直传审批附件库的路径已禁用；来源文件不会再被直接提升为 approval `file_code` | 尚无三源产物生成、冻结、重下载/hash 复验和最终 Gate 后的即时审批附件提升；不得把已禁用的旧附件路径重新接回 |
| 原生 OA 提交 | `approval-schema.ts` 可做 definition hash 绑定、表单编码和回读差异；`submit-service.ts` 已有创建后回读方向 | 三源路线必须增加完整 Gate、持久业务幂等、`Submitting` lease、`SubmissionUnknown` 对账和人工告警，不能依赖普通失败重试 |
| 配置与并发 | `FEISHU_COUPON_OA_MODE` 默认 `disabled`；通用 tester allowlist、native-submit kill switch 和独立 native-submit allowlist 已由服务端复验；`production` 仅为兼容别名，仍须通过全部门禁 | Base 的读后 PUT 不是原子 CAS，且尚无持久业务 submission key/lease，不能作为最终提交锁 |
| 事件入口 | 开发 bridge 已要求显式目标、HMAC key ID/secret、timestamp、nonce 和 body digest；Nitro `/api/feishu/bridge` 仅接受验签请求；本地 nonce cache 可拒绝同进程重放 | 当前 `lark-cli` / `pnpm dev:events` 仍仅用于调试，且没有 durable outbox、持久 transport receipt、跨实例 nonce/event 去重、监督运行、告警或 runbook，故不满足 R1/R2 Gate |
| 公网 callback | `/api/feishu/process` 在未配置 `FEISHU_VERIFICATION_TOKEN` 时拒绝请求；常规构建已停止注入 `/api/feishu/events` Edge ACK 路径 | 若未来采用公网 callback，仍须设计一条唯一、受测试保护且具备持久接收/投递语义的正式合同；不能恢复 `waitUntil` best-effort 转发作为可靠入口 |
| 本地 bridge 目标 | `scripts/long-connection-bridge.mjs` 要求显式 `FEISHU_BRIDGE_TARGET_URL`（或显式 legacy target），并只允许精确的 `/api/feishu/bridge`；HTTPS 是默认要求，回环 HTTP 仅限显式开发开关 | 该脚本仍无持久 outbox/retry/reconnect/队列边界，不能把它当作托管 bridge 或 R1 证明 |

**结论：**“本地测试已打通”是 R0 的必要输入，不是 R1/R2 的上线证明。接入飞书之前，须先把运行时边界、持久状态、权限与回滚控制补齐。

## 3. 目标命令、会话与材料合同

### 3.1 命令路由

飞书 Bot 仅精确识别 `/OA优惠券提报`（可安全忽略首尾空白和命令前缀符号），并将其路由到 `CouponCommandDispatcher`。不为 `OA优惠券填报`、`OA优惠券三源填报` 或其他旧语句保留启动新任务的兼容分支。

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
Collecting
  → Recognizing
  → NeedsClarification
  → AwaitingSourceConfirmation
  → GeneratingArtifacts
  → AwaitingFinalConfirmation
  → DraftOnlyConfirmed                 (R2)
  → Submitting → Submitted             (R3/R4)
                ↘ CreatedNeedsReview
                ↘ SubmissionUnknown
                ↘ Failed

任何可编辑状态 → Canceled / Expired
任一源、映射、覆盖、决定或模板变化 → revision + 1 → 旧确认失效
```

每个 task 记录 `ownerOpenId`、`revision`、来源/产物 hash、映射/模板/审批定义版本、确认人/时间、操作事件 ID 和状态转换审计。卡片只能包含 task ID、revision、action、nonce；服务端从持久快照读取业务字段，绝不接受卡片回传的自由业务 JSON。

### 4.2 第一次：来源确认

解析完成后，Bot 展示：

- 配券表字段的候选映射、Sheet/单元格/原值和任何显式覆盖；
- 白/黑名单 Sheet、列、ID 维度、数量、重复/异常样例；
- 黑名单状态：已上传、待确认无黑名单、已确认无黑名单或无效；
- 配券表缺失的 OA 字段、补充内容冲突和最小化追问；
- 白黑名单交集及 owner 的选择：白名单优先、黑名单优先或替换源文件。

确认后锁定 `sourceConfirmation`，形成可以生成标准产物的 canonical revision。文件、映射、补充、黑名单状态或交集决定发生任意变更时，该确认立即失效。

### 4.3 第二次：最终确认

从已锁定的 canonical revision 生成：标准配券表、标准白名单、可选标准黑名单、无黑名单记录、OA 预填字段、计算结果、模板版本和附件 hash。最终卡完整回显这些内容、警告和当前 revision。

| Ring | 按钮语义 | 服务端副作用 |
| --- | --- | --- |
| R2 draft-only | `确认生成系统草稿` | 写任务审计、冻结标准产物和系统草稿；严格禁止 `POST /approval/v4/instances` |
| R3/R4 native-submit | `确认并发起 OA` | 再验 Gate；下载并 hash 校验冻结产物；上传审批附件；创建并回读一笔原生 OA |

最终确认是唯一可能授权原生 OA 创建的动作。不得沿用旧流程“预览确认 → 确认提交”产生第三次用户确认。旧卡、重复点击、非 owner 或 revision 不一致均应拒绝或返回已有终态。

## 5. 目标运行架构与信任边界

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

每个 revision 最少保存：

```text
taskId、ownerOpenId、revision、schemaVersion、
三份源表的角色、文件名、hash、bytes、来源引用，以及由同 revision 已验证标准配券表生成的截图及其源产物/图片 hash、
Sheet/列/ID 维度与字段来源定位、
显式覆盖与原因、无黑名单确认、overlap hash/决定、
template ID/version/fingerprint、生成规则版本、
标准产物的行数/hash/Drive 引用、OA 预填快照、
第一次/第二次确认、审批定义 hash、submission key、
instance code/link、readback 结果与差异。
```

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

2026-10-09 已完成旧优惠券 OA 路线的 P0 防误触发修复：未配置 mode 时禁用、通用/原生两层 allowlist、native-submit kill switch、服务端最终创建门禁、原始附件直传禁用、bridge HMAC ingress 和默认构建停止生成 Edge ACK。它们降低了测试环境误触发风险，**不**构成 R1、R2 或 R3 Gate 通过证据。

三源路线仍应采用显式、冲突即拒绝的配置；未知/缺失值禁止 native-submit。至少包括：

| 配置 | 用途 |
| --- | --- |
| launch stage | 明确 R0/R1/R2/R3/R4；未知/缺失值禁止 native-submit |
| 三源路线 feature flag | 单独开启 `/OA优惠券提报`；不影响旧 Excel 试点 |
| server-side allowlist | 发起、附件、确认、提交各步骤均复验，不依赖卡片隐藏 |
| global native-submit kill switch | 默认关闭；可立即停止原生 OA 写入 |
| approved approval code / definition hash | 仅允许批准的测试 OA 定义；发生 drift 则阻断 |
| dedicated Base/Drive resource IDs | 三源任务、源文件/产物和旧草稿/Excel 表隔离 |
| bridge key ID / secret reference | 专用轮换密钥，不能复用 Verification Token、App Secret 或 tenant token |
| retention / limits | 文件大小、行数、有效期、数据保留和日志脱敏策略 |

当前旧路线的 P0 变量为：`FEISHU_COUPON_OA_MODE=disabled|draft-demo|native-submit`（`production` 仅兼容映射到 `native-submit`）、`FEISHU_COUPON_OA_ALLOWED_OPEN_IDS`、`FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=true`、`FEISHU_COUPON_OA_NATIVE_SUBMIT_ALLOWED_OPEN_IDS`、`FEISHU_BRIDGE_TARGET_URL`、`FEISHU_BRIDGE_KEY_ID` 和 `FEISHU_BRIDGE_SHARED_SECRET`。它们必须由服务端或企业托管 bridge 配置；不得把 allowlist、共享密钥或开关值放入卡片回调。

Secret 只可存在于企业托管 bridge、服务端环境变量或密钥服务；不得写入 Skill、卡片、Base 业务字段、前端构建变量或日志。

### 7.2 飞书资源与权限证据

在每个 Ring 前由飞书应用管理员保留可重验、脱敏证据：

1. 测试 Bot 对 allowlist 用户可见，能接收消息、附件和 Card action；
2. 应用能按最小权限下载消息资源，读写隔离 Base 与冻结 Drive 文件夹；
3. R2 可以写系统草稿与冻结产物，但审计证明没有实例创建请求；
4. R3 前已经在隔离审批定义验证：definition read、目标 `approval_code`、`is_external=false`、申请人资格、审批附件 upload、instance create/get；
5. OA 流程 Owner 已确认申请人、节点、抄送、撤回/驳回和人工对账职责。

## 8. 实施工作包（实施前方案，不在本文档阶段抢跑）

### W0：评审与合同冻结

- 业务/流程/模板 Owner 冻结首期券型、字段、公式、渠道、日期、业务模式、超扣点、白/黑名单模板和重叠规则；
- 冻结由同 revision 已验证、已填充标准配券表完整渲染截图的规则；不得接受人工上传、原始源表或练习替代截图；
- 在 proposal 中批准三源路线使用 `/OA优惠券提报`，再将生效规则提升到 `current/`；
- 指定业务、OA、应用、平台/安全、bridge 运行、工程/QA Owner 和 R2/R3 签核人。

### W1：领域合同与持久任务

- 复用 `server/lib/coupon-oa/three-source/` 的纯领域识别、列表、canonical package、标准生成与离线测试；
- 在 `server/lib/feishu/coupon-oa/` 建立独立的三源 task repository、application service、Card builders、Drive/Approval handoff；
- 将 owner、revision、source confirmation、final confirmation、hash、template mapping 与 submission states 变成持久化数据；
- 用持久唯一约束/lease 实现 transport receipt、业务状态迁移和 submission key；不能把 Base 的读后 PUT 或卡片 revision 当作原子并发锁。

### W2：Bot 路由与 R2 draft-only

- 在 `events.ts` 外抽取 transport adapter 和 Coupon command dispatcher，新增 `/OA优惠券提报` 精确路由；
- 不把新三源逻辑继续堆入总事件处理器，也不复用旧 `handleCouponOaAttachment()` 的接收即上传审批附件路径；
- 接收材料、完成两次确认、生成/冻结标准产物和系统草稿，但在代码、配置、审计和网络层均禁止原生 OA create；
- 经企业托管 bridge 的签名、outbox、持久收据、去重、监控和 runbook 验收后，向严格 allowlist 开放 R2。

### W3：native-submit canary

- 保留并复用 `approval-schema.ts` 的 definition hash 绑定、`approval-client.ts` 网关和 `submit-service.ts` 的创建后回读比对；
- 为三源提交增加最终 Gate、冻结产物重新下载/hash 校验、即时 approval file upload、持久 submission key、`Submitting` lease、`SubmissionUnknown` 对账与 `CreatedNeedsReview` 告警；
- 只有 readiness checklist 的 G1–G4 可重验通过后，使用 1–2 位具名用户和隔离测试 OA 做一次值守 canary。

### W4：严格 allowlist 扩容与后续迁移

- 逐次扩大 allowlist，并记录时间、人数、Owner、观察期和退回条件；
- 任一重复/越权 OA、未签名请求、无法对账的 `SubmissionUnknown`、definition drift、hash mismatch、敏感日志泄露或 outbox 积压均立刻停止/回滚；
- R5 生产部署必须另行完成 ADR-0002 的 HTTP callback、持久队列/数据库、合规/数据驻留、生产可观测性和安全决策，不能把试点 bridge 直接量产。

## 9. Ring、Gate 与验收矩阵

| Ring | 可开放范围 | 允许副作用 | 最小验收 |
| --- | --- | --- | --- |
| R0 | 合成/脱敏本地样本 | 无飞书写入 | 离线单元/合同测试、`fetch` 零调用、文档与模板规则评审 |
| R1 | 托管 bridge + 指定测试账号 | 事件接收/回执测试 | 签名、nonce/replay、durable outbox、持久 receipt、单 consumer、监控/告警、runbook |
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

## 10. Go / No-go 与回滚

### 10.1 R2 Go 条件

- W0/W1 已完成且三源流程仍明确标为试点/提议，未误称为已生产；
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
- 当 W2/R2 实现完成后，更新 `current/product/`、`current/implementation/`、rollout、readiness checklist 和 `claude-code-skill-contract.md`，并保留 proposal 的决策追溯。
- 当 W3/R3 后对原生 OA 创建作出长期边界变更时，必须评估并新增/修订 ADR；不得只在 Skill 文本中扩大授权。

## 12. 默认关闭的 R2 代码基础（2026-10-09）

仓库已开始实现与既有 OA/Excel 路线隔离的三源领域状态机、精确命令 matcher 与 fail-closed R2 配置基础。该代码仅用于离线/模拟测试：`FEISHU_COUPON_THREE_SOURCE_R2_ENABLED` 默认为 `false`，未实现或未验收持久 ingress、transport receipt、任务存储、冻结 Drive、渲染器与单聊上下文前，Bot 不得创建三源任务或接收来源文件。

此项变更不代表 W0/W1/W2、R1 或 R2 Gate 已通过；不创建 Base/Drive 资源、不修改飞书应用权限、不开放 `/OA优惠券提报` 试点，也不触达审批附件或原生 OA 创建。
