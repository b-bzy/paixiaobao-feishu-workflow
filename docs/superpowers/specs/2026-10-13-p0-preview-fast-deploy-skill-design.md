# P0 Preview 快速部署 Skill 设计

> 日期：2026-10-13  
> 状态：待需求方审阅  
> 范围：三源优惠券本机长连接 draft-only POC 的 Vercel Preview 部署、启动、状态检查和停止

## 1. 目标

把当前分散的 Vercel 部署、URL 抄写、revision 回读、Protection Bypass、bridge、worker 和状态核对沉淀为仓库级 Skill 与确定性脚本。日常迭代应在已有配置不变时通过一条入口命令完成“校验 → Preview 部署 → 身份回读 → 启动本机测试链路”，不再手工编辑 Vercel URL 或临时 relay。

成功标准：

- 普通代码迭代不重复填写 Vercel Preview 环境变量；
- 部署 URL 从 Vercel CLI stdout 自动获取；
- bridge 和 worker 直接使用 Preview URL 与 Protection Bypass header；
- 启动前严格回读完整 Git SHA，旧部署或错误分支立即失败；
- 同一工作区只存在一个受控测试会话，状态和停止动作可重复执行；
- Skill、脚本、runbook 和测试均不保存或输出 secret；
- 快捷流程不开放生产、原生 OA、allowlist 扩张或长期本机运行。

## 2. 方案选择

采用“仓库脚本负责确定性执行，Skill 负责路由与安全决策”的组合方案。

不采用：

- 继续维护 `.vercel/vercel-protection-relay.mjs`：它位于忽略目录、写死每次变化的 URL，且重复了现有 runner 的 bypass 能力；
- 仅写一份命令清单：仍会重复抄 URL、环境变量和进程控制，无法自动验证；
- 第一版引入新的 CI/CD 或托管 bridge 平台：超出当前本机 P0 范围，并会混淆 ADR-0006 的 R1 要求。

Vercel CLI 部署输出作为新 Preview URL 的唯一来源。Protection Bypass 使用 `x-vercel-protection-bypass` header；不把 token 放入 URL。

## 3. 用户入口

新增仓库命令：

```text
pnpm p0:preview:check
pnpm p0:preview:deploy
pnpm p0:preview:up
pnpm p0:preview:status
pnpm p0:preview:down
```

以及仓库级 Skill：

```text
.agents/skills/p0-preview-deploy/
├── SKILL.md
└── references/
    ├── configuration.md
    └── troubleshooting.md
```

Skill 在用户要求部署、重新部署、启动飞书测试、查看 P0 测试链路或停止测试时启用。Skill 不承载 secret 和具体部署 URL，只调用受测试的仓库命令并解释结果。

## 4. 配置模型

### 4.1 Vercel 侧一次性配置

Preview 环境变量继续由 Vercel 项目管理，并按 `p0-three-source-direct-http` 分支限定。普通部署只继承配置，不重新添加变量。密钥轮换、环境范围改变和 Gate 开关变化是独立运维动作，不属于普通 `deploy`。

### 4.2 本机配置

本机 runner 只读取 Git 忽略、权限为 `0600` 的配置文件，建议路径为 `.local/p0-preview.env`。其中保存 bridge key ID/shared secret、control-plane tick token 和 Vercel Automation Bypass。脚本只检查值是否存在和格式是否合法，不打印值。

非敏感运行状态写入 `.local/p0-preview-state.json`，包含：项目名、分支、完整 Git SHA、Preview URL、部署时间、bridge/worker PID 和状态版本。该目录加入 Git 忽略。

Skill 首次发现配置缺失时只引导一次性配置；不得从聊天、日志或命令行参数接收 secret。后续可增加 macOS Keychain 适配，但不作为第一版前置条件。

## 5. 命令行为

### 5.1 `check`

只读检查：

- 当前目录是已链接的目标 Vercel 项目；
- 分支是 `p0-three-source-direct-http`；
- HEAD 是完整 Git revision；
- 工作区是否有未提交代码。默认拒绝部署脏工作区；仅报告文档等明确无关变更不能自动推断安全；
- 本机配置文件存在且权限不宽于 `0600`；
- 没有第二个 bridge、worker、旧 `curl` tick 或 relay；
- 当前 kill switch 与 P0 所需开关由受保护诊断接口返回预期状态；
- 运行本次变更要求的测试、`pnpm typecheck`、相关 Biome 检查和 `pnpm build`。

`check` 不写 Vercel、数据库、Base、Drive 或 OA。

### 5.2 `deploy`

这是外部写入命令，只有用户明确要求部署时执行：

1. 执行 `check`；
2. 使用 Vercel CLI 创建 Preview，并显式附加 Git branch/revision metadata；
3. 捕获 stdout 中的部署 URL，不解析人类日志；
4. 使用 Automation Bypass header 请求 `/api/deployment-identity`；
5. 要求响应的完整 SHA 等于本地 HEAD；
6. 请求受保护的最小健康/诊断端点，验证 stage、native kill switch、pilot/AI Gate；
7. 原子写入非敏感 state 文件。

任一步失败均不启动 consumer，不沿用旧 state URL，也不改动 Gate。

### 5.3 `up`

`up` 组合 `check`、`deploy` 和本机启动：

- 若当前 state 已指向相同 SHA 且身份/健康回读通过，可复用部署；否则创建新 Preview；
- 为 bridge 和 worker 注入相同的 URL、SHA、bypass 与各自凭据；
- 使用现有单进程保护，禁止双 consumer 和双 worker；
- 等待进程完成启动校验后才写 PID；
- 输出 Preview hostname、短 SHA、bridge/worker 状态和“可开始飞书手工测试”；
- 不自动发送飞书消息、不替用户点击卡片、不声称 E2E 成功。

第一版保持现有环境 Gate。若打开/关闭 pilot 必须导致重新部署，Skill 可以调用单独、显式授权的配置动作并重新部署，但不得把它隐藏在普通 `status` 或重试中。将 Gate 改成数据库运行时开关属于后续架构任务。

### 5.4 `status`

读取 state、核对 PID、回读部署身份和诊断端点。只显示：环境、hostname、短 SHA、进程是否存活、Gate 摘要和最后检查时间。任何密钥、完整 open ID、数据库 URL、file key 和事件 payload 都不得输出。

### 5.5 `down`

只停止由当前 state 记录且进程指纹匹配的 bridge/worker，等待退出并清理 PID。PID 已复用或进程指纹不匹配时拒绝发送信号并报告人工核对。`down` 不删除 Vercel deployment、PostgreSQL、Base、Drive 或 OA 数据。

## 6. 模块边界

建议新增：

- `scripts/p0-preview.mjs`：命令行入口与子命令路由；
- `scripts/lib/p0-preview-config.mjs`：安全读取本机配置和 state；
- `scripts/lib/p0-preview-deploy.mjs`：Vercel CLI 调用、stdout URL 解析和身份/健康回读；
- `scripts/lib/p0-preview-processes.mjs`：bridge/worker 启停、PID 指纹和单实例检查；
- 对应 `.test.mjs`：使用 fake CLI/fetch/process adapter 测试，不真实部署。

现有 `long-connection-bridge.mjs`、`run-p0-control-plane-worker.mjs` 和身份验证模块继续作为运行组件，不复制 HMAC、tick 或 deployment identity 逻辑。

## 7. Skill 内容边界

`SKILL.md` 只包含：适用请求、命令选择、外部写入授权边界、成功/停止条件和需要按需读取的 reference。详细一次性配置放 `configuration.md`，失败码与恢复路径放 `troubleshooting.md`。

Skill 必须：

- 在部署前确认请求明确指向 Preview P0；
- 对只读状态请求只运行 `status`/`check`；
- 不把“部署成功”表述为“飞书 E2E 成功”；
- 不自动重试未知状态的外部副作用；
- 不执行 Production、原生 OA、资源删除或密钥轮换，除非另有明确任务和授权；
- 失败时保留诊断状态并停止 consumer，而不是临时拼接 relay。

## 8. 错误处理和恢复

- Vercel CLI 失败：保留旧 state 但标记未激活，不启动 runner；
- URL 无效或身份 SHA 不一致：视为错误部署，拒绝使用；
- Protection Bypass 失败：提示检查 secret 是否与项目当前值一致，不回退到 URL query；
- 迁移/build 失败：部署失败，禁止跳过；
- bridge/worker 部分启动：停止本次已启动进程并报告具体阶段；
- 本地重启后残留 PID：通过进程指纹和命令行核对，不能仅凭 PID 杀进程；
- 用户中断：停止本次子进程，不改变持久 Gate 和外部资源。

## 9. 测试与验收

自动测试至少覆盖：

- Vercel stdout 正确 URL、空输出、多个 URL 和非零退出；
- Git branch/SHA 和脏工作区 Gate；
- 配置缺失、权限过宽和日志脱敏；
- identity 成功、HTTP 失败、无 SHA、SHA 不匹配和 timeout；
- Protection Bypass header 存在且不进入 URL/日志；
- 相同 SHA 复用与不同 SHA 强制部署；
- 双 bridge、双 worker、relay/curl loop 检测；
- 部分启动回滚、PID 复用保护和幂等 `down`；
- native kill switch 或 stage 不符合时 fail closed；
- Skill 结构通过 `quick_validate.py`，所有 references 可达且无 scaffold 占位符。

一次受控 smoke 验收：在明确授权的 Preview 创建部署，回读 revision，启动 bridge/worker，执行 `status`，再执行 `down`。不需要发送真实飞书消息即可证明部署 Skill 工作；飞书 E2E 由用户随后手工执行。

## 10. 文档与架构影响

实施时更新 `package.json`、P0 local-long-connection runbook、README 和 `.env.example` 的本机非敏感说明。该工具不改变 Vercel/Nitro、本机 P0 bridge 和 R1 企业托管 bridge 的职责，因此不新增 ADR。它仍是 ADR-0010 下的限时开发测试工具，不能作为正式上线方式。
