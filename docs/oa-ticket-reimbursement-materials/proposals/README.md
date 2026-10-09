# 待评审方案

本目录保存**已成形但尚未获业务、流程与技术 Owner 批准的目标方案**。它们用于评审、离线验证与实施准备；在被明确提升至 `../current/` 前，绝不改变当前开放能力、上线范围或原生 OA 权限。

| 主题 | 入口 | 当前状态 |
| --- | --- | --- |
| 对话式一轮确认 | [PRD v1.3](conversational-single-confirm/coupon-oa-conversational-single-confirm-prd-v1.3.md) | 待评审；拟将 P1-1 多次中间确认收敛为一张最终确认单。 |
| 三源优惠券填报 | [PRD v1.0](three-source/coupon-oa-three-source-workflow-prd-v1.md) | 待评审；拟处理配券表、白名单与可选黑名单的两次确认路径。 |
| 综合 Skill 飞书适配 | [升级方案 v1](three-source/coupon-oa-feishu-unified-skill-upgrade-plan-v1.md) | 待评审；拟以 `/OA优惠券提报` 将本地综合合同升级为分阶段的飞书 Bot 路线。 |
| 持久 Command-Intake Worker | [设计 v1](three-source/coupon-oa-durable-command-intake-worker-design-v1.md) | 默认关闭的 code foundation 已实现；仍待真实 PostgreSQL、bridge/worker rehearsal 与 Owner 评审。 |
| 持久 Command-Intake Worker 验证 | [测试方案 v1](three-source/coupon-oa-durable-command-intake-worker-test-plan-v1.md) | unit/SQL contract 已通过；PostgreSQL、HTTP rehearsal 与受控 E2E 待实施。 |
| 三源后续迭代 | [迭代计划 v1](three-source/coupon-oa-three-source-follow-up-iteration-plan-v1.md) | 已记录后续决策，不表示已实现或已接入飞书。 |
| 三源离线验证 | [离线测试方案 v1](three-source/coupon-oa-three-source-offline-test-plan-v1.md) | 仅合成数据和本地零副作用验证，不能推断为飞书或 OA 联调通过。 |
| 优惠券 OA 模块化升级 | [升级方案 v1](modularization/coupon-oa-modularization-upgrade-proposal-v1.md) | 待技术、流程与业务 Owner 评审；仅定义渐进式模块化目标，不改变当前代码或运行行为。 |

## 提升规则

1. 先明确业务范围、正式模板/字段映射、流程 Owner 和技术门禁；
2. 以脱敏资产完成对应的单元、合同和离线/隔离环境验证；
3. 评审通过后，在 `../current/product/`、`../current/implementation/` 和必要的 ADR/rollout 中写入生效规则；
4. 保留本目录中的提议作为决策追溯，页首注明其最终去向。

当前可执行的行为只能以 [`../current/`](../current/) 为准。

`.claude/skills/OA优惠券提报/` 是本目录三源提议的**下游 Claude Code 综合评审/交互合同**；它不是已部署的飞书 Bot 路线。唯一目标 Bot 命令、服务端实现和分阶段 Gate 见[飞书综合 Skill 升级方案](three-source/coupon-oa-feishu-unified-skill-upgrade-plan-v1.md)，执行平面与同步规则见 [Skill 与产品文档关系](../claude-code-skill-contract.md)。
