@/Users/jacob/.codex/RTK.md

# AGENTS.md

## Project Overview

爱回收飞书工作流与 Agent/Skill 平台。管理员配置和发布业务模板，员工在飞书中调用模板或 Skill，系统保存业务草稿、执行工作流、提交飞书原生审批并追踪结果。

本仓库当前正式技术栈是 Nitro + TypeScript。现阶段目标是先完成并验证飞书 POC，不预设必须迁移到 Go。Go 只作为未来正式生产选型的候选方案；没有经过评估并新增 ADR 前，Agent 不得自行创建 Go 服务或迁移现有 TypeScript 代码。原 Slack/Notion 项目只用于功能和交互对照，不得复用其公司名称、凭证、部署或生产数据。

禁止在新代码、界面、数据库、文档和部署资源中使用 `K-team`、`K-team Workflow`、`kapi` 等旧项目名称。统一使用 `aihuishou`、`爱回收` 或本仓库已定义的产品名称。

## Source of Truth

- 当前项目说明：`README.md`
- 当前架构基线：`docs/architecture-decision.md`
- 后续技术选型：`docs/future-technology-selection.md`
- 架构决策记录：`docs/adr/`
- 环境变量示例：`.env.example`

当实现与文档冲突时，先确认当前运行行为，再更新文档。改变事件入口、控制面/执行面边界、事实数据源、审批提交方式或部署平台时，必须新增 ADR。

## Migration Principles

- 保留领域逻辑，重写平台适配层；不要把 Slack handler 逐行翻译成飞书 handler。
- Slack ID 与飞书 ID 不可互换，必须显式转换并记录映射。
- Slack Block Kit 应重建为飞书消息卡片，而不是机械复制字段。
- Slack `ack()` 对应飞书回调的快速确认；耗时工作进入异步流程。
- 迁移期间保持现有 TypeScript POC 可运行，每个功能按独立切片迁移。
- 新的领域和应用层不得依赖 Slack、飞书 SDK、HTTP 框架或数据库实现类型。
- 通过功能开关灰度切换；验证飞书路径后再删除 Slack 对应实现。

## Current Technology Stack

- pnpm 10.14.0
- Nitro + TypeScript
- Vercel
- 飞书 Base（POC 模板和实例数据）
- 妙搭管理员前端
- 飞书机器人、消息卡片和审批
- Vitest + Biome + TypeScript typecheck

PostgreSQL、Redis、持久化消息队列、容器托管和 Go 都属于后续生产化候选项，不是当前 POC 的必选依赖。引入其中任何一项前，必须在 `docs/future-technology-selection.md` 中完成评估；若改变系统职责边界或部署方式，还必须新增 ADR。

禁止为同一职责同时引入多个 HTTP 框架、ORM、配置库或日志框架。

## Repository Layout

保持当前 TypeScript 工程结构：

```text
server/
├── api/feishu/             # 飞书事件和流程 API
├── lib/feishu/             # 飞书客户端、事件、卡片与审批适配
├── lib/                    # 平台无关的业务逻辑
└── routes/                 # Nitro 路由
apps/miaoda-admin/          # 妙搭管理员前端
scripts/                    # 本地联调、长连接与运维脚本
docs/                       # 架构、迁移资料和 ADR
```

如果未来批准采用 Go，应建立独立服务目录或独立仓库，避免将 Go 文件直接混入 `server/`。具体目录、部署和迁移顺序由对应 ADR 决定。

## Architecture Boundary

飞书 API 调用和平台字段转换集中在 `server/lib/feishu/`。HTTP 请求解析集中在 `server/api/` 或 `server/routes/`；业务规则应提取到 `server/lib/` 中可独立测试的模块，不要堆在路由处理器内。

领域层不得直接依赖：

- 飞书或 Slack SDK 类型
- HTTP Request/Response 类型
- ORM 类型
- `open_id`、`chat_id` 等平台字段

外部能力通过应用层接口调用。类型定义靠近使用方，不建立无意义的全局类型集合。

```typescript
export type MessageSender = {
  sendCard(receiverId: string, card: Card): Promise<void>;
};

export type ApprovalGateway = {
  createInstance(request: CreateApprovalRequest): Promise<string>;
};
```

## Feishu Event Strategy

### Local Development

本地可以使用飞书长连接，长连接进程必须支持自动重连、连接状态日志、优雅退出、重复事件过滤和健康检查。

### Production

生产默认采用：

```text
飞书事件 → HTTPS 回调 → 校验并快速确认 → 持久化/队列 → 异步执行器
```

回调必须在 3 秒内返回，工程目标应小于 1 秒。同步回调中只允许执行签名和 Token 校验、解密、challenge 响应、事件幂等检查以及可靠入队。

禁止在同步回调中执行 AI 调用、文件处理、长事务、多次飞书 OpenAPI 调用、完整审批提交或等待人工操作。

长连接不部署到 Vercel Serverless Function。若生产使用长连接，必须部署到支持常驻进程的平台，并配置重连、告警和进程守护。

## Event Idempotency

飞书可能重复推送事件，同一事件只能产生一次业务副作用。

- 使用 `event_id`、`message_id`、卡片回调事件 ID 或业务 UUID 建立数据库唯一约束。
- 事件状态使用 `received → processing → succeeded/failed`。
- 重试不得重复发送卡片、重复创建草稿或重复提交审批。
- 卡片按钮重复点击必须返回已有结果或明确的“处理中”。
- 不允许只使用进程内 Map 去重。
- 所有副作用操作都必须支持业务幂等键。

## Identity and Authorization

必须显式区分：

- `tenant_access_token`：应用/机器人身份，用于机器人消息和应用权限内的数据访问。
- `user_access_token`：用户身份，用于代表真实员工执行必须记录操作人的动作。

不得由底层客户端隐式选择身份。每个用例必须明确其调用主体。

管理员、员工和审批人权限由服务端校验，不能只依赖前端隐藏按钮。Skill 必须保存允许调用的组织范围、角色、数据源和工具权限。

## Approval and Draft Rules

飞书原生审批 API 不提供与客户端完全一致的原生草稿能力。本项目采用系统业务草稿：

```text
机器人收集信息
→ 保存系统草稿
→ 员工检查和补充
→ 员工确认
→ 使用员工身份提交飞书原生审批
→ 保存 instance_code
→ 监听并记录审批状态
```

- 信息不完整时不得正式提交。
- 条件字段变化后必须重新验证分支必填项。
- 附件必须在提交前完成上传和校验。
- 保存审批定义版本或表单快照。
- 保存提交人、审批实例编号和完整状态历史。
- 审批创建失败时保留可重试的业务草稿，不得伪造成功状态。

## Slack to Feishu Mapping

| Slack | Feishu |
|---|---|
| Event API | 飞书事件订阅 |
| `app_mention` / message event | `im.message.receive_v1` |
| Block Kit | 飞书消息卡片 |
| Interactive components | `card.action.trigger` |
| `user_id` | `open_id` / `user_id` |
| `channel_id` | `chat_id` |
| Bot token | tenant access token |
| User OAuth token | user access token |
| `ack()` | 快速返回回调响应 |
| Slack thread | 飞书回复、话题或业务会话 |

以上并非完全一一对应。实现前必须重新确认飞书权限、消息模型和交互限制。

## TypeScript Code Style

- 遵循 `biome.json` 和严格 TypeScript 配置。
- 使用 2 空格缩进、双引号和 LF 行尾。
- 内部模块优先使用项目已配置的路径别名。
- 类型导入使用 `import type`。
- 文件使用 `kebab-case.ts`；类型使用 `PascalCase`；函数和变量使用 `camelCase`；常量使用 `UPPER_SNAKE_CASE`。
- 不使用 `any`、`@ts-ignore` 或 `@ts-expect-error` 绕过类型检查。
- 外部 API、数据库和 AI 请求必须设置超时并处理失败。
- 使用结构化结果和稳定错误码；不得使用空 catch、吞掉错误后返回成功或只记录错误不传播。

业务错误使用稳定错误码，例如：

```text
INVALID_TEMPLATE
DRAFT_INCOMPLETE
USER_AUTH_REQUIRED
APPROVAL_SUBMIT_FAILED
DUPLICATE_EVENT
FEISHU_RATE_LIMITED
```

## Logging and Security

结构化日志应包含适用的 `request_id`、`event_id`、`message_id`、`draft_id`、`workflow_id`、`approval_instance_code`、`skill_id` 和 `duration_ms`。

不得记录 App Secret、access/refresh token、Encrypt Key、完整审批附件、员工敏感信息或未经脱敏的事件载荷。

当前环境变量以 `.env.example` 为准，主要包括：

```text
FEISHU_APP_ID
FEISHU_APP_SECRET
FEISHU_VERIFICATION_TOKEN
FEISHU_BASE_APP_TOKEN
FEISHU_TEMPLATE_TABLE_ID
FEISHU_INSTANCE_TABLE_ID
FEISHU_COUPON_OA_MODE
FEISHU_COUPON_OA_APPROVAL_CODE
FEISHU_COUPON_DRAFT_TABLE_ID
ADMIN_AUTH_MODE
ADMIN_DEV_OPEN_IDS
ADMIN_ALLOWED_ORIGINS
```

- `.env` 和 `.env.local` 不得提交到 Git。
- 用户 Token 必须加密存储，刷新操作必须防止并发竞争。
- 飞书回调必须验证签名、Token 和加密配置。
- 浏览器端不得保存飞书密钥、数据库凭证或服务器管理密钥。
- 高风险 Skill 和有副作用的 AI 操作必须要求人工确认并写入审计日志。

## Agent and Skill Configuration

管理员可配置 Skill 名称、说明、输入 Schema、数据源、工具权限、模型、超时、重试策略、可调用员工范围、人工确认规则、审批模板版本和输出卡片模板。

Skill 执行器必须：

- 校验输入 Schema 和调用人权限。
- 固定并记录配置版本。
- 限制最大执行时间、工具范围和重试次数。
- 保存执行状态和可审计轨迹。
- 对副作用操作进行幂等保护。
- 在高风险操作前暂停并等待人工确认。

AI 不得自行扩大权限、修改审批规则、跳过确认或直接访问未授权数据。

## Testing

使用 Vitest。单元测试与源码共置为 `*.test.ts`，或放在明确的测试目录；外部飞书调用必须 mock/fake。脱敏的真实事件结构可以放在 `testdata/`。所有导出的业务函数必须有单元测试，用户可见流程必须有集成测试。

核心 E2E 流程：

```text
员工发送指令
→ 收到并去重事件
→ 创建业务草稿
→ 返回交互卡片
→ 员工确认
→ 提交飞书审批
→ 收到审批状态事件
→ 更新数据库
→ 通知员工
```

必须覆盖重复消息、飞书重试、按钮重复点击、Token 过期、API 限流、必填字段缺失、审批失败和 Worker 重启。

## Build, Lint and Test Commands

### TypeScript POC

包管理器固定为 pnpm 10.14.0，禁止使用 npm 或 yarn。

```bash
pnpm install
pnpm dev
pnpm dev:admin
pnpm dev:events
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm build:admin
```

修改当前 POC 时，完成前必须运行与改动相关的 lint、typecheck、test 和 build。至少执行：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

### Future Language Changes

不得因为性能猜测、个人偏好或示例代码而自行引入 Go。只有在用户明确决定采用 Go，并且相应 ADR 已记录迁移范围、收益、成本、部署平台、数据迁移和回退方案后，才能新增 Go 工程及其构建命令。

## Migration Workflow

每迁移一个 Slack 功能：

1. 记录原功能、权限和用户行为。
2. 提取与 Slack 无关的领域逻辑。
3. 设计飞书交互和异常路径。
4. 使用当前 TypeScript 技术栈实现业务逻辑与飞书适配器。
5. 增加单元、契约和 E2E 测试。
6. 在飞书测试企业验证权限和身份。
7. 使用功能开关灰度发布。
8. 观察稳定后再停用旧实现。

维护功能迁移矩阵，并在 PR 或相关文档中更新状态。

## Git Conventions

使用 Conventional Commits：`feat:`、`fix:`、`test:`、`docs:`、`refactor:`、`chore:`。

禁止提交 `.env`、API Key、Token、App Secret、员工数据、未经脱敏的飞书事件、数据库备份、`node_modules/` 或构建产物。

保留并尊重用户已有的未提交修改。不得使用 `git reset --hard`、`git checkout --` 或其他破坏性命令覆盖用户工作。
