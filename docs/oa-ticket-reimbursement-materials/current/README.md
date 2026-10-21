# 当前基线

本目录保存**已经生效**的产品范围、技术结构和上线治理材料。它们可以指导当前实现与内网试点，但不表示所有能力都已经部署或获准开放；每份文件页首的阶段限制仍然有效。

| 主题 | 权威材料 | 用途 |
| --- | --- | --- |
| 通用产品边界 | [MVP PRD v1.8](product/coupon-oa-mvp-prd-v1.8.md) | 三条用户路线、draft-only 与 native-submit 的通用门禁。 |
| P1-1 Excel 试点 | [P1 Excel 试点 PRD v1.6](product/coupon-oa-p1-excel-pilot-prd-v1.5.md) | 当前支持的券型、字段、模板、状态和验收。 |
| 当前代码结构 | [功能结构与重构基线](implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md) | 已实现模块、状态机、文件交接、阻塞项和重构顺序。 |
| 提交与附件边界 | [自动填报实施方案 v1.4](implementation/coupon-oa-bot-autofill-plan-v1.4.md) | 源文件、冻结产物、Drive/Base/file code 与原生 OA 的边界。 |
| Bridge 设计 | [企业托管长连接桥设计](implementation/coupon-oa-managed-bridge-design-v1.md) | 内网试点 ingress 的目标实施边界。 |
| Base 配置 | [草稿 Base schema](implementation/coupon-oa-draft-base-schema-v1.md) / [`fields` JSON](implementation/coupon-oa-draft-base-fields-v1.json) | 受控表结构和初始化资产。 |
| 阶段与 go/no-go | [rollout 计划](operations/coupon-oa-internal-pilot-rollout-plan-v1.md) | R0–R5、Gate、canary、暂停与回滚。 |
| 三源本机长连接 POC | [本机长连接 draft-only POC 运行手册](operations/coupon-three-source-local-long-connection-poc-runbook-v1.md) | 需求方已选择的单用户严选三源 → OA 测试稿限时验证；不是 R1/R2/R3、可靠运行或原生 OA 授权。 |
| 运行准备 | [资源发现与部署前交接指南](operations/coupon-oa-managed-bridge-provisioning-guide-v1.md) / [bridge runbook](operations/coupon-oa-managed-bridge-runbook-v1.md) / [readiness checklist](operations/coupon-oa-pilot-launch-readiness-checklist-v1.md) | 企业资源发现/申请与交接、运行期操作、Go/No-go 证据清单。 |

## 冲突时的读取顺序

1. 已接受的 `docs/adr/` 优先处理架构、事件入口和不可逆原生 OA 创建；
2. `operations/` 优先处理阶段、allowlist、canary、回滚和 go/no-go；
3. `product/` 优先处理当前用户行为、字段和验收，其中 P1-1 细节优先于 MVP 通用规则；
4. `implementation/` 说明当前代码结构和如何安全落地，不能单独扩大产品承诺。

尚未获批的后续路线一律在 [`../proposals/`](../proposals/) 中维护，不能覆盖本目录的基线。

Claude Code 的本地 Skill 不属于服务端运行时模块，也不自动共享 Bot 的系统草稿、文件引用或提交权限；其与本目录的对应关系见 [Skill 与产品文档关系](../claude-code-skill-contract.md)。
