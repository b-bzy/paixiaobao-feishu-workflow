# AGENTS.md — 拍小宝飞书工作流

> 本文件面向在本仓库工作的 coding agent。人类可先阅读 [README](README.md) 和 [项目文档导航](docs/README.md)。
>
> **当前阶段**：项目处于 POC 与受限内网试点阶段。任何文档、代码、卡片文案或测试样例都不得把“方案存在”表述成“能力已上线、已获权限或可自动创建原生 OA”。

## 项目是什么

拍小宝（面向爱回收业务）是一个以飞书 Bot 为主要交互入口的内部工作流项目：

- 业务人员通过飞书消息、卡片和文件输入发起或补充流程；
- 妙搭管理员控制台负责模板配置和运营查看；
- Nitro + TypeScript 服务端负责鉴权、状态机、文件编排、OA 草稿和外部 API 适配；
- 飞书 Base / Drive 在 POC 中保存隔离的草稿、投影和冻结产物；
- 优惠券路线当前以受控 Excel 生成与 `draft-only` 系统草稿为重点，不替代飞书原生 OA。

业务规则、授权、幂等、状态变迁和最终审批写入必须由确定性服务端代码控制。AI 只能辅助提取或理解输入，**不得**决定审批结果、路由、字段事实或权限。

---

## 需求设计与开发计划 Skill

本仓库已安装项目级 Claude Code Skill：

| 适用场景 | 必须使用 | 产出与边界 |
| --- | --- | --- |
| 新增产品能力、组件、接口，或修改已有产品行为 | `brainstorming` | 先澄清目标、范围、约束与验收；按其规则区分 spike、bounded 和 architectural 路径。任何实现开始前，必须完成对应的设计并取得用户对该阶段的明确确认。 |
| 已有经确认的规格/设计，且工作包含多个可独立验证的步骤 | `writing-plans` | 将需求拆成带精确文件路径、接口、测试、验证命令和完成标准的任务计划；任务之间须明确依赖关系。 |

- 小范围文案、链接、明显 typo 等不改变产品行为的修改，不需要走完整的需求设计或计划流程。
- Skill 只约束本地开发协作流程，不能替代本文件规定的 ADR、当前产品/实施基线、权限 Gate、测试验证或外部写入授权。
- 计划中涉及飞书、Base、Drive、Approval、对象存储、AI、部署或生产配置时，必须把对应的事实源、授权边界、幂等与回读验证写入任务；计划本身不构成执行这些外部副作用的授权。

---

## 接到任务的第一步

| 用户请求 | 先做什么 | 必读材料 / 约束 |
| --- | --- | --- |
| 小范围文案、README、链接或明显 typo | 直接修改并校验链接 | 保持文档生命周期和数据边界正确。 |
| 修复 bug、测试失败或线上异常 | 先复现、定位根因，再提出并实现修复 | 补回归测试；不要先猜测修复方案。 |
| 修改现有优惠券流程、字段、卡片或状态 | 先确认它属于当前路线、试点路线还是提议路线 | 读 `current/` 对应 PRD、实施基线和 rollout。 |
| 增加用户可感知的新能力、新 Bot 口令或新 API | 先确定产品范围、入口、事实源和验收，再实现 | 不要把 `proposals/` 中的能力直接当作已批准需求。 |
| 改事件入口、控制面/执行面边界、事实源、审批时机、存储或部署平台 | 先更新/新增 ADR，并同步当前基线 | 架构边界不能只在代码中悄悄改变。 |
| 调整飞书权限、原生 OA、Drive/Base 文件或生产环境配置 | 先确认环境、Owner、权限和 Gate | 默认 fail closed；没有明确授权不得执行外部写入或发布。 |
| 修改本地 Claude Code Skill | 明确它只是本地辅助协议 | Skill 不等于服务端 Bot 路由、飞书权限或 OA 提交能力。 |
| 需求范围不清 | 先阅读权威文档并陈述假设 | 不要用代码或文档猜测业务规则、审批权限或上线状态。 |

### 判断原则

1. 影响产品行为时，先更新产品基线或获得明确的产品决定。
2. 影响不可逆外部副作用、事实源或系统职责时，先写 ADR。
3. 影响上线、allowlist、canary、回滚或运行职责时，同步 `current/operations/`。
4. 不能证明安全时，保留草稿、停止副作用并说明阻塞项；不要伪造成功。

---

## 权威来源与文档生命周期

### 读取优先级

优惠券 OA 规则冲突时，按以下顺序处理：

1. 已接受的 [`docs/adr/`](docs/adr/)：架构、事件入口、事实源和不可逆原生 OA 创建；
2. [`current/operations/`](docs/oa-ticket-reimbursement-materials/current/operations/)：阶段、allowlist、canary、回滚和 go/no-go；
3. [`current/product/`](docs/oa-ticket-reimbursement-materials/current/product/)：当前用户行为、字段和验收；P1-1 细节优先于 MVP 通用规则；
4. [`current/implementation/`](docs/oa-ticket-reimbursement-materials/current/implementation/)：代码结构、状态机、文件交接和安全落地方式；
5. `records/`、`reference/` 和 `history/`：仅作为证据、输入、排障或追溯，不能单独扩大当前能力。

### 目录含义

| 位置 | 含义 | Agent 的行为 |
| --- | --- | --- |
| `docs/oa-ticket-reimbursement-materials/current/` | 当前生效的产品、实现与运行基线 | 修改对应行为时同步维护。 |
| `docs/oa-ticket-reimbursement-materials/proposals/` | 待评审、未启用的目标方案 | 可用于设计，不可据此直接开放能力。 |
| `docs/oa-ticket-reimbursement-materials/records/` | 有时间和环境范围的诊断/验证证据 | 只能解释证据范围，不能当成上线批准。 |
| `docs/oa-ticket-reimbursement-materials/reference/` | 脱敏模板、调研和 fixture | 仅作输入或演练资产；不可放真实业务数据。 |
| `docs/oa-ticket-reimbursement-materials/history/` | 已被替代的旧材料 | 仅保留追溯，不能恢复为当前需求。 |
| `docs/oa-ticket-reimbursement-materials/cases/`、`drafts/` | 真实案例和本地底稿 | Git 忽略；不得提交、外发或当作测试 fixture。 |

新增或变更架构决定时，新增 ADR，不改写历史 ADR。产品行为变化先修改 PRD；实施文档只描述落地结构、迁移和技术约束。

---

## 仓库布局

```text
apps/miaoda-admin/                    # 妙搭管理员前端（独立 Vite 包）
docs/
├── README.md                         # 项目文档导航
├── adr/                              # 已接受的架构决策记录
└── oa-ticket-reimbursement-materials/
    ├── current/                      # 当前有效基线
    ├── proposals/                    # 待评审方案
    ├── records/                      # 诊断与验证证据
    └── reference/                    # 脱敏模板与 fixture
infra/                                # 本地 PostgreSQL / 对象存储与迁移
scripts/                              # 开发、bridge、迁移和运维脚本
server/
├── api/                              # HTTP 适配层：管理、飞书、内部接口
├── lib/
│   ├── admin/                        # 管理端鉴权与服务
│   ├── control-plane/                # receipt/outbox、任务、effect、lease、持久化适配
│   ├── coupon-oa/                    # 优惠券领域规则和三源流程
│   ├── excel-template-engine/        # 模板读取、生成与校验
│   └── feishu/                       # 飞书客户端、事件、卡片、Base/Drive/OA 适配
└── routes/                           # Nitro 路由
```

### 模块边界

- `server/api/` 和 `server/routes/` 只处理 HTTP、认证、参数解析和响应；不要把业务状态机堆进路由。
- `server/lib/feishu/` 负责飞书 SDK/API、平台字段和卡片适配；外部 API 调用应集中在 gateway/client 中。
- `server/lib/coupon-oa/` 放优惠券领域规则、校验、计算和流程契约；领域逻辑不得依赖飞书 SDK、HTTP Request/Response 或数据库实现类型。
- `server/lib/control-plane/` 负责耐久事件收据、outbox、任务、effect、租约和持久化接口；不要用进程内 Map 替代持久去重或业务幂等。
- `server/lib/excel-template-engine/` 保持独立；卡片/路由层不得直接拼装 Excel。
- 需要访问 Base、Drive、Approval、对象存储或 AI 服务时，优先通过明确的 repository/gateway 接口，而不是让领域函数直接调用外部 SDK。

不要为同一职责随意引入第二个 HTTP 框架、ORM、配置库、队列或日志框架。技术选型必须遵从 ADR 与 `docs/future-technology-selection.md`。

---

## 飞书事件、耐久控制面与幂等

### 事件入口

- 长期目标是“HTTPS callback → 快速校验/持久接收 → 异步 worker”；同步入口不可执行 AI、文件处理、长事务、多次飞书 OpenAPI 调用或完整审批提交。
- 内网试点可使用企业托管、常驻、受监督的 long-connection bridge，但 bridge 只做事件消费、标准化、耐久写入和签名转发；不得在个人电脑、本地开发 shell 或 Vercel Serverless 中承载上线长连接。
- 所有入口都必须验证签名/密钥、时间戳和重放条件，并记录稳定事件标识。

### 事件与副作用规则

飞书会重复推送事件，卡片会被重复点击，外部请求也可能在响应丢失后处于未知状态。实现必须满足：

1. 事件接收有持久 receipt/inbox 去重；
2. 业务命令、文件产物、卡片消息和审批提交各自使用稳定、可审计的语义幂等键；
3. 副作用经 outbox/effect 记录、重试和回读确认；
4. 任务/worker 使用持久 lease，而不是内存锁；
5. 审批创建结果不确定时进入 `SubmissionUnknown` 并对账，**不得**盲目创建第二笔；
6. 重试不得重复发卡、创建草稿、上传审批附件或提交 OA。

PostgreSQL 是耐久任务、revision、确认快照、事件收据、outbox、effect 和审批尝试的事实源；对象存储保存来源与冻结产物的 canonical bytes。Base / Drive 是 POC 投影和飞书可见资料，不承担跨表事务、唯一约束或提交锁。

---

## 优惠券 OA 的不可突破边界

1. 当前首发默认 `draft-only`；没有明确 Gate 和服务端授权，不得创建、重试创建或自动提交飞书原生 OA。
2. 原生 OA 创建前必须有当前 owner、当前 revision、明确确认快照、审批定义/产物 Gate、稳定幂等键和创建后 readback。
3. 源白名单只用于解析与映射，**绝不**直接进入 OA 审批附件；只有确认后、冻结并完成 hash 校验的受控产物才可走受批准的附件路径。
4. 业务员、管理员和审批人的授权由服务端复核；前端隐藏按钮、卡片字段或 AI 输出都不能代替授权。
5. 不得覆盖原生 OA 的审批人、抄送人或审批路由。
6. P1-1、旧系统草稿路径和待评审三源路线必须保持各自的入口、存储、功能开关与数据边界；不要为“统一体验”静默混用它们。
7. 本地 Skill 只能生成获授权的本地辅助产物。它不读取/写入 Bot、Base、Drive 或 OA，也不共享运行时状态和权限。

若修改优惠券路线，先阅读：

- [当前产品基线](docs/oa-ticket-reimbursement-materials/current/product/)
- [当前实现基线](docs/oa-ticket-reimbursement-materials/current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md)
- [rollout 计划](docs/oa-ticket-reimbursement-materials/current/operations/coupon-oa-internal-pilot-rollout-plan-v1.md)
- [Skill 与产品文档关系](docs/oa-ticket-reimbursement-materials/claude-code-skill-contract.md)

---

## 配置、隐私与安全

- 环境变量以 [`.env.example`](.env.example) 为准。`.env`、`.env.local`、部署配置、token、App Secret、数据库凭证和对象存储密钥不得提交或输出到日志、文档、测试快照、提交信息或 PR 描述。
- 浏览器端不得保存飞书密钥、数据库凭证、服务器管理密钥或可用于扩大权限的 token。
- 日志可记录相关的 `request_id`、`event_id`、`message_id`、`task_id`、`draft_id`、`revision`、`effect_id`、`approval_instance_code` 和 `duration_ms`；不得记录完整事件 payload、审批附件、员工敏感信息或密钥。
- 测试数据、截图和 Excel fixture 必须脱敏。真实材料仅放在被 Git 忽略的 `cases/` 或 `drafts/`。
- 外部 API、数据库、对象存储和 AI 请求需要显式超时、失败处理和可诊断错误；不得空 `catch`、吞掉错误后返回成功，或仅打印错误却继续执行副作用。
- `ADMIN_AUTH_MODE=development` 仅可用于非生产本地环境；所有生产管理操作必须可验证实际操作者身份并在服务端检查权限。

---

## TypeScript 与测试约定

### 代码风格

- 使用 pnpm；不要使用 npm 或 yarn 改写锁文件。
- 遵循 [`biome.json`](biome.json)：2 空格缩进、双引号、LF 行尾、80 列格式化目标。
- 文件使用 `kebab-case.ts`，类型使用 `PascalCase`，函数/变量使用 `camelCase`，常量使用 `UPPER_SNAKE_CASE`。
- 类型导入使用 `import type`；禁止用 `any`、`@ts-ignore` 或 `@ts-expect-error` 绕过类型检查。
- 失败状态使用明确、稳定的错误码和结构化结果；不要让 AI 或字符串匹配充当最终业务校验。

### 验证命令

```bash
pnpm dev                              # Nitro 本地 API
pnpm dev:admin                        # 妙搭管理员前端
pnpm dev:events                       # 仅本地调试 long-connection bridge
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm build:admin

pnpm infra:up                         # 本地 PostgreSQL + MinIO
pnpm db:migrate:control-plane          # 需要 DATABASE_URL
pnpm test:control-plane
pnpm test:control-plane:postgres       # 需要本地基础设施和 DATABASE_URL
pnpm test:coupon-three-source:offline
pnpm test:coupon-activity-copy
```

- 代码改动至少运行受影响测试，以及适用的 `pnpm lint` 和 `pnpm typecheck`；涉及构建、配置或前端时运行对应 build。
- 外部飞书、Drive、Base、Approval、对象存储和 AI 调用必须用 mock/fake 覆盖成功、失败、超时、重复和未知结果。
- 涉及事件、任务、卡片或 OA 的变更必须覆盖重复消息、重复点击、重试、worker 重启、权限失败和幂等键冲突。
- 数据库 migration 是追加式的：绝不修改已应用 migration；新变更新增编号 SQL migration。迁移脚本会校验已应用文件的 SHA-256。
- 文档改动要检查 Markdown 链接和数据边界；文档测试不能代替运行时测试。

---

## Git 与交付纪律

- 提交信息使用 Conventional Commits：`feat:`、`fix:`、`docs:`、`test:`、`refactor:` 或 `chore:`；范围可按模块补充。
- 保留并尊重用户已有的未提交修改。不要使用 `git reset --hard`、`git checkout --`、强制覆盖、批量删除或其他破坏性命令。
- 除非用户明确要求，不要自行提交、推送、创建 PR、修改远程仓库设置、部署服务或调用会产生外部业务副作用的 API。
- 提交前确认暂存范围；不得夹带 `.env*`、`node_modules/`、构建产物、真实案例、调试文件或无关改动。
- 用户要求发布时，先验证代码/文档、确认 remote 与目标分支，再如实报告执行结果。

---

## 关键文档索引

| 要做什么 | 先读 |
| --- | --- |
| 理解项目与本地启动 | [README](README.md) |
| 查全部项目文档和状态含义 | [docs/README](docs/README.md) |
| 判断架构、部署和试点边界 | [架构基线](docs/architecture-decision.md) · [ADR](docs/adr/) |
| 判断当前优惠券用户行为与验收 | [当前产品基线](docs/oa-ticket-reimbursement-materials/current/product/) |
| 修改优惠券代码结构、状态机或文件交接 | [当前实现基线](docs/oa-ticket-reimbursement-materials/current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md) |
| 判断上线、allowlist、canary、暂停与回滚 | [rollout 计划](docs/oa-ticket-reimbursement-materials/current/operations/coupon-oa-internal-pilot-rollout-plan-v1.md) |
| 评审未上线的一轮确认或三源路线 | [待评审方案](docs/oa-ticket-reimbursement-materials/proposals/README.md) |
| 修改 Claude Code Skill | [Skill 与产品文档关系](docs/oa-ticket-reimbursement-materials/claude-code-skill-contract.md) |
| 新增环境变量、Bridge、worker、存储或生产化依赖 | [`.env.example`](.env.example) · [技术选型决策](docs/future-technology-selection.md) · [ADR-0007](docs/adr/0007-adopt-durable-control-plane-for-coupon-pilot.md) |
