# Claude Code Skill 与产品文档的关系

> **状态**：文档与本地 Agent 交互协议的治理说明；不定义新的产品能力，也不授予飞书、Drive、Base 或原生 OA 权限。
> **适用范围**：`.claude/skills/OA优惠券提报/` 与本目录中的优惠券 OA 文档。

## 先区分三层

| 层级 | 位置 | 负责什么 | 不能代表什么 |
| --- | --- | --- | --- |
| 产品与上线事实 | [`current/`](current/)、`docs/adr/` | 当前业务范围、架构决策、阶段、权限和 go/no-go | Claude Code 运行时是否已生成某份本地底稿。 |
| 待评审目标 | [`proposals/`](proposals/) | 尚未启用的目标交互、字段和实现约束 | 已部署的 Bot 命令或可创建原生 OA 的授权。 |
| Claude Code Skill | `.claude/skills/*/SKILL.md` | 在 Claude Code 会话中如何收集输入、生成本地辅助产物、提示人工确认 | Vercel/Nitro 服务端实现、飞书 Bot 路由、审批权限或线上状态机。 |

当前代码没有从 `server/`、`scripts/` 或运行时配置导入 `.claude/skills/`。Skill 是 Claude Code 的本地交互协议；服务端 Bot 则由 `server/lib/feishu/` 中的路由、服务和配置实现。两者可使用相同的业务名词或口令，但不是同一执行入口。

## 综合 Skill 的定位

| Skill | Claude Code 中的作用 | 对应文档 | 现状与硬边界 |
| --- | --- | --- | --- |
| [`OA优惠券提报`](../../.claude/skills/OA优惠券提报/SKILL.md) | 综合的本地评审/底稿合同：以配券表为字段第一来源，收集白名单、可选黑名单和测算图片，完成映射、无黑名单/重叠决策、标准产物与两次确认的离线准备。 | [三源 PRD v1.0](proposals/three-source/coupon-oa-three-source-workflow-prd-v1.md) · [飞书综合 Skill 升级方案](proposals/three-source/coupon-oa-feishu-unified-skill-upgrade-plan-v1.md)。 | Skill 只在 Claude Code 执行，不调用 Bot、Base、Drive 或 OA API；三源 Bot 路线及 native-submit 仍待服务端实现和 rollout Gate。 |

## 命名与执行入口

`/OA优惠券提报` 在两个上下文中的目标含义必须写清执行平面：

- **Claude Code**：以斜杠调用 `OA优惠券提报` Skill，产生本地零副作用评审/底稿；
- **飞书 Bot（当前）**：当前服务端仍以 [MVP v1.3](current/product/coupon-oa-mvp-prd-v1.3.md) 定义的 `OA优惠券填报` 系统草稿路线为准，尚未因本 Skill 的出现自动注册 `/OA优惠券提报`；
- **飞书 Bot（目标）**：评审、服务端实现与 R2 Gate 通过后，Bot 才能将 `/OA优惠券提报` 路由到版本化三源系统任务；R3/R4 前不得创建原生 OA。

文档中提到口令时，应标注“Claude Code Skill”“当前飞书 Bot”或“目标飞书 Bot”；不可用同一句话暗示执行平面共享状态、文件引用或权限。

## 权威性、数据和状态边界

1. 规则冲突时，`docs/adr/` → `current/operations/` → `current/product/` → `current/implementation/` 的顺序优先于任何 Skill 文本。
2. Skill 生成的本地文件不是运行时系统草稿，不自动进入 Base、Drive、审批附件库或原生 OA。若未来需要导入，必须另行定义 owner、revision、schema、hash、授权和审计的服务端导入合同。
3. Skill 只能处理已获授权的本地数据；真实案例仍仅限 `cases/`，本地底稿仅限 `drafts/`，二者均受 `.gitignore` 保护。
4. `proposals/` 中的 Skill 内容可以帮助评审，但不能绕过正式模板、字段映射、服务器鉴权、allowlist、kill switch 和 rollout Gate。

## 同步责任

| 变更类型 | 必须同步 | 不会自动发生 |
| --- | --- | --- |
| 当前产品/架构/上线边界变更 | 更新 `current/`、必要的 ADR/rollout，并审查受影响的 Skill 文案。 | Skill 修改不会反向改变服务端行为或批准上线。 |
| Skill 的收集问题、输出格式或本地校验变更 | 更新对应 `SKILL.md`、其 `references/` 与本文件的映射（若定位变化）。 | 不得把 Skill 的便利性描述升级为 Bot 或 OA 的线上能力。 |
| 综合飞书提报路线获批 | 将定稿规则提升到 `current/`，实现 `/OA优惠券提报` 的服务端路径、测试和 Gate；把 Skill 状态改为与已实现合同一致。 | 离线测试通过或 Skill 存在不等于提议获批，也不注册飞书 Bot 命令。 |

新 Skill 若覆盖优惠券流程，必须先在此表登记其**执行平面、权威来源、输出位置、允许副作用和当前状态**，再对外使用。
