# 待评审方案

本目录保存**已成形但尚未获业务、流程与技术 Owner 批准的目标方案**。它们用于评审、离线验证与实施准备；在被明确提升至 `../current/` 前，绝不改变当前开放能力、上线范围或原生 OA 权限。

| 主题 | 入口 | 当前状态 |
| --- | --- | --- |
| 对话式一轮确认 | [PRD v1.3](conversational-single-confirm/coupon-oa-conversational-single-confirm-prd-v1.3.md) | 待评审；拟将 P1-1 多次中间确认收敛为一张最终确认单。 |
| 三源优惠券填报 | [PRD v1.0](three-source/coupon-oa-three-source-workflow-prd-v1.md) | 待 Owner 评审；方案 A 拟将本地完整三源输入迁移到 Bot 单聊，再交接既有 OA 测试稿与显式发送路径。 |
| 综合 Skill 飞书适配 | [升级方案 v1](three-source/coupon-oa-feishu-unified-skill-upgrade-plan-v1.md) | 已沉淀为 P1 完整 Skill/长期架构目标；不重建提交平台，复用既有 OA 测试稿、最终发送与 readback。 |
| 三源最快 Bot POC | [P0 交付计划 v1](three-source/coupon-three-source-fast-poc-delivery-plan-v1.md) | 需求方当前优先路线：单用户严选三源 → OA 测试稿；复用现有 adapter，不以 FDEV 或原生 OA 为前置。 |
| 持久 Command-Intake Worker | [设计 v1](three-source/coupon-oa-durable-command-intake-worker-design-v1.md) | 默认关闭的 code foundation 与本地 PostgreSQL integration 已实现；R1-dev command/card 与正式 R2 材料流边界已分离，仍待 bridge/常驻 worker/Feishu rehearsal 与 Owner 评审。 |
| 飞书开发版需求与进度台账 | [需求台账 v1](three-source/coupon-oa-feishu-dev-requirements-tracker-v1.md) | **P1 耐久化/正式运行的生命周期台账**；不阻断 P0 最快 Bot POC。 |
| FDEV-001 Dev release baseline | [候选清单 v1](../records/durable-control-plane/fdev-001-dev-release-baseline-v1.md) | P1 耐久化/正式运行的候选字段模板，不是 P0 交付的前置，也不是 clean release、commit/tag 或 🥇。 |
| R0.5 本机长连接 Smoke | [部署方案 v1](three-source/coupon-oa-r0.5-local-long-connection-vercel-deployment-plan-v1.md)<br>[测试用例 v1](three-source/coupon-oa-r0.5-local-long-connection-smoke-test-case-v1.md) | 提议中的本机 `lark-cli` → Vercel transport 连通性测试；所有业务 Gate 和 Bot 用户回复关闭，不构成 R1-dev/R2/OA 证据。 |
| 飞书开发版 command-intake 发布 | [发布计划 v1](three-source/coupon-oa-feishu-dev-command-intake-release-plan-v1.md) | 待评审；独立 Dev App/Bot 的 **R1-dev** command-to-card canary，映射 `r1-intake`，不开放材料或 OA。 |
| 耐久控制面风险整改 | [开发清单 v1](three-source/coupon-oa-durable-control-plane-risk-remediation-backlog-v1.md) | 已将 CP-RISK-001–008 映射到唯一 FDEV/FDEV 子需求；优先处理 bridge ACK、外部 effect fencing、unknown/DLQ 与运行观测。 |
| 持久 Command-Intake Worker 验证 | [测试方案 v1](three-source/coupon-oa-durable-command-intake-worker-test-plan-v1.md) | 已有 unit/SQL contract 与本地 PostgreSQL integration 证据；HTTP rehearsal、durable bridge ACK、真实 Dev Bot 和受控 E2E 待实施。 |
| 三源后续迭代 | [迭代计划 v1](three-source/coupon-oa-three-source-follow-up-iteration-plan-v1.md) | 已记录后续决策，不表示已实现或已接入飞书。 |
| 商家 ID 名单封闭集判定 | [设计与审计 v1](three-source/coupon-three-source-merchant-id-whitelist-design-v1.md) | 待评审；无表头单列数字由 AI 封闭集判定 SKU/商家 ID，owner 双选项确认后按维度生成忠实产物与「限商家ID」配券表。实施计划见 `docs/superpowers/plans/2026-10-16-coupon-three-source-merchant-id-whitelist.md`。 |
| 第二轮表单模版缺项提醒 | [设计 v1](three-source/coupon-three-source-template-gap-reminder-design-v1.md) | 待评审；修复 2026-10-16「生成中死卡」事故三项缺陷：条件必填字段提前到第二轮卡片、恢复卡组件重名（11310）、投递失败静默。 |
| 三源离线验证 | [离线测试方案 v1](three-source/coupon-oa-three-source-offline-test-plan-v1.md) | 仅合成数据和本地零副作用验证，不能推断为飞书或 OA 联调通过。 |
| 优惠券 OA 模块化升级 | [升级方案 v1](modularization/coupon-oa-modularization-upgrade-proposal-v1.md) | 待技术、流程与业务 Owner 评审；仅定义渐进式模块化目标，不改变当前代码或运行行为。 |

## 提升规则

1. 先明确业务范围、正式模板/字段映射、流程 Owner 和技术门禁；
2. 以脱敏资产完成对应的单元、合同和离线/隔离环境验证；
3. 评审通过后，在 `../current/product/`、`../current/implementation/` 和必要的 ADR/rollout 中写入生效规则；
4. 保留本目录中的提议作为决策追溯，页首注明其最终去向。

当前可执行的行为只能以 [`../current/`](../current/) 为准。

`.claude/skills/OA优惠券提报/` 是本目录三源提议的**下游 Claude Code 综合评审/交互合同**；它不是已部署的飞书 Bot 路线。唯一目标 Bot 命令、服务端实现和分阶段 Gate 见[飞书综合 Skill 升级方案](three-source/coupon-oa-feishu-unified-skill-upgrade-plan-v1.md)，执行平面与同步规则见 [Skill 与产品文档关系](../claude-code-skill-contract.md)。
