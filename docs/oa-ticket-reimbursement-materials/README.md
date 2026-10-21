# 优惠券 OA 文档库

> **使用方法**：先按文档的生命周期选择目录，再按文档的职责阅读。不要仅根据文件版本号、目录名称或历史测试结论判断某项能力是否已开放。

## 当前结论

| 事项 | 当前结论 | 权威入口 |
| --- | --- | --- |
| P1-1 Excel 试点 | 当前唯一的受控生成基线：Bot 单聊中生成常规满减券配券表和单列 `SKUID` 白名单，并交接至系统草稿。 | [P1 Excel 试点 PRD v1.6](current/product/coupon-oa-p1-excel-pilot-prd-v1.5.md) |
| 原生 OA | 内网首发仅 `draft-only`；未通过 rollout 的 native-submit Gate 前，服务端不得创建原生 OA。 | [rollout 计划](current/operations/coupon-oa-internal-pilot-rollout-plan-v1.md) |
| 一轮确认改造 | 已形成待评审方案，**尚未替代**当前 P1-1 多步骤试点。 | [一轮确认提议](proposals/conversational-single-confirm/coupon-oa-conversational-single-confirm-prd-v1.3.md) |
| 三源填报 | 已形成待评审方案；仓库中的 R2 模块基础默认关闭，**尚未启用**；正式白/黑名单模板和字段映射未登记、持久 ingress/资源 Gate 未通过前不得上线。 | [三源提议](proposals/three-source/coupon-oa-three-source-workflow-prd-v1.md) · [飞书升级方案](proposals/three-source/coupon-oa-feishu-unified-skill-upgrade-plan-v1.md) |
| 后续 OA 改进需求 | 业务员 `open_id` → 默认业务模式候选、飞书配券节奏表日期候选均为后续需求，当前仍保持人工确认。 | [跨产品需求排期 Backlog](../requirements-backlog.md) |

## 从哪里开始读

| 你的目标 | 先读 | 接着读 | 何时停止 |
| --- | --- | --- | --- |
| 确认当前业务范围、字段和验收 | [当前产品基线](current/product/) | [当前实现基线](current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md) | 不需要查看 proposal 来解释当前行为。 |
| 实现或修改服务端 | [当前实现材料](current/implementation/) | [当前产品基线](current/product/) → 相关 ADR | 若改动入口、事实源、提交时机或架构边界，先更新基线并评估 ADR。 |
| 准备内网试点或处理运行问题 | [当前运行材料](current/operations/) | [records/](records/) 中同类历史证据 | 历史记录只能辅助排障，不能单独作为 go/no-go 依据。 |
| 评审后续体验或三源流程 | [待评审方案](proposals/) | 对应离线验证、当前基线和 ADR | 获批并提升至 `current/` 前，不能据此修改已开放行为。 |
| 查模板、原始依据或做脱敏演练 | [参考资产](reference/) | 对应产品 PRD | 调研、模板和 fixture 本身不等于已发布的业务规则。 |
| 追溯旧决策或历史版本 | [历史归档](history/) | 文件页首列出的替代文档 | 不得把历史文件作为当前需求或上线依据。 |

## 三条当前用户路线

| 路线 | 目的 | 当前边界 |
| --- | --- | --- |
| `OA优惠券审批` | 打开既有原生 OA | 仅导航；业务员在飞书原生页面手工提交，独立于自动化能力。 |
| `OA优惠券填报` | 收集结构化字段与材料，形成系统草稿 | `draft-only` 先行；原生提交仅可能在后续 Gate 全部通过时，由当前 owner 在当前 revision 明确确认后进行。 |
| `优惠券Excel试点` | 生成两份受控 Excel 并交接系统草稿 | 流程自身绝不自动创建原生 OA；只消费冻结且已校验的产物。 |

详细的路线合同以 [MVP PRD v1.8](current/product/coupon-oa-mvp-prd-v1.8.md) 为准；P1-1 特有字段、模板和验收以 [P1 Excel 试点 PRD v1.6](current/product/coupon-oa-p1-excel-pilot-prd-v1.5.md) 为准。

## Claude Code Skill 与本库

`.claude/skills/` 是 Claude Code 的本地交互协议，不是 Vercel/Nitro 服务端代码、飞书 Bot 路由或权限配置。它们可引用本库来收集材料或输出本地辅助产物，但不能单独改变当前流程、创建 OA 或通过 rollout Gate。相同的“口令”在 Claude Code 与飞书 Bot 中可能表示不同执行入口；完整映射、数据边界与同步规则见 [Claude Code Skill 与产品文档的关系](claude-code-skill-contract.md)。

## 目录与可作为依据的范围

| 目录 | 保存什么 | 可否作为当前实施/上线依据 | 维护规则 |
| --- | --- | --- | --- |
| [`current/`](current/) | 现行产品、实现和上线治理基线 | **可以**，但必须遵守 ADR 与 rollout Gate | 变更规则、代码结构或运行门禁时同步更新对应材料。 |
| [`proposals/`](proposals/) | 待评审、未启用的目标方案 | **不可以** | 获批后将定稿内容提升为 `current/`，保留原提议的追溯关系。 |
| [`reference/`](reference/) | 调研证据、受控模板、脱敏 fixture | 仅作为证据、输入或演练资产 | 规则须经业务/流程 Owner 确认后才可进入 current；模板变更须版本化。 |
| [`records/`](records/) | 有日期和环境范围的诊断、修复、验证记录 | 仅用于复现、排障和审计 | 顶部必须说明时间、证据范围和当前适用性。 |
| [`history/`](history/) | 已替代或归档的旧版本 | **不可以** | 仅保留追溯；页首必须指向当前替代文档。 |
| `cases/`、`drafts/` | 真实案例与本地生成的业务草稿 | **不得提交或外发** | 均为本地受控数据；不作为公开测试资产。 |

## 权威性与冲突处理

当材料结论不一致时，按以下顺序判断：

1. 涉及架构、事件入口或不可逆的原生 OA 创建，以**已接受 ADR**为准；内网 bridge 的临时例外以 [ADR-0006](../adr/0006-use-managed-long-connection-bridge-for-internal-coupon-pilot.md) 的范围为限。
2. 涉及阶段、allowlist、canary、回滚或 go/no-go，以 [rollout](current/operations/coupon-oa-internal-pilot-rollout-plan-v1.md) 和 [readiness checklist](current/operations/coupon-oa-pilot-launch-readiness-checklist-v1.md) 为准。
3. 涉及已开放产品行为、字段和验收，以 `current/product/` 中的当前 PRD 为准；P1-1 的具体范围优先于 MVP 的通用规则。
4. 涉及当前代码模块、状态机、文件交接和重构顺序，以 [当前功能结构与重构基线](current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md) 为准。
5. `proposals/`、`reference/`、`records/` 和 `history/` 只能在各自限定用途内解释、验证或追溯，不能单独新增当前产品承诺。

## 数据边界

真实 OA、附件、截图和模型审计输出仅能存放在 Git 忽略的 `cases/<OA编号>/`；运行时生成的业务底稿仅能存放在 `drafts/`。提交、共享或外发前均须完成单独的数据权限与脱敏审查。

可在仓库中共享、用于演练的材料仅限 [脱敏 fixture](reference/fixtures/)。演练审批定义不得连接真实建券、同步或生产环境。受控 Excel 模板位于 [reference/templates/](reference/templates/)；模板选择、字段含义和公式依据以 [模板与字段调研](reference/research/coupon-configuration-templates-and-fields-v0.md) 为索引。
