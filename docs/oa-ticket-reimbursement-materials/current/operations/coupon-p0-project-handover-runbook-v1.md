# 拍小宝项目交接与重建 Runbook v1

> **状态**：初稿（2026-10-21），面向"项目创建人离职、接手人尚未确定"的提前交接准备。描述运维现状与重建步骤，**不构成任何新的能力授权**；draft-only / kill switch / 可用范围等既有边界不因本手册改变。
> **日期**：2026-10-21
> **适用拓扑**：飞书 App `cli_aa327cdf12b8dcc8`（长连接）→ bridge/worker（个人开发机，分支 `p0-three-source-direct-http`）→ Vercel Preview `POST /api/feishu/poc-bridge` → 优惠券 Bot（`OA优惠券填报` / `/OA优惠券提报`）→ OA 测试稿 / 受控原生提交。
> **权威边界**：[ADR-0006](../../../adr/0006-use-managed-long-connection-bridge-for-internal-coupon-pilot.md) · [ADR-0007](../../../adr/0007-adopt-durable-control-plane-for-coupon-pilot.md) · [ADR-0010](../../../adr/0010-timebox-local-long-connection-three-source-poc.md) · [ADR-0013](../../../adr/0013-p0-bridge-coupon-oa-draft-action-passthrough.md) · [ADR-0014](../../../adr/0014-open-access-usage-authorization-via-feishu-availability-scope.md) · [rollout 计划](coupon-oa-internal-pilot-rollout-plan-v1.md) · [开放使用部署方案 v2](coupon-p0-multi-user-open-access-deployment-plan-v2.md)

## 0. 交接原则（接手人未定时）

1. **账号对账号移交优先于人对人交接。** 能挂到公司可控载体（GitHub org、公司 Vercel team、公司 DeepSeek 账号、公司数据库）的资产提前迁移；接手人确定后只需发访问权，而不是抢救资产。
2. **交接物收敛为三样**：① 加密交接包（密钥明文与资源清单，§5）；② 离开开发机的备份（`git bundle` + 被 Git 忽略的文件，§5）；③ 本手册（重建步骤，§3）。三者备齐，接手人是谁都能在半天内把系统拉起来。
3. **安全冻结是可选项。** 若一时无人接手：kill switch `FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false` 重部署 → 飞书可用范围清空 → bridge `pnpm p0:preview:down`。项目即回到无人值守的安全静止态，业务回退手工 OA，不会产生风险外溢。

## 1. 系统拓扑：活着的系统由什么组成

```text
飞书用户（私聊 / 群聊 @ / 卡片点击）
  → 飞书开放平台长连接（lark-cli `event _bus` 进程，个人开发机）
  → scripts/long-connection-bridge.mjs（个人开发机；HMAC 签名转发，60s 超时、at-least-once 重试）
  → Vercel Preview（Nitro API，POST /api/feishu/poc-bridge）
  → scripts/run-p0-control-plane-worker.mjs（个人开发机；秒级 tick 驱动 Vercel 控制面）
  → PostgreSQL（经 Vercel 集成注入；收据 / outbox / effect / AI run）
  → 飞书 Base（草稿事实源）/ Drive（冻结产物）/ DeepSeek（候选识别）
```

**单点提示**：bridge、worker 与长连接三者全部运行在**一台个人开发机**上。该机器关机、休眠或被回收，Bot 即失联——事件收不到、卡片点击无响应、AI 识别永久 pending。接管系统的第一件事是接管这三个进程的宿主（§3.3）。

代码文件夹只覆盖"代码连续性"；下列四样**不在代码文件夹里**且与创建人个人账号绑定：Vercel 项目及其环境变量、Secret 类型环境变量的明文、Git 远程、飞书长连接所依赖的应用管理权。

## 2. 资产归属清单（移交对象）

| 资产 | 当前归属 | 移交方式 |
| --- | --- | --- |
| 飞书应用 `cli_aa327cdf12b8dcc8`（拍小宝） | 创建人个人（企业租户内自建应用） | 开发者后台所有权转移 / 先加协同管理员。**禁止用新建应用替代**：open_id 按应用隔离，换应用 = 提交名单、Base 记录中的 ownerOpenId、已发布版本与权限全部作废。 |
| GitHub 仓库 `b-bzy/paixiaobao-feishu-workflow`（私有） | 个人账号 | Repository Transfer 到公司 org 或接手人；或接手人自建仓库后本地 `git push --all`（完整历史在本地，§3.2）。 |
| Vercel 项目 `aihuishou-feishu-workflow` | 个人账号（`jacobs-projects`） | Vercel 不支持跨账号转移项目，标准做法 = 接手人重建项目并重录 env（§3.1）。 |
| PostgreSQL（`DATABASE_URL` / `DATABASE_URL_UNPOOLED`） | 经 Vercel 集成创建，随创建人 Vercel 账号；成对出现的 `_UNPOOLED` 是 Neon 集成的注入签名，以 Vercel 项目 Integrations 页为准 | Secret 值不可回读；接手人新建数据库并执行 `pnpm db:migrate:control-plane`。业务草稿事实源在飞书 Base，丢失的只是收据/outbox/AI run 历史，POC 阶段可接受。 |
| DeepSeek API key | 个人账号计费 | 公司注册并充值后更换 Vercel env `DEEPSEEK_API_KEY`，重部署。 |
| 飞书 Base（三源试点表、OA 草稿表、旧 POC Base）与 Drive 文件夹 | 文档所有者为创建人 | 在飞书内转移文档所有者或加可管理协作者；token 清单随交接包。 |
| 审批定义（真实【拍拍】优惠券申请及修改 / 测试定义【草稿验证】请勿提交优惠券申请） | 企业租户 | 无需迁移。接管者须知：canary 真实提交会进入真实审批人待审列表。 |
| 妙搭管理员前端（`apps/miaoda-admin`） | 独立构建，按需部署到妙搭 | 确认是否仍在使用及妙搭侧账号归属。 |

## 3. 重建手册

### 3.1 Vercel 重建

前置：§4 环境变量事实清单与交接包在手。

```bash
vercel login                 # 接手人自己的账号（建议公司 team；POC 阶段个人账号亦可）
vercel link                  # 在代码文件夹内执行，覆盖指向旧项目的 .vercel/project.json
# 按 §4 清单重录 env：
#   vercel env add NAME preview
#   vercel env add NAME preview --git-branch p0-three-source-direct-http   # 分支限定变量
pnpm p0:preview:deploy
```

三处连锁必须同步，缺一则 bridge/worker 打不到新部署：

1. **部署域名变了** → 更新本机 bridge 侧的 `FEISHU_BRIDGE_TARGET_URL`（与 `.local/p0-preview.env` 同一套本机环境）指向新 `*.vercel.app` 域名；
2. `FEISHU_P0_EXPECTED_GIT_SHA` 锁定的是部署 Git SHA，新部署后按新值更新；
3. 新项目重新配置 Deployment Protection 的 bypass secret；`VERCEL_AUTOMATION_BYPASS_SECRET` 在 `.local/p0-preview.env` 中同步换新值。

验证：`GET /api/deployment-identity`（带 tick token 与 `x-vercel-protection-bypass` 头，凭据在 `.local/p0-preview.env`）回读 readiness；真发冒烟 = 在飞书中向 Bot 发送 `/OA优惠券提报` 并观察回卡。

### 3.2 Git 远程更换

| 方案 | 做法 | 适用 |
| --- | --- | --- |
| A. Repository Transfer | GitHub 仓库 Settings → Transfer ownership → 公司 org 或接手人；本地 `git remote set-url origin <新地址>` | 已知接手人；issues / PR 一并带走，旧 URL 自动重定向 |
| B. 本地推新仓 | 接手人自建仓库后 `git remote set-url origin <新地址> && git push --all && git push --tags` | 任何时候可做；完整 Git 历史已在本地文件夹内 |

活跃主线为 `p0-three-source-direct-http`（Vercel Preview 绑定分支），`main` 落后于它，**没有生产分支**。接手人另需改本机 `git config user.name` / `user.email`，避免以创建人身份提交。

### 3.3 bridge / worker 迁移（接管系统的心脏）

```bash
# 新宿主机一次性准备
brew install node@22 && npm i -g pnpm @larksuite/cli
# lark-cli 交互绑定应用 cli_aa327cdf12b8dcc8（App ID / Secret 来自交接包）

# 代码文件夹就位后
pnpm install
# 放置 .local/p0-preview.env（权限 0600）：FEISHU_BRIDGE_KEY_ID / FEISHU_BRIDGE_SHARED_SECRET /
#   CONTROL_PLANE_TICK_TOKEN / VERCEL_AUTOMATION_BYPASS_SECRET，以及 FEISHU_BRIDGE_TARGET_URL
pnpm p0:preview:check && pnpm p0:preview:up
```

纪律：

1. **同一应用只允许一个事件消费端**：旧机先 `pnpm p0:preview:down`，新机再 `up`；双活会导致事件重复处理。
2. 真实提交开关开启期间，`p0:preview:deploy / up / status` 必须带 `P0_ALLOW_NATIVE_SUBMIT_WINDOW=true`，否则部署身份守卫直接拒绝。
3. 本机代理（如 `127.0.0.1:7897`）抖动会同时打死长连接与 worker tick；"点了没反应"先 `nc -z 127.0.0.1 7897`，再按仓库 Skill `p0-stuck-diagnosis` 的漏斗排查。
4. 企业常驻宿主的正式路径见[资源发现与部署前交接指南](coupon-oa-managed-bridge-provisioning-guide-v1.md)与 [bridge runbook](coupon-oa-managed-bridge-runbook-v1.md)；个人机只是过渡。

### 3.4 名单与授权改法

- **使用授权**：`FEISHU_COUPON_OA_OPEN_ACCESS=true` 已生效，谁能用 = 飞书应用可用范围。改法：admin.feishu.cn → 工作台 → 应用管理 → 拍小宝 → 可用范围（已发布过版本的应用免再发版）。
- **真实提交授权**：`FEISHU_COUPON_OA_NATIVE_SUBMIT_ALLOWED_OPEN_IDS`（逗号分隔、`ou_` 前缀、**必须英文逗号**——格式错一个字符 = 全员收到"未开通"）。改后必须重部署才生效。回滚 = kill switch `FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false` 重部署。
- **管理端**：`ADMIN_DEV_OPEN_IDS` 与 `apps/miaoda-admin/.env.local` 的 `VITE_ADMIN_DEV_OPEN_ID` 换为接手人 open_id（仅限非生产 development 模式）。
- 当前真实状态一律以 `/api/deployment-identity` 回读为准，不凭记忆或文档断言。

## 4. 环境变量事实清单

权威来源：`vercel env ls`（2026-10-21 实测）。本机明文副本：`.env.local`（应用身份）、`.local/p0-preview.env`（bridge / tick / bypass）、`.local/vercel-env-preview`（Config 类变量的 pull 结果）。**Secret 类型的值在 UI 与 CLI 均不可回读，本机副本即唯一来源**，交接包必须包含。

| 变量 | Vercel 类型 | 用途 / 重建动作 |
| --- | --- | --- |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | Secret | 应用身份；副本在 `.env.local`。App Secret 轮换后须按序同步：Vercel env → 重部署 → lark-cli 重绑 → bridge 重启。 |
| `FEISHU_BRIDGE_KEY_ID` / `FEISHU_BRIDGE_SHARED_SECRET` | Secret | bridge HMAC；副本在 `.local/p0-preview.env`；迁移时建议直接轮换。 |
| `CONTROL_PLANE_TICK_TOKEN` | Secret | 内部 tick 端点 bearer；同上。 |
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` | Secret | 经 Vercel 集成注入，不可回读；接手人新建数据库 + `pnpm db:migrate:control-plane`。 |
| `DEEPSEEK_API_KEY`（`DEEPSEEK_MODEL` / `DEEPSEEK_BASE_URL` 为 Config） | Secret | 更换为公司账号 key。 |
| `FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED` / `..._ALLOWED_OPEN_IDS` / `..._NATIVE_SUBMIT_OPEN_ACCESS` / `FEISHU_COUPON_OA_OPEN_ACCESS` / `FEISHU_COUPON_OA_ALLOWED_OPEN_IDS` | Secret | 授权开关与名单；语义见 `server/lib/feishu/coupon-oa/config.ts` 与 rollout；按 §3.4 重设。 |
| `FEISHU_COUPON_THREE_SOURCE_PILOT_BASE_APP_TOKEN` / `..._TABLE_ID` / `..._FOLDER_TOKEN` / `FEISHU_BASE_APP_TOKEN` / `FEISHU_COUPON_DRAFT_TABLE_ID` / `FEISHU_COUPON_OA_APPROVAL_CODE` | Secret | 飞书资源标识，照录；用途见 `.env.example` 注释。 |
| `FEISHU_COUPON_THREE_SOURCE_P0_AI_RECOGNITION_ENABLED` | Secret | AI 识别总开关，照录。 |
| `FEISHU_COUPON_OA_MODE` / `FEISHU_RUNTIME_STAGE` / `FEISHU_LEGACY_POC_ENABLED` / `FEISHU_WORKER_ID` / `FEISHU_COUPON_THREE_SOURCE_PILOT_ENABLED` / `..._P0_AI_PRIMARY_ENABLED` / `..._P0_AI_SHADOW_ENABLED` / `..._P0_ACTIVITY_COPY_ENABLED` / `..._P0_PUBLIC_CALENDAR_ENABLED` / `..._P0_AI_TIMEOUT_MS` | Config | 非 Secret，`vercel env pull` 可读，值照录。 |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | 项目设置，不在 env 列表 | 新项目在 Deployment Protection 中重新生成。 |
| `FEISHU_BRIDGE_TARGET_URL` / `FEISHU_P0_EXPECTED_GIT_SHA` / `FEISHU_BRIDGE_P0_MODE` | 仅本机 bridge 侧 | 随新部署域名与 SHA 更新（§3.1）。 |

注意：部分变量存在"Preview（全局）"与"Preview（分支 `p0-three-source-direct-http`）"两份，分支限定值优先；重录时用 `--git-branch` 区分。

## 5. 交接包与离机备份

**加密交接包**（交直属上级或 IT 保管，密码走另一渠道；不放个人网盘或个人飞书）：

1. 含明文密钥的文件：`.env.local`、`.local/p0-preview.env`、`.local/local-round.env`、`.local/vercel-env-preview`；
2. 各平台账号与来源说明：Vercel、数据库集成、DeepSeek、GitHub；
3. 资源速查：应用 App ID、Vercel 项目名、Base / Drive / 审批定义 token 清单；
4. 数据位置：`docs/oa-ticket-reimbursement-materials/cases/`（真实案例，**绝不入库、不外发**）与开发机桌面「测试用例」目录——移交后放接手人本机同样位置；
5. 本机环境说明：node 22（Homebrew `node@22`）、pnpm 10、Docker + MinIO（`pnpm infra:up`）、lark-cli 全局安装与应用绑定、本机代理对长连接的影响。

**离机备份**（防开发机回收或重装）：

```bash
git bundle create ../paixiaobao-repo-backup.bundle --all
# bundle 只含 Git 跟踪文件：.env.local、.local/、cases/ 被忽略，必须随交接包另行拷贝
```

## 6. 交接时序

| 阶段 | 动作 |
| --- | --- |
| 现在（接手人未定） | 飞书应用加协同管理员（消除唯一管理员单点）；可用范围先放行直属上级；完成 §4 清单、§5 交接包与离机备份；保持工作区干净（提交或写明未完成清单）；DeepSeek 换公司 key；确认数据库集成归属并评估迁移；按资源发现指南发起 bridge 企业宿主申请；用户说明书管理员联系方式改为团队口径。 |
| 接手人确定后 48 小时 | 应用所有权转移；重置 App Secret 并按 §4 顺序四点同步；可用范围与提交名单加接手人；GitHub / Vercel / 数据库 / DeepSeek 按 §2 移交访问权；bridge 迁宿主（旧机 `down` → 新机 `up`）；shadow 演练：部署一次、加一个用户、跑 `scripts/coupon-three-source-replay-all.mts` 回归一次、按 `p0-stuck-diagnosis` 修一个人为制造的故障。 |
| 离职日 | 轮换 bridge / tick / bypass 密钥；将创建人移出可用范围、两个名单、应用协作者与 Base / Drive 协作者；开发机 `gh auth logout`、`vercel logout`、清理 `~/.lark-cli`；接手人验证 Bot 存活并走通一单完整三源提报。 |

## 7. 安全与边界

1. 密钥值不得出现在本仓库、日志、提交信息、PR 描述或本手册；本手册只记录变量名与文件位置。
2. `cases/`、`drafts/` 与桌面测试用例含真实业务数据，只在被 Git 忽略的位置流转，不得作为测试 fixture 提交。
3. 离职者知悉过的密钥，交接完成后一律轮换。
4. 项目处于 POC / 受限内网试点阶段：本手册描述运维现状，不改变 draft-only、kill switch、可用范围与具名提交名单等既有授权边界；能力开放仍以 ADR 与 rollout Gate 为准。

## 8. 相关文档

- [开放使用部署方案 v2](coupon-p0-multi-user-open-access-deployment-plan-v2.md) / [rollout 计划](coupon-oa-internal-pilot-rollout-plan-v1.md)
- [资源发现与部署前交接指南](coupon-oa-managed-bridge-provisioning-guide-v1.md) / [bridge runbook](coupon-oa-managed-bridge-runbook-v1.md) / [readiness checklist](coupon-oa-pilot-launch-readiness-checklist-v1.md)
- [用户说明书](../../reference/coupon-oa-auto-submit-user-guide-v1.md)
- 仓库 Skill：`p0-preview-deploy`（部署与 bridge 生命周期）、`p0-stuck-diagnosis`（卡住排障漏斗）、`coupon-three-source-replay-test`（真发回归）
